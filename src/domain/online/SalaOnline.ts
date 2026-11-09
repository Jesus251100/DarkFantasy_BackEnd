import { Carton } from '../bingo/Carton'
import { Oraculo } from '../bingo/Oraculo'
import { shuffleInPlace } from '../bingo/geometria'
import { patronesDesdeModos } from '../bingo/patrones/catalogoPatrones'
import type { IPatronVictoria } from '../bingo/patrones/IPatronVictoria'
import type { BingoCell, WinMode, WinResult } from '../bingo/tipos'
import type { ConfigOnline } from './ConfigOnline'
import {
  BOOSTERS_OFENSIVOS,
  EFECTOS_BOOSTER,
  type TipoEfectoBooster,
} from './efectosBooster'

export type EstadoSala = 'waiting' | 'playing' | 'finished'

export interface EfectoActivo {
  tipo: TipoEfectoBooster
  hasta: number
  lanzadoPorId: string
  lanzadoPorNombre: string
  casillasBloqueadas?: number[]
  numerosFalsos?: Record<string, number>
}

export interface EfectoBoosterVista {
  tipo: TipoEfectoBooster
  restanteMs: number
  lanzadoPorId: string
  lanzadoPorNombre: string
  casillasBloqueadas?: number[]
  numerosFalsos?: Record<string, number>
}

export interface ResultadoLanzamiento {
  ok: boolean
  error?: string
  tipo?: TipoEfectoBooster
  aplicado?: boolean
  bloqueadoPorEscudo?: boolean
  objetivoNombre?: string
  hasta?: number
  restanteMs?: number
  casillasBloqueadas?: number[]
  numerosFalsos?: Record<string, number>
}

export interface JugadorSala {
  id: string
  nombre: string
  avatarUrl: string | null
  socketId: string | null
  esBot: boolean
  conectado: boolean
  carton: Carton
  ganador: boolean
  efectos: Partial<Record<TipoEfectoBooster, EfectoActivo>>
}

export interface JugadorVista {
  id: string
  nombre: string
  avatarUrl: string | null
  esBot: boolean
  conectado: boolean
  ganador: boolean
  efectos: EfectoBoosterVista[]
}

export interface VistaSala {
  salaId: string
  estado: EstadoSala
  size: number
  fondoNivel: number
  winModes: WinMode[]
  metodosVictoria: WinMode[]
  maxNumber: number
  calledList: number[]
  lastDrawn: number | null
  jugadores: JugadorVista[]
  tuCarton: BingoCell[]
  ganador: string | null
}

/** Una sala de bingo online: estado puro, sin socket ni temporizadores. */
export class SalaOnline {
  readonly jugadores: JugadorSala[] = []
  readonly metodoVictoria: WinMode
  readonly fondoNivel: number
  private readonly patrones: IPatronVictoria[]
  private oraculo: Oraculo
  private estado: EstadoSala = 'waiting'
  private ganadorId: string | null = null
  private readonly creadaEn = Date.now()
  private iniciadaEn: number | null = null

  constructor(
    readonly id: string,
    readonly config: ConfigOnline,
  ) {
    this.metodoVictoria =
      config.winModes[Math.floor(Math.random() * config.winModes.length)] ?? 'row'
    this.fondoNivel = 1 + Math.floor(Math.random() * 9)
    this.patrones = patronesDesdeModos([this.metodoVictoria])
    this.oraculo = Oraculo.nuevo(config.maxNumber)
  }

  get estadoActual(): EstadoSala {
    return this.estado
  }

  get ganador(): string | null {
    return this.ganadorId
  }

  get cantidad(): number {
    return this.jugadores.length
  }

  get llena(): boolean {
    return this.jugadores.length >= this.config.maxPlayers
  }

  get humanosConectados(): number {
    return this.jugadores.filter((j) => !j.esBot && j.conectado).length
  }

  get duracionSeg(): number {
    if (this.iniciadaEn === null) return 0
    return Math.round((Date.now() - this.iniciadaEn) / 1000)
  }

