import { randomUUID } from 'node:crypto'
import {
  CONFIG_ONLINE,
  MENSAJE_SIN_JUGADORES,
  NOMBRES_BOT,
  configPara,
  type ConfigOnline,
  type MesaElegida,
  type ModoMesa,
  type CupoMesa,
} from '../domain/online/ConfigOnline'
import { shuffleInPlace } from '../domain/bingo/geometria'
import { SalaOnline, type VistaSala } from '../domain/online/SalaOnline'
import type { ContactoRadar } from '../domain/online/RadarSala'
import type { IRegistroPartidasOnline, ResultadoOnline } from '../domain/online/IRegistroPartidasOnline'

export interface MiembroCola {
  usuarioId: string
  nombre: string
  avatarUrl: string | null
  socketId: string
}

interface TicketCola extends MiembroCola {
  modo: ModoMesa
  cupo: CupoMesa
}

export interface OyenteSalas {
  /** Se encontró partida: los humanos deben recibir su vista y unirse a la sala. */
  onEmparejar(sala: SalaOnline, humanos: MiembroCola[]): void
  onCantar(sala: SalaOnline, numero: number): void
  /** El radar de la sala se muestra una vez. Lo ven todos. */
  onRadar(sala: SalaOnline, contacto: ContactoRadar): void
  onTerminar(sala: SalaOnline, ganadorId: string | null): void
  /** La sala sigue en juego: marcador de ronda o cartones nuevos. */
  onEstado(sala: SalaOnline): void
  onRankingActualizado(): void
  onProgresoActualizado(usuarioIds: string[]): void
  onAbandono(usuarioId: string, salaId: string): void
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
  private readonly cola = new Map<string, TicketCola>()
  private readonly salas = new Map<string, SalaOnline>()
  private readonly salaDeUsuario = new Map<string, string>()
  private readonly timerCantar = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly deadlineCanto = new Map<string, number>()
  private readonly restanteCantoPausado = new Map<string, number>()
  private readonly salasPausadas = new Set<string>()
  private readonly timersDesconexion = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly botsReclamando = new Set<string>()
  private readonly timersRelleno = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly timerRonda = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly rondaEnPausa = new Set<string>()

  constructor(
    private readonly oyente: OyenteSalas,
    private readonly repo: IRegistroPartidasOnline,
    private readonly config: ConfigOnline = CONFIG_ONLINE,
  ) {}

  entrarCola(
    usuarioId: string,
    nombre: string,
    socketId: string,
    avatarUrl: string | null = null,
    mesa: MesaElegida = { modo: 'mesa', cupo: 4 },
  ): void {
    this.abandonar(usuarioId)
    this.cola.set(usuarioId, { usuarioId, nombre, avatarUrl, socketId, modo: mesa.modo, cupo: mesa.cupo })
    this.procesarGrupo(mesa)
  }

  salirCola(usuarioId: string): void {
    this.cancelarTimerDesconexion(usuarioId)
    this.cola.delete(usuarioId)
    this.revisarTimers()
  }

  reconectarCola(usuarioId: string, socketId: string): boolean {
    const miembro = this.cola.get(usuarioId)
    if (!miembro) return false
    this.cancelarTimerDesconexion(usuarioId)
    miembro.socketId = socketId
    return true
  }

  reconectarPartida(usuarioId: string, socketId: string): SalaOnline | null {
    const salaId = this.salaDeUsuario.get(usuarioId)
    const sala = salaId ? this.salas.get(salaId) : undefined
    if (!sala) return null
    this.cancelarTimerDesconexion(usuarioId)
    sala.marcarConectado(usuarioId, socketId)
    this.reanudarSiSePuede(sala)
    return sala
  }

