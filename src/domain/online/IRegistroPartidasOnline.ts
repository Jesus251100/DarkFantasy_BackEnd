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
  jugadores: JugadorResultadoOnline[]
  apuestas: Record<string, number>
}

/** Puerto de persistencia de partidas online. */
export interface IRegistroPartidasOnline {
  cobrarApuestas(salaId: string, apuestas: Record<string, number>): Promise<void>
  registrar(resultado: ResultadoOnline): Promise<{ recompensaMonedas: number }>
  penalizarAbandono(usuarioId: string, salaId: string): Promise<void>
  obtenerPuntosRanking(usuarioId: string): Promise<number>
}
