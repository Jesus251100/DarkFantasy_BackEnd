import { randomUUID } from 'node:crypto'
import {
  CONFIG_ONLINE,
  MENSAJE_SIN_JUGADORES,
  NOMBRES_BOT,
  type ConfigOnline,
} from '../domain/online/ConfigOnline'
import { SalaOnline, type VistaSala } from '../domain/online/SalaOnline'
import type { IRegistroPartidasOnline, ResultadoOnline } from '../domain/online/IRegistroPartidasOnline'

export interface MiembroCola {
  usuarioId: string
  nombre: string
  socketId: string
}

export interface OyenteSalas {
  /** Se encontró partida: los humanos deben recibir su vista y unirse a la sala. */
  onEmparejar(sala: SalaOnline, humanos: MiembroCola[]): void
  onCantar(sala: SalaOnline, numero: number): void
  onTerminar(sala: SalaOnline, ganadorId: string | null): void
  /** Un reclamo no válido: avisar solo a ese socket. */
  onRechazo(socketId: string, mensaje: string): void
  /** Aviso a los jugadores en cola (p. ej. no hay suficientes jugadores). */
  onAlertaCola(humanos: MiembroCola[], mensaje: string): void
}

/**
 * Orquesta la cola de matchmaking, los temporizadores de canto y los bots.
 * No conoce socket.io: la infraestructura implementa `OyenteSalas`.
 */
export class GestionSalas {
  private readonly cola = new Map<string, MiembroCola>()
  private readonly salas = new Map<string, SalaOnline>()
  private readonly salaDeUsuario = new Map<string, string>()
  private readonly timerCantar = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly botsReclamando = new Set<string>()
  private timerRelleno: ReturnType<typeof setTimeout> | null = null

  constructor(
    private readonly oyente: OyenteSalas,
    private readonly repo: IRegistroPartidasOnline,
    private readonly config: ConfigOnline = CONFIG_ONLINE,
  ) {}

  entrarCola(usuarioId: string, nombre: string, socketId: string): void {
    this.abandonar(usuarioId)
    this.cola.set(usuarioId, { usuarioId, nombre, socketId })
    this.procesarCola()
  }

  salirCola(usuarioId: string): void {
    this.cola.delete(usuarioId)
    this.revisarTimerRelleno()
  }

  enCola(usuarioId: string): boolean {
    return this.cola.has(usuarioId)
  }

  reclamarBingo(usuarioId: string): void {
    const salaId = this.salaDeUsuario.get(usuarioId)
    if (!salaId) {
      this.rechazar(usuarioId, 'No estás en una partida.')
      return
    }
    const sala = this.salas.get(salaId)
    if (!sala) return
    if (sala.estadoActual !== 'playing') {
      this.rechazar(usuarioId, 'La partida no está en curso.')
      return
    }
    const resultado = sala.reclamar(usuarioId)
    if (resultado?.won) {
      this.terminar(sala, usuarioId)
    } else {
      this.rechazar(usuarioId, 'Todavía no completas el patrón con las bolas cantadas.')
    }
  }

  abandonar(usuarioId: string): void {
    this.cola.delete(usuarioId)
    const salaId = this.salaDeUsuario.get(usuarioId)
    if (!salaId) {
      this.revisarTimerRelleno()
      return
    }
    const sala = this.salas.get(salaId)
    if (!sala) return
    sala.marcarDesconectado(usuarioId)
    this.salaDeUsuario.delete(usuarioId)
    if (sala.estadoActual === 'playing' && sala.humanosConectados === 0) {
      this.terminar(sala, null)
    }
  }

  salaDe(usuarioId: string): SalaOnline | null {
    const salaId = this.salaDeUsuario.get(usuarioId)
    return salaId ? (this.salas.get(salaId) ?? null) : null
  }

  vistaDe(usuarioId: string): VistaSala | null {
    return this.salaDe(usuarioId)?.vistaPara(usuarioId) ?? null
  }

  private procesarCola(): void {
    while (this.cola.size >= this.config.minPlayers) {
      const humanos = this.tomarDeCola(this.config.maxPlayers)
      this.crearSala(humanos, false)
    }
    this.revisarTimerRelleno()
  }

  private tomarDeCola(cantidad: number): MiembroCola[] {
    const tomados: MiembroCola[] = []
    for (const [id, miembro] of this.cola) {
      tomados.push(miembro)
      this.cola.delete(id)
      if (tomados.length >= cantidad) break
    }
    return tomados
  }