  agregarJugador(id: string, nombre: string, esBot: boolean, socketId: string | null = null, avatarUrl: string | null = null): void {
    this.jugadores.push({
      id,
      nombre,
      avatarUrl: esBot ? null : avatarUrl,
      esBot,
      socketId,
      conectado: true,
      carton: Carton.aleatorio(this.config.size, this.config.maxNumber),
      ganador: false,
      efectos: {},
    })
  }

  iniciar(): void {
    this.oraculo = Oraculo.nuevo(this.config.maxNumber)
    this.estado = 'playing'
    this.iniciadaEn = Date.now()
  }

  cantar(): number | null {
    if (this.estado !== 'playing') return null
    if (!this.oraculo.quedanBolas()) return null
    this.limpiarEfectos(Date.now())
    const preferidos = this.numerosEnCartonesConEfecto('luck')
    const evitados = this.numerosEnCartonesConEfecto('sabotage')
    if (preferidos.length || evitados.length) {
      return this.oraculo.cantarConPreferencias(preferidos, evitados, 0.7)
    }
    return this.oraculo.cantar()
  }

  /** Validación autoritativa: ¿completó algún patrón con las bolas cantadas? */
  reclamar(jugadorId: string): WinResult | null {
    if (this.estado !== 'playing') return null
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador) return null
    if (jugador.efectos.freeze && jugador.efectos.freeze.hasta > Date.now()) return null
    return this.victoriaPermitida(jugador)
  }

  botCompleta(jugadorId: string): boolean {
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador) return false
    if (jugador.efectos.freeze && jugador.efectos.freeze.hasta > Date.now()) return false
    return this.victoriaPermitida(jugador).won
  }

  /** Valida el lanzamiento y aplica el efecto (el escudo es autoritativo aquí). */
  lanzarBooster(lanzadorId: string, objetivoId: string, boosterId: number): ResultadoLanzamiento {
    if (this.estado !== 'playing') {
      return { ok: false, error: 'La partida no está en curso.' }
    }
    const lanzador = this.jugadores.find((j) => j.id === lanzadorId)
    if (!lanzador) {
      return { ok: false, error: 'No estás en esta sala.' }
    }
    const objetivo = this.jugadores.find((j) => j.id === objetivoId)
    if (!objetivo) {
      return { ok: false, error: 'El objetivo no pertenece a esta sala.' }
    }
    const definicion = EFECTOS_BOOSTER[boosterId]
    if (!definicion) {
      return { ok: false, error: 'Booster desconocido.' }
    }

    const ahora = Date.now()
    this.limpiarEfectos(ahora)

    const escudo = objetivo.efectos.shield
    const bloqueadoPorEscudo =
      BOOSTERS_OFENSIVOS.has(boosterId) && !!escudo && escudo.hasta > ahora

    let casillasBloqueadas: number[] | undefined
    let numerosFalsos: Record<string, number> | undefined
    if (!bloqueadoPorEscudo) {
      if (definicion.tipo === 'sabotage') {
        const indices = objetivo.carton.toSnapshot().flatMap((celda, indice) => celda.free ? [] : [indice])
        casillasBloqueadas = shuffleInPlace([...indices]).slice(0, Math.min(3, indices.length))
        numerosFalsos = {}
        const libres = indices.filter((indice) => !casillasBloqueadas?.includes(indice))
        for (const indice of shuffleInPlace(libres).slice(0, 3)) {
          numerosFalsos[String(indice)] = 1 + Math.floor(Math.random() * this.config.maxNumber)
        }
      }
      objetivo.efectos[definicion.tipo] = {
        tipo: definicion.tipo,
        hasta: ahora + definicion.duracionMs,
        lanzadoPorId: lanzador.id,
        lanzadoPorNombre: lanzador.nombre,
        ...(casillasBloqueadas ? { casillasBloqueadas } : {}),
        ...(numerosFalsos ? { numerosFalsos } : {}),
      }
    }

    return {
      ok: true,
      tipo: definicion.tipo,
      aplicado: !bloqueadoPorEscudo,
      bloqueadoPorEscudo,
      objetivoNombre: objetivo.nombre,
      hasta: bloqueadoPorEscudo ? 0 : ahora + definicion.duracionMs,
      restanteMs: bloqueadoPorEscudo ? 0 : definicion.duracionMs,
      ...(casillasBloqueadas ? { casillasBloqueadas } : {}),
      ...(numerosFalsos ? { numerosFalsos } : {}),
    }
  }

  private limpiarEfectos(ahora: number): void {
    for (const jugador of this.jugadores) {
      for (const [tipo, efecto] of Object.entries(jugador.efectos)) {
        if (!efecto || efecto.hasta <= ahora) {
          delete jugador.efectos[tipo as TipoEfectoBooster]
        }
      }
    }
  }

  private numerosEnCartonesConEfecto(tipo: TipoEfectoBooster): number[] {
    const numeros: number[] = []
    const cantadas = this.oraculo.conjunto
    for (const jugador of this.jugadores) {
      const efecto = jugador.efectos[tipo]
      if (!efecto || efecto.hasta <= Date.now()) continue
      for (const celda of jugador.carton.toSnapshot()) {
        if (!celda.free && !cantadas.has(celda.number)) numeros.push(celda.number)
      }
    }
    return numeros
  }

  private victoriaPermitida(jugador: JugadorSala): WinResult {
    const cantadas = this.oraculo.conjunto
    const bloqueadas = new Set(jugador.efectos.sabotage?.casillasBloqueadas ?? [])
    for (const patron of this.patrones) {
      for (const indices of patron.indices(jugador.carton.tamano)) {
        if (indices.some((indice) => bloqueadas.has(indice))) continue
        if (indices.every((indice) => jugador.carton.celdaEn(indice)?.cubreBola(cantadas) === true)) {
          return { won: true, winningIndices: indices, mode: patron.id }
        }
      }
    }
    return { won: false, winningIndices: [], reason: 'no-line' }
  }

  private efectosDe(jugador: JugadorSala, ahora: number): EfectoBoosterVista[] {
    return Object.values(jugador.efectos)
      .filter((efecto): efecto is EfectoActivo => !!efecto && efecto.hasta > ahora)
      .map((efecto) => ({
        tipo: efecto.tipo,
        restanteMs: Math.max(0, efecto.hasta - ahora),
        lanzadoPorId: efecto.lanzadoPorId,
        lanzadoPorNombre: efecto.lanzadoPorNombre,
        ...(efecto.casillasBloqueadas ? { casillasBloqueadas: [...efecto.casillasBloqueadas] } : {}),
        ...(efecto.numerosFalsos ? { numerosFalsos: { ...efecto.numerosFalsos } } : {}),
      }))
  }

  finalizar(ganadorId: string | null): void {
    this.estado = 'finished'
    this.ganadorId = ganadorId
    for (const j of this.jugadores) j.ganador = j.id === ganadorId
  }

  marcarDesconectado(jugadorId: string): void {
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (jugador && !jugador.esBot) jugador.conectado = false
  }

  marcarConectado(jugadorId: string, socketId: string): void {
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador || jugador.esBot) return
    jugador.socketId = socketId
    jugador.conectado = true
  }

  humanos(): JugadorSala[] {
    return this.jugadores.filter((j) => !j.esBot)
  }

  vistaPara(usuarioId: string): VistaSala {
    const yo = this.jugadores.find((j) => j.id === usuarioId)
    const ahora = Date.now()
    this.limpiarEfectos(ahora)
    return {
      salaId: this.id,
      estado: this.estado,
      size: this.config.size,
      fondoNivel: this.fondoNivel,
      winModes: [this.metodoVictoria],
      metodosVictoria: [...this.config.winModes],
      maxNumber: this.config.maxNumber,
      calledList: [...this.oraculo.lista],
      lastDrawn: this.oraculo.ultimaBola,
      jugadores: this.jugadores.map((j) => ({
        id: j.id,
        nombre: j.nombre,
        avatarUrl: j.avatarUrl,
        esBot: j.esBot,
        conectado: j.conectado,
        ganador: j.ganador,
        efectos: this.efectosDe(j, ahora),
      })),
      tuCarton: yo ? yo.carton.toSnapshot() : [],
      ganador: this.ganadorId,
    }
  }

  get contexto(): string {
    return `sala ${this.id.slice(0, 8)} (${this.cantidad} jugadores)`
  }

  antiguedadMs(): number {
    return Date.now() - this.creadaEn
  }
}