  desconectar(usuarioId: string, socketId: string): SalaOnline | null {
    const miembroCola = this.cola.get(usuarioId)
    if (miembroCola?.socketId === socketId) {
      this.programarTimerDesconexion(usuarioId, () => {
        const actual = this.cola.get(usuarioId)
        if (actual?.socketId === socketId) {
          this.cola.delete(usuarioId)
          this.revisarTimers()
          return
        }
        this.expirarJugadorDesconectado(usuarioId, socketId)
      })
      return null
    }

    const salaId = this.salaDeUsuario.get(usuarioId)
    const sala = salaId ? this.salas.get(salaId) : undefined
    const jugador = sala?.jugadores.find((item) => item.id === usuarioId)
    if (!sala || !jugador || jugador.socketId !== socketId || !jugador.conectado) return null

    sala.marcarDesconectado(usuarioId)
    this.pausarSala(sala)
    this.programarTimerDesconexion(usuarioId, () => this.expirarJugadorDesconectado(usuarioId, socketId))
    return sala
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
    if (this.rondaEnPausa.has(sala.id)) {
      this.rechazar(usuarioId, 'Esta ronda ya tiene ganador.')
      return
    }
    const resultado = sala.reclamar(usuarioId)
    if (resultado?.won) {
      this.resolverRonda(sala, usuarioId)
    } else {
      this.rechazar(usuarioId, 'Todavía no completas el patrón con las bolas cantadas.')
    }
  }

  abandonar(usuarioId: string): void {
    this.cancelarTimerDesconexion(usuarioId)
    this.cola.delete(usuarioId)
    const salaId = this.salaDeUsuario.get(usuarioId)
    if (!salaId) {
      this.revisarTimers()
      return
    }
    const sala = this.salas.get(salaId)
    if (!sala) return
    sala.marcarDesconectado(usuarioId)
    this.salaDeUsuario.delete(usuarioId)
    if (sala.estadoActual === 'playing' && sala.humanosConectados === 0 && !this.tieneDesconexionPendiente(sala)) {
      this.terminar(sala, null)
    } else {
      this.reanudarSiSePuede(sala)
    }
  }

  salaDe(usuarioId: string): SalaOnline | null {
    const salaId = this.salaDeUsuario.get(usuarioId)
    return salaId ? (this.salas.get(salaId) ?? null) : null
  }

  /** Abre una sala con estos jugadores. El cupo y el modo vienen de la mesa elegida. */
  iniciarSala(
    miembros: MiembroCola[],
    rellenarConBots: boolean,
    mesa: MesaElegida,
    apuesta = 0,
    radarPermitido = false,
  ): void {
    const vivos = miembros.filter((m) => m.usuarioId && m.socketId)
    if (vivos.length === 0) return
    for (const miembro of vivos) this.abandonar(miembro.usuarioId)
    this.crearSala(vivos, rellenarConBots, mesa, apuesta, radarPermitido)
  }

  vistaDe(usuarioId: string): VistaSala | null {
    return this.salaDe(usuarioId)?.vistaPara(usuarioId) ?? null
  }

  private claveMesa(mesa: MesaElegida): string {
    return `${mesa.modo}:${mesa.cupo}`
  }

  private grupo(mesa: MesaElegida): TicketCola[] {
    return [...this.cola.values()].filter((miembro) => miembro.modo === mesa.modo && miembro.cupo === mesa.cupo)
  }

  private procesarGrupo(mesa: MesaElegida): void {
    if (mesa.modo === 'pvp') {
      while (this.grupo(mesa).length >= 2) {
        this.crearSala(this.tomarGrupo(mesa, 2), false, mesa)
      }
    } else {
      while (this.grupo(mesa).length >= 2) {
        const disponibles = this.grupo(mesa).length
        this.crearSala(this.tomarGrupo(mesa, Math.min(mesa.cupo, disponibles)), true, mesa)
      }
    }
    this.revisarTimers()
  }

  private tomarGrupo(mesa: MesaElegida, cantidad: number): TicketCola[] {
    const tomados: TicketCola[] = []
    for (const [id, miembro] of this.cola) {
      if (miembro.modo !== mesa.modo || miembro.cupo !== mesa.cupo) continue
      tomados.push(miembro)
      this.cola.delete(id)
      if (tomados.length >= cantidad) break
    }
    return tomados
  }