  private revisarTimerRelleno(): void {
    if (this.cola.size > 0 && !this.timerRelleno) {
      this.timerRelleno = setTimeout(() => this.rellenarConBots(), this.config.fillWithBotsAfterMs)
      return
    }
    if (this.cola.size === 0 && this.timerRelleno) {
      clearTimeout(this.timerRelleno)
      this.timerRelleno = null
    }
  }

  private rellenarConBots(): void {
    this.timerRelleno = null
    if (this.cola.size === 0 || this.cola.size >= this.config.minPlayers) {
      this.revisarTimerRelleno()
      return
    }
    const humanos = [...this.cola.values()]
    this.oyente.onAlertaCola(humanos, MENSAJE_SIN_JUGADORES)
    const tomados = this.tomarDeCola(this.config.minPlayers)
    this.crearSala(tomados, true)
  }

  private crearSala(humanos: MiembroCola[], conBots: boolean): void {
    if (humanos.length === 0) return
    const sala = new SalaOnline(randomUUID(), this.config)
    for (const h of humanos) {
      sala.agregarJugador(h.usuarioId, h.nombre, false, h.socketId)
      this.salaDeUsuario.set(h.usuarioId, sala.id)
    }
    if (conBots) {
      while (!sala.llena) {
        const nombre = NOMBRES_BOT[Math.floor(Math.random() * NOMBRES_BOT.length)] ?? 'Rival'
        sala.agregarJugador(`bot:${randomUUID()}`, nombre, true)
      }
    }
    this.salas.set(sala.id, sala)
    this.oyente.onEmparejar(sala, humanos)
    sala.iniciar()
    this.programarCanto(sala, sala.config.revealDelayMs)
  }

  private programarCanto(sala: SalaOnline, esperaMs: number): void {
    const timer = setTimeout(() => this.cantar(sala), esperaMs)
    this.timerCantar.set(sala.id, timer)
  }

  private cantar(sala: SalaOnline): void {
    if (sala.estadoActual !== 'playing') return
    const numero = sala.cantar()
    if (numero === null) {
      this.terminar(sala, null)
      return
    }
    this.oyente.onCantar(sala, numero)
    this.reaccionBots(sala)
    this.programarCanto(sala, sala.config.drawIntervalMs)
  }

  private reaccionBots(sala: SalaOnline): void {
    if (sala.estadoActual !== 'playing') return
    for (const jugador of sala.jugadores) {
      if (!jugador.esBot) continue
      if (this.botsReclamando.has(jugador.id)) continue
      if (!sala.botCompleta(jugador.id)) continue
      this.botsReclamando.add(jugador.id)
      const espera = sala.config.botClaimDelayMs + Math.floor(Math.random() * 500)
      setTimeout(() => {
        this.botsReclamando.delete(jugador.id)
        if (sala.estadoActual !== 'playing') return
        if (!sala.botCompleta(jugador.id)) return
        this.terminar(sala, jugador.id)
      }, espera)
    }
  }

  private terminar(sala: SalaOnline, ganadorId: string | null): void {
    if (sala.estadoActual === 'finished') return
    const timer = this.timerCantar.get(sala.id)
    if (timer) {
      clearTimeout(timer)
      this.timerCantar.delete(sala.id)
    }
    const ganador = sala.jugadores.find((j) => j.id === ganadorId) ?? null
    sala.finalizar(ganadorId)
    this.oyente.onTerminar(sala, ganadorId)

    const resultado: ResultadoOnline = {
      salaId: sala.id,
      size: sala.config.size,
      winModes: [sala.metodoVictoria],
      ganadorId,
      ganadorNombre: ganador?.nombre ?? null,
      duracionSeg: sala.duracionSeg,
      jugadores: sala.jugadores.map((j) => ({
        id: j.id,
        nombre: j.nombre,
        esBot: j.esBot,
        gano: j.id === ganadorId,
        carton: j.carton.toSnapshot(),
      })),
    }

    void this.repo
      .registrar(resultado)
      .catch((error: unknown) => {
        const mensaje = error instanceof Error ? error.message : 'error desconocido'
        console.error(`No se pudo guardar la partida online: ${mensaje}`)
      })

    for (const humano of sala.humanos()) {
      this.salaDeUsuario.delete(humano.id)
    }
    this.salas.delete(sala.id)
  }

  private rechazar(usuarioId: string, mensaje: string): void {
    const sala = this.salaDe(usuarioId)
    const jugador = sala?.jugadores.find((j) => j.id === usuarioId)
    const socketId = jugador?.socketId ?? this.cola.get(usuarioId)?.socketId
    if (socketId) this.oyente.onRechazo(socketId, mensaje)
  }
}
