import type { WinMode } from '../bingo/tipos'

/** Reglas fijas de una partida online. */
export interface ConfigOnline {
  size: number
  maxNumber: number
  winModes: WinMode[]
  drawIntervalMs: number
  /** Retardo antes de la primera bola (deja ver la ruleta del método). */
  revealDelayMs: number
  minPlayers: number
  maxPlayers: number
  /** Tiempo máximo en cola antes de rellenar con bots. */
  fillWithBotsAfterMs: number
  /** Retardo base con el que un bot canta BINGO. */
  botClaimDelayMs: number
}

export const CONFIG_ONLINE: ConfigOnline = {
  size: 5,
  maxNumber: 75,
  winModes: ['row', 'column', 'diagonal'],
  drawIntervalMs: 3000,
  revealDelayMs: 7200,
  minPlayers: 2,
  maxPlayers: 4,
  fillWithBotsAfterMs: 10_000,
  botClaimDelayMs: 900,
}

export const MENSAJE_SIN_JUGADORES = 'No hay suficientes jugadores para iniciar'

export const NOMBRES_BOT = [
  'Arzobispo Pérez',
  'Bruja Envidia',
  'Dragón Ancestral',
  'Santo Espada',
  'Jhon Blacked',
  'Noob Master',
]