  private revisarTimers(): void {
    const activos = new Map<string, MesaElegida>()
    for (const miembro of this.cola.values()) {
      const mesa = { modo: miembro.modo, cupo: miembro.cupo }
      activos.set(this.claveMesa(mesa), mesa)
    }
    for (const [clave, timer] of this.timersRelleno) {
      const mesa = activos.get(clave)
      if (!mesa || mesa.modo === 'pvp' || this.grupo(mesa).length !== 1) {
        clearTimeout(timer)
        this.timersRelleno.delete(clave)
      }
    }
    for (const [clave, mesa] of activos) {
      if (mesa.modo === 'pvp' || this.grupo(mesa).length !== 1 || this.timersRelleno.has(clave)) continue
      this.timersRelleno.set(clave, setTimeout(() => this.rellenarGrupo(mesa), this.config.fillWithBotsAfterMs))
    }
  }

  private rellenarGrupo(mesa: MesaElegida): void {
    const clave = this.claveMesa(mesa)
    const timer = this.timersRelleno.get(clave)
    if (timer) clearTimeout(timer)
    this.timersRelleno.delete(clave)
    const esperando = this.grupo(mesa)
    if (mesa.modo === 'pvp' || esperando.length !== 1) {
      this.revisarTimers()
      return
    }
    this.oyente.onAlertaCola(esperando, MENSAJE_SIN_JUGADORES)
    this.crearSala(this.tomarGrupo(mesa, 1), true, mesa)
  }

  private crearSala(
    humanos: MiembroCola[],
    conBots: boolean,
    mesa: MesaElegida,
    apuesta = 0,
    radarPermitido = true,
  ): void {
    if (humanos.length === 0) return
    const sala = new SalaOnline(randomUUID(), configPara(mesa, this.config), mesa.modo)
    sala.fijarApuesta(apuesta)
    sala.programarRadar(radarPermitido)
    for (const h of humanos) {
      sala.agregarJugador(h.usuarioId, h.nombre, false, h.socketId, h.avatarUrl)
      this.salaDeUsuario.set(h.usuarioId, sala.id)
    }
    if (conBots && mesa.modo !== 'pvp') {
      const perfiles = shuffleInPlace([...NOMBRES_BOT])
      let siguientePerfil = 0
      while (!sala.llena) {
        const nombre = perfiles[siguientePerfil] ?? 'Rival de la Niebla'
        siguientePerfil += 1
        sala.agregarJugador(`bot:${randomUUID()}`, nombre, true)
      }
    }
    sala.sellarEquipos()
    this.salas.set(sala.id, sala)
    sala.iniciar()
    this.oyente.onEmparejar(sala, humanos)
    this.programarCanto(sala, sala.config.revealDelayMs)
  }

  private programarCanto(sala: SalaOnline, esperaMs: number): void {
    const timer = setTimeout(() => {
      this.timerCantar.delete(sala.id)
      this.deadlineCanto.delete(sala.id)
      this.cantar(sala)
    }, esperaMs)
    this.timerCantar.set(sala.id, timer)
    this.deadlineCanto.set(sala.id, Date.now() + esperaMs)
  }

  private cantar(sala: SalaOnline): void {
    if (sala.estadoActual !== 'playing' || this.salasPausadas.has(sala.id) || this.rondaEnPausa.has(sala.id)) return
    const numero = sala.cantar()
    if (numero === null) {
      this.resolverRonda(sala, null)
      return
    }
    const contacto = sala.tomarRadar()
    if (contacto) this.oyente.onRadar(sala, contacto)
    this.oyente.onCantar(sala, numero)
    this.reaccionBots(sala)
    this.programarCanto(sala, sala.config.drawIntervalMs)
  }

