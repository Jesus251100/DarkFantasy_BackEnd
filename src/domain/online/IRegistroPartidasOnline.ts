import type { BingoCell, WinMode } from '../bingo/tipos'

export interface JugadorResultadoOnline {
  id: string
  nombre: string
  esBot: boolean
  gano: boolean
  carton: BingoCell[]
}

export interface ResultadoOnline {
  salaId: string
  size: number
  winModes: WinMode[]
  ganadorId: string | null
  ganadorNombre: string | null
  duracionSeg: number
  apuesta: number
  jugadores: JugadorResultadoOnline[]
}

/** Puerto de persistencia de partidas online. */
export interface IRegistroPartidasOnline {
  registrar(resultado: ResultadoOnline): Promise<{ recompensaMonedas: number }>
  penalizarAbandono(usuarioId: string, salaId: string): Promise<void>
  obtenerPuntosRanking(usuarioId: string): Promise<number>
  /** Null si todos pueden pagar. Si no, el texto para mostrar en la sala. */
  puedenPagar(usuarioIds: string[], monto: number): Promise<string | null>
  /** Cobra a todos o a ninguno. */
  cobrarApuesta(usuarioIds: string[], monto: number, codigo: string): Promise<{ ok: true } | { ok: false; error: string }>
}
