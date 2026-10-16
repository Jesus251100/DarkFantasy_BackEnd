import {
  arrowIndices,
  columnIndices,
  crownIndices,
  diagonalIndices,
  diamondIndices,
  fullCardIndices,
  hShapeIndices,
  lShapeIndices,
  oShapeIndices,
  plusIndices,
  rowIndices,
  tShapeIndices,
  xShapeIndices,
  zigzagIndices,
} from '../geometria'
import type { WinMode } from '../tipos'
import { PatronBase } from './PatronBase'

export class PatronFila extends PatronBase {
  readonly id: WinMode = 'row'
  nombre() {
    return 'Fila'
  }
  indices(tamano: number) {
    return rowIndices(tamano)
  }
}

export class PatronColumna extends PatronBase {
  readonly id: WinMode = 'column'
  nombre() {
    return 'Columna'
  }
  indices(tamano: number) {
    return columnIndices(tamano)
  }
}

export class PatronDiagonal extends PatronBase {
  readonly id: WinMode = 'diagonal'
  nombre() {
    return 'Diagonal'
  }
  indices(tamano: number) {
    return diagonalIndices(tamano)
  }
}

export class PatronL extends PatronBase {
  readonly id: WinMode = 'L'
  nombre() {
    return 'Forma L'
  }
  indices(tamano: number) {
    return lShapeIndices(tamano)
  }
}

export class PatronO extends PatronBase {
  readonly id: WinMode = 'O'
  nombre() {
    return 'Marco O'
  }
  indices(tamano: number) {
    return oShapeIndices(tamano)
  }
}

export class PatronCruz extends PatronBase {
  readonly id: WinMode = 'plus'
  nombre() {
    return 'Cruz (+)'
  }
  indices(tamano: number) {
    return plusIndices(tamano)
  }
}

export class PatronX extends PatronBase {
  readonly id: WinMode = 'X'
  nombre() {
    return 'Letra X'
  }
  indices(tamano: number) {
    return xShapeIndices(tamano)
  }
}

export class PatronT extends PatronBase {
  readonly id: WinMode = 'T'
  nombre() {
    return 'Forma T'
  }
  indices(tamano: number) {
    return tShapeIndices(tamano)
  }
}

export class PatronFlecha extends PatronBase {
  readonly id: WinMode = 'arrow'
  nombre() {
    return 'Flecha'
  }
  indices(tamano: number) {
    return arrowIndices(tamano)
  }
}

export class PatronH extends PatronBase {
  readonly id: WinMode = 'H'
  nombre() {
    return 'Forma H'
  }
  indices(tamano: number) {
    return hShapeIndices(tamano)
  }
}

export class PatronDiamante extends PatronBase {
  readonly id: WinMode = 'diamond'
  nombre() {
    return 'Diamante'
  }
  indices(tamano: number) {
    return diamondIndices(tamano)
  }
}

export class PatronZigzag extends PatronBase {
  readonly id: WinMode = 'zigzag'
  nombre() {
    return 'Zigzag'
  }
  indices(tamano: number) {
    return zigzagIndices(tamano)
  }
}

export class PatronCartonCompleto extends PatronBase {
  readonly id: WinMode = 'full'
  nombre() {
    return 'Cartón completo'
  }
  indices(tamano: number) {
    return fullCardIndices(tamano)
  }
}

export class PatronCorona extends PatronBase {
  readonly id: WinMode = 'crown'
  nombre() {
    return 'Corona'
  }
  indices(tamano: number) {
    return crownIndices(tamano)
  }
}