  private reaccionBots(sala: SalaOnline): void {
    if (sala.estadoActual !== 'playing' || this.salasPausadas.has(sala.id) || this.rondaEnPausa.has(sala.id)) return
    for (const jugador of sala.jugadores) {
      if (!jugador.esBot) continue
      if (this.botsReclamando.has(jugador.id)) continue
      if (!sala.botCompleta(jugador.id)) continue
      this.botsReclamando.add(jugador.id)
      const demoraMinima = Math.max(650, Math.floor(sala.config.botClaimDelayMs * 0.75))
      const demoraMaxima = Math.max(demoraMinima + 1, sala.config.botClaimDelayMs * 2.5)
      const espera = demoraMinima + Math.floor(Math.random() * (demoraMaxima - demoraMinima))
      setTimeout(() => {
        this.botsReclamando.delete(jugador.id)
        if (sala.estadoActual !== 'playing' || this.salasPausadas.has(sala.id) || this.rondaEnPausa.has(sala.id)) return
        if (!sala.botCompleta(jugador.id)) return
        this.resolverRonda(sala, jugador.id)
      }, espera)
    }
  }

  /**
   * En equipos una ronda ganada suma un punto. A 2 puntos, o al cerrar la tercera, termina la serie.
   * Mientras tanto se muestran el marcador y, unos segundos después, cartones nuevos.
   */
  private resolverRonda(sala: SalaOnline, ganadorId: string | null): void {
    if (sala.estadoActual === 'finished' || this.rondaEnPausa.has(sala.id)) return
    if (sala.modo !== 'equipos') {
      this.terminar(sala, ganadorId)
      return
    }
    this.rondaEnPausa.add(sala.id)
    const sigue = sala.anotarRonda(ganadorId)
    this.detenerCanto(sala)
    if (!sigue) {
      this.rondaEnPausa.delete(sala.id)
      this.terminar(sala, ganadorId)
      return
    }
    this.oyente.onEstado(sala)
    const timer = setTimeout(() => {
      this.timerRonda.delete(sala.id)
      this.rondaEnPausa.delete(sala.id)
      if (!this.salas.has(sala.id) || sala.estadoActual !== 'playing') return
      sala.abrirSiguienteRonda()
      this.oyente.onEstado(sala)
      this.programarCanto(sala, 4000)
    }, 4500)
    this.timerRonda.set(sala.id, timer)
  }

  private detenerCanto(sala: SalaOnline): void {
    const timer = this.timerCantar.get(sala.id)
    if (timer) clearTimeout(timer)
    this.timerCantar.delete(sala.id)
    this.deadlineCanto.delete(sala.id)
    this.restanteCantoPausado.delete(sala.id)
  }

  private cancelarRonda(salaId: string): void {
    const timer = this.timerRonda.get(salaId)
    if (timer) clearTimeout(timer)
    this.timerRonda.delete(salaId)
    this.rondaEnPausa.delete(salaId)
  }

  private terminar(sala: SalaOnline, ganadorId: string | null): void {
    if (sala.estadoActual === 'finished') return
    this.detenerCanto(sala)
    this.cancelarRonda(sala.id)
    this.salasPausadas.delete(sala.id)
    const ganador = sala.jugadores.find((j) => j.id === ganadorId) ?? null
    sala.finalizar(ganadorId)
    this.oyente.onTerminar(sala, ganadorId)

    const serie = sala.serie
    const resultado: ResultadoOnline = {
      salaId: sala.id,
      size: sala.config.size,
      winModes: [sala.metodoVictoria],
      ganadorId,
      ganadorNombre: serie?.equipoGanador ? `Equipo ${serie.equipoGanador}` : ganador?.nombre ?? null,
      duracionSeg: sala.duracionSeg,
      apuesta: sala.apuesta,
      jugadores: sala.jugadores.map((j) => ({
        id: j.id,
        nombre: j.nombre,
        esBot: j.esBot,
        gano: j.ganador,
        carton: j.carton.toSnapshot(),
      })),
    }

    void this.repo
      .registrar(resultado)
      .then(() => {
        this.oyente.onRankingActualizado()
        this.oyente.onProgresoActualizado(sala.humanos().map((humano) => humano.id))
      })
      .catch((error: unknown) => {
        const mensaje = error instanceof Error ? error.message : 'error desconocido'
        console.error(`No se pudo guardar la partida online: ${mensaje}`)
      })

    for (const humano of sala.humanos()) {
      this.salaDeUsuario.delete(humano.id)
      this.cancelarTimerDesconexion(humano.id)
    }
    this.salas.delete(sala.id)
  }

