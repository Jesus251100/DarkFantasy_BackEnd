import { Carton } from '../bingo/Carton'
import { Oraculo } from '../bingo/Oraculo'
import { patronesDesdeModos } from '../bingo/patrones/catalogoPatrones'
import type { IPatronVictoria } from '../bingo/patrones/IPatronVictoria'
import type { BingoCell, WinMode, WinResult } from '../bingo/tipos'
import type { ConfigOnline } from './ConfigOnline'

export type EstadoSala = 'waiting' | 'playing' | 'finished'

export interface JugadorSala {
  id: string
  nombre: string
  socketId: string | null
  esBot: boolean
  conectado: boolean
  carton: Carton
  ganador: boolean
}

export interface JugadorVista {
  id: string
  nombre: string
  esBot: boolean
  conectado: boolean
  ganador: boolean
}

export interface VistaSala {
  salaId: string
  estado: EstadoSala
  size: number
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

  agregarJugador(id: string, nombre: string, esBot: boolean, socketId: string | null = null): void {
    this.jugadores.push({
      id,
      nombre,
      esBot,
      socketId,
      conectado: true,
      carton: Carton.aleatorio(this.config.size, this.config.maxNumber),
      ganador: false,
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
    return this.oraculo.cantar()
  }

  /** Validación autoritativa: ¿completó algún patrón con las bolas cantadas? */
  reclamar(jugadorId: string): WinResult | null {
    if (this.estado !== 'playing') return null
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador) return null
    return jugador.carton.evaluarVictoriaPorBolas(this.patrones, this.oraculo.conjunto)
  }

  botCompleta(jugadorId: string): boolean {
    const jugador = this.jugadores.find((j) => j.id === jugadorId)
    if (!jugador) return false
    return jugador.carton.evaluarVictoriaPorBolas(this.patrones, this.oraculo.conjunto).won
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

  humanos(): JugadorSala[] {
    return this.jugadores.filter((j) => !j.esBot)
  }

  vistaPara(usuarioId: string): VistaSala {
    const yo = this.jugadores.find((j) => j.id === usuarioId)
    return {
      salaId: this.id,
      estado: this.estado,
      size: this.config.size,
      winModes: [this.metodoVictoria],
      metodosVictoria: [...this.config.winModes],
      maxNumber: this.config.maxNumber,
      calledList: [...this.oraculo.lista],
      lastDrawn: this.oraculo.ultimaBola,
      jugadores: this.jugadores.map((j) => ({
        id: j.id,
        nombre: j.nombre,
        esBot: j.esBot,
        conectado: j.conectado,
        ganador: j.ganador,
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
