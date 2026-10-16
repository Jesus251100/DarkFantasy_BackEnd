/** Tipos del dominio de bingo. Espejo del frontend para el modo online. */

export type WinMode =
  | 'row'
  | 'column'
  | 'diagonal'
  | 'L'
  | 'O'
  | 'plus'
  | 'X'
  | 'T'
  | 'arrow'
  | 'H'
  | 'diamond'
  | 'zigzag'
  | 'full'
  | 'crown'

export type CardValue = number | 'free'

export interface BingoCell {
  number: number
  free: boolean
  marked: boolean
}

export interface WinResult {
  won: boolean
  winningIndices: number[]
  mode?: WinMode
  reason?: 'no-line' | 'not-called' | 'already-ended'
}

export type EstadoPartida = 'idle' | 'playing' | 'paused' | 'won' | 'lost'