  private rechazar(usuarioId: string, mensaje: string): void {
    const sala = this.salaDe(usuarioId)
    const jugador = sala?.jugadores.find((j) => j.id === usuarioId)
    const socketId = jugador?.socketId ?? this.cola.get(usuarioId)?.socketId
    if (socketId) this.oyente.onRechazo(socketId, mensaje)
  }

  private programarTimerDesconexion(usuarioId: string, alVencer: () => void): void {
    this.cancelarTimerDesconexion(usuarioId)
    const timer = setTimeout(() => {
      this.timersDesconexion.delete(usuarioId)
      alVencer()
    }, this.config.reconnectGraceMs)
    this.timersDesconexion.set(usuarioId, timer)
  }

  private cancelarTimerDesconexion(usuarioId: string): void {
    const timer = this.timersDesconexion.get(usuarioId)
    if (timer) clearTimeout(timer)
    this.timersDesconexion.delete(usuarioId)
  }

  private expirarJugadorDesconectado(usuarioId: string, socketId: string): void {
    const salaId = this.salaDeUsuario.get(usuarioId)
    const sala = salaId ? this.salas.get(salaId) : undefined
    const jugador = sala?.jugadores.find((item) => item.id === usuarioId)
    if (!sala || !jugador || jugador.socketId !== socketId) return
    if (sala.estadoActual === 'playing') this.oyente.onAbandono(usuarioId, sala.id)
    if (jugador.conectado) sala.marcarDesconectado(usuarioId)
    this.salaDeUsuario.delete(usuarioId)
    if (sala.estadoActual === 'playing' && sala.humanosConectados === 0 && !this.tieneDesconexionPendiente(sala)) {
      this.terminar(sala, null)
      return
    }
    this.reanudarSiSePuede(sala)
  }

  private tieneDesconexionPendiente(sala: SalaOnline): boolean {
    return sala.humanos().some((jugador) =>
      !jugador.conectado && this.salaDeUsuario.get(jugador.id) === sala.id && this.timersDesconexion.has(jugador.id),
    )
  }

  private pausarSala(sala: SalaOnline): void {
    if (sala.estadoActual !== 'playing' || this.salasPausadas.has(sala.id) || this.rondaEnPausa.has(sala.id)) return
    const timer = this.timerCantar.get(sala.id)
    if (timer) clearTimeout(timer)
    this.timerCantar.delete(sala.id)
    const deadline = this.deadlineCanto.get(sala.id)
    this.restanteCantoPausado.set(sala.id, deadline ? Math.max(0, deadline - Date.now()) : sala.config.drawIntervalMs)
    this.deadlineCanto.delete(sala.id)
    this.salasPausadas.add(sala.id)
  }

  private reanudarSiSePuede(sala: SalaOnline): void {
    if (this.rondaEnPausa.has(sala.id)) return
    if (!this.salasPausadas.has(sala.id) || this.tieneDesconexionPendiente(sala)) return
    this.salasPausadas.delete(sala.id)
    const restante = this.restanteCantoPausado.get(sala.id) ?? sala.config.drawIntervalMs
    this.restanteCantoPausado.delete(sala.id)
    if (sala.estadoActual !== 'playing') return
    this.programarCanto(sala, restante)
    this.reaccionBots(sala)
  }
}
