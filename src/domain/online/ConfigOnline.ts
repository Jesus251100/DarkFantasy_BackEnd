import type { WinMode } from '../bingo/tipos'

export type ModoMesa = 'mesa' | 'pvp' | 'equipos'
export type CupoMesa = 2 | 4 | 6 | 8

export interface MesaElegida {
  modo: ModoMesa
  cupo: CupoMesa
}

/** Acepta PvP de 2, equipos 2 vs 2 o mesas estándar de 4, 6 u 8. */
export function mesaValida(modo: unknown, cupo: unknown): MesaElegida | null {
  const tamaño = Number(cupo)
  if (modo === 'pvp' && tamaño === 2) return { modo: 'pvp', cupo: 2 }
  if (modo === 'equipos' && tamaño === 4) return { modo, cupo: 4 }
  if (modo === 'mesa' && (tamaño === 4 || tamaño === 6 || tamaño === 8)) {
    return { modo, cupo: tamaño }
  }
  return null
}

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
  /** Ventana para restaurar una sesión tras recargar o perder conexión. */
  reconnectGraceMs: number
  /** Retardo base con el que un bot canta BINGO. */
  botClaimDelayMs: number
}

export const CONFIG_ONLINE: ConfigOnline = {
  size: 5,
  maxNumber: 75,
  winModes: [
    'row',
    'column',
    'diagonal',
    'L',
    'O',
    'plus',
    'X',
    'T',
    'arrow',
    'H',
    'diamond',
    'zigzag',
    'full',
    'crown',
  ],
  drawIntervalMs: 3000,
  revealDelayMs: 10000,
  minPlayers: 2,
  maxPlayers: 4,
  fillWithBotsAfterMs: 60_000,
  reconnectGraceMs: 45_000,
  botClaimDelayMs: 900,
}

export function configPara(mesa: MesaElegida, base: ConfigOnline = CONFIG_ONLINE): ConfigOnline {
  return { ...base, maxPlayers: mesa.modo === 'equipos' ? 4 : mesa.cupo, minPlayers: 2 }
}

export const MENSAJE_SIN_JUGADORES = 'No hay suficientes jugadores para iniciar'

export const NOMBRES_BOT = [
  'Arzobispo Pérez',
  'Bruja Envidia',
  'Dragón Ancestral',
  'Santo Espada',
  'Custodio del Alba',
  'Sombra del Relicario',
  'Hereje Dorado',
  'Vigía de la Cripta',
]
