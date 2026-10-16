import type { WinMode } from './tipos'
import { patronDesdeModo } from './patrones/catalogoPatrones'

export function nombreMetodo(mode: WinMode): string {
  return patronDesdeModo(mode).nombre()
}

const CORTOS: Record<WinMode, string> = {
  row: 'FILA',
  column: 'COL',
  diagonal: 'DIAG',
  L: 'L',
  O: 'O',
  plus: 'CRUZ',
  X: 'X',
  T: 'T',
  arrow: 'FLECHA',
  H: 'H',
  diamond: 'DIAMANTE',
  zigzag: 'ZIGZAG',
  full: 'LLENO',
  crown: 'CORONA',
}

export function nombreCorto(mode: WinMode): string {
  return CORTOS[mode] ?? nombreMetodo(mode).toUpperCase()
}

export function etiquetaMetodos(modes: WinMode[], ruleta = false): string {
  const names = modes.map(nombreMetodo)
  if (names.length === 0) return 'Método de victoria'
  const lista =
    names.length === 1
      ? names[0]
      : names.length === 2
        ? `${names[0]} o ${names[1]}`
        : `${names.slice(0, -1).join(', ')} o ${names[names.length - 1]}`
  return ruleta ? `Ruleta: ${lista}` : `Método: ${lista}`
}
