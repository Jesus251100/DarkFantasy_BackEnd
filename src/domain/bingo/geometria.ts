/** Índices de celdas por forma. Funciones puras usadas por las clases de patrón. */

export function rowIndices(size: number): number[][] {
  return Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) => r * size + c),
  )
}

export function columnIndices(size: number): number[][] {
  return Array.from({ length: size }, (_, c) =>
    Array.from({ length: size }, (_, r) => r * size + c),
  )
}

export function diagonalIndices(size: number): number[][] {
  const main = Array.from({ length: size }, (_, i) => i * size + i)
  const anti = Array.from({ length: size }, (_, i) => i * size + (size - 1 - i))
  return [main, anti]
}

export function lShapeIndices(size: number): number[][] {
  const last = size - 1
  function edgeL(col: number, row: number): number[] {
    const set = new Set<number>()
    for (let r = 0; r < size; r++) set.add(r * size + col)
    for (let c = 0; c < size; c++) set.add(row * size + c)
    return [...set]
  }
  return [edgeL(0, last), edgeL(0, 0), edgeL(last, last), edgeL(last, 0)]
}

export function oShapeIndices(size: number): number[][] {
  if (size < 2) return []
  const set = new Set<number>()
  for (let c = 0; c < size; c++) {
    set.add(c)
    set.add((size - 1) * size + c)
  }
  for (let r = 0; r < size; r++) {
    set.add(r * size)
    set.add(r * size + (size - 1))
  }
  return [[...set]]
}

export function plusIndices(size: number): number[][] {
  const mid = Math.floor(size / 2)
  const set = new Set<number>()
  for (let c = 0; c < size; c++) set.add(mid * size + c)
  for (let r = 0; r < size; r++) set.add(r * size + mid)
  return [[...set]]
}

export function tShapeIndices(size: number): number[][] {
  const mid = Math.floor(size / 2)
  const last = size - 1
  const top = Array.from({ length: size }, (_, c) => c)
  const bottom = Array.from({ length: size }, (_, c) => last * size + c)
  const left = Array.from({ length: size }, (_, r) => r * size)
  const right = Array.from({ length: size }, (_, r) => r * size + last)
  const midCol = Array.from({ length: size }, (_, r) => r * size + mid)
  const midRow = Array.from({ length: size }, (_, c) => mid * size + c)
  const merge = (a: number[], b: number[]) => [...new Set([...a, ...b])]
  return [
    merge(top, midCol),
    merge(bottom, midCol),
    merge(left, midRow),
    merge(right, midRow),
  ]
}

function rotateCw(indices: number[], size: number): number[] {
  return indices.map((i) => {
    const r = Math.floor(i / size)
    const c = i % size
    return c * size + (size - 1 - r)
  })
}

export function arrowIndices(size: number): number[][] {
  const mid = Math.floor(size / 2)
  const up = new Set<number>()
  for (let r = 0; r < size; r++) up.add(r * size + mid)
  for (let d = 0; d <= mid; d++) {
    const r = d
    for (let c = mid - d; c <= mid + d; c++) {
      if (c >= 0 && c < size) up.add(r * size + c)
    }
  }
  let current = [...up]
  const patterns: number[][] = [current]
  for (let k = 0; k < 3; k++) {
    current = rotateCw(current, size)
    patterns.push([...new Set(current)])
  }
  return patterns
}

export function hShapeIndices(size: number): number[][] {
  const mid = Math.floor(size / 2)
  const last = size - 1
  const upright = new Set<number>()
  for (let r = 0; r < size; r++) {
    upright.add(r * size)
    upright.add(r * size + last)
  }
  for (let c = 0; c < size; c++) upright.add(mid * size + c)

  const side = new Set<number>()
  for (let c = 0; c < size; c++) {
    side.add(c)
    side.add(last * size + c)
  }
  for (let r = 0; r < size; r++) side.add(r * size + mid)

  return [[...upright], [...side]]
}

export function zigzagIndices(size: number): number[][] {
  const last = size - 1
  const z = new Set<number>()
  const s = new Set<number>()
  for (let c = 0; c < size; c++) {
    z.add(c)
    z.add(last * size + c)
    s.add(c)
    s.add(last * size + c)
  }
  for (let i = 0; i < size; i++) {
    z.add(i * size + (last - i))
    s.add(i * size + i)
  }
  return [[...z], [...s]]
}

/** Letra X: las dos diagonales a la vez. */
export function xShapeIndices(size: number): number[][] {
  const diags = diagonalIndices(size)
  return [[...new Set(diags.flat())]]
}

/** Diamante (rombo) con distancia Manhattan al centro. */
export function diamondIndices(size: number): number[][] {
  const mid = Math.floor(size / 2)
  const set = new Set<number>()
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (Math.abs(r - mid) + Math.abs(c - mid) === mid) {
        set.add(r * size + c)
      }
    }
  }
  if (set.size === 0) set.add(0)
  return [[...set]]
}

export function fullCardIndices(size: number): number[][] {
  return [Array.from({ length: size * size }, (_, i) => i)]
}

export function crownIndices(size: number): number[][] {
  const set = new Set<number>()
  const last = size - 1
  for (let c = 0; c < size; c++) {
    if (c % 2 === 1 || c === 0 || c === last) set.add(c)
  }
  for (let c = 0; c < size; c++) set.add(size + c)
  const mid = Math.floor(size / 2)
  for (let r = 2; r <= Math.min(3, last); r++) {
    for (let c = mid - 1; c <= mid + (size >= 6 ? 1 : 0); c++) {
      if (c >= 0 && c < size) set.add(r * size + c)
    }
  }
  if (size >= 5) {
    for (let c = 1; c < last; c++) set.add(last * size + c)
  } else {
    for (let c = 0; c < size; c++) set.add(last * size + c)
  }
  return [[...set]]
}

export function shuffleInPlace<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const a = items[i]
    const b = items[j]
    if (a === undefined || b === undefined) continue
    items[i] = b
    items[j] = a
  }
  return items
}
