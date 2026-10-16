import type { WinMode } from '../tipos'
import type { IPatronVictoria } from './IPatronVictoria'
import {
  PatronCartonCompleto,
  PatronColumna,
  PatronCorona,
  PatronCruz,
  PatronDiagonal,
  PatronDiamante,
  PatronFila,
  PatronFlecha,
  PatronH,
  PatronL,
  PatronO,
  PatronT,
  PatronX,
  PatronZigzag,
} from './patrones'

/** Fábrica: modo → clase. Cerrado a modificación, abierto a un case nuevo. */
const FABRICA: Record<WinMode, () => IPatronVictoria> = {
  row: () => new PatronFila(),
  column: () => new PatronColumna(),
  diagonal: () => new PatronDiagonal(),
  L: () => new PatronL(),
  O: () => new PatronO(),
  plus: () => new PatronCruz(),
  X: () => new PatronX(),
  T: () => new PatronT(),
  arrow: () => new PatronFlecha(),
  H: () => new PatronH(),
  diamond: () => new PatronDiamante(),
  zigzag: () => new PatronZigzag(),
  full: () => new PatronCartonCompleto(),
  crown: () => new PatronCorona(),
}

export function patronDesdeModo(mode: WinMode): IPatronVictoria {
  const crear = FABRICA[mode]
  if (!crear) throw new Error(`Patrón desconocido: ${mode}`)
  return crear()
}

export function patronesDesdeModos(modes: WinMode[]): IPatronVictoria[] {
  return modes.map((m) => patronDesdeModo(m))
}
