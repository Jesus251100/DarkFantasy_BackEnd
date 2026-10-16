import { Celda } from './Celda'
import { shuffleInPlace } from './geometria'
import type { BingoCell, CardValue, WinResult } from './tipos'
import type { IPatronVictoria } from './patrones/IPatronVictoria'

/** Cartón de bingo: colección de celdas con tamaño fijo. */
export class Carton {
  private constructor(
    private readonly celdas: Celda[],
    readonly tamano: number,
  ) {}

  static desdeValores(values: CardValue[]): Carton {
    const tamano = Math.round(Math.sqrt(values.length))
    return new Carton(values.map((v) => Celda.deValor(v)), tamano)
  }

  static aleatorio(tamano: number, maxNumber: number): Carton {
    return Carton.desdeValores(generarValoresAleatorios(tamano, maxNumber))
  }

  static desdeSnapshot(celdas: BingoCell[], tamano?: number): Carton {
    const size = tamano ?? Math.round(Math.sqrt(celdas.length))
    return new Carton(celdas.map((c) => Celda.desdeSnapshot(c)), size)
  }

  get length(): number {
    return this.celdas.length
  }

  celdaEn(indice: number): Celda | undefined {
    return this.celdas[indice]
  }

  indiceDeNumero(numero: number): number {
    return this.celdas.findIndex((c) => !c.libre && c.numero === numero)
  }

  marcarNumero(numero: number): boolean {
    const i = this.indiceDeNumero(numero)
    if (i < 0) return false
    const celda = this.celdas[i]
    if (!celda || celda.estaMarcada) return false
    celda.marcar()
    return true
  }

  /**
   * Marca/desmarca si la bola ya salió (o si se desmarca un error).
   * Devuelve false si la acción no es legal.
   */
  toggleCelda(indice: number, cantadas: ReadonlySet<number>): boolean {
    const celda = this.celdas[indice]
    if (!celda || celda.libre) return false
    if (!celda.estaMarcada && !cantadas.has(celda.numero)) return false
    celda.toggle()
    return true
  }

  evaluarVictoria(patrones: IPatronVictoria[], cantadas: ReadonlySet<number>): WinResult {
    for (const patron of patrones) {
      const hit = patron.indicesGanadores(this, cantadas)
      if (hit) {
        return { won: true, winningIndices: hit, mode: patron.id }
      }
    }

    for (const patron of patrones) {
      if (patron.marcadoSinCantar(this, cantadas)) {
        return { won: false, winningIndices: [], reason: 'not-called' }
      }
    }

    return { won: false, winningIndices: [], reason: 'no-line' }
  }

  /**
   * Validación autoritativa del servidor: un patrón gana si todas sus celdas
   * están cubiertas por las bolas cantadas, sin depender de las marcas del cliente.
   */
  evaluarVictoriaPorBolas(patrones: IPatronVictoria[], cantadas: ReadonlySet<number>): WinResult {
    for (const patron of patrones) {
      for (const idxs of patron.indices(this.tamano)) {
        const completo = idxs.every((i) => this.celdas[i]?.cubreBola(cantadas) === true)
        if (completo) {
          return { won: true, winningIndices: idxs, mode: patron.id }
        }
      }
    }
    return { won: false, winningIndices: [], reason: 'no-line' }
  }

  progresoMejorPatron(patrones: IPatronVictoria[]): number {
    let best = 0
    for (const patron of patrones) {
      for (const indices of patron.indices(this.tamano)) {
        if (indices.length === 0) continue
        let hit = 0
        for (const i of indices) {
          const celda = this.celdas[i]
          if (celda?.estaMarcada || celda?.libre) hit++
        }
        best = Math.max(best, hit / indices.length)
      }
    }
    return best
  }

  toSnapshot(): BingoCell[] {
    return this.celdas.map((c) => c.toSnapshot())
  }

  toValores(): CardValue[] {
    return this.celdas.map((c) => (c.libre ? 'free' : c.numero))
  }

  clonar(): Carton {
    return new Carton(
      this.celdas.map((c) => c.clonar()),
      this.tamano,
    )
  }
}

export function generarValoresAleatorios(size: number, maxNumber: number): CardValue[] {
  const total = size * size
  const mid = Math.floor(size / 2)
  const center = mid * size + mid
  const useFree = size % 2 === 1 && size >= 5
  const need = useFree ? total - 1 : total
  const cappedMax = Math.max(maxNumber, need)

  const pool = shuffleInPlace(Array.from({ length: cappedMax }, (_, i) => i + 1))
  const values: CardValue[] = []
  let p = 0
  for (let i = 0; i < total; i++) {
    if (useFree && i === center) {
      values.push('free')
      continue
    }
    const n = pool[p++]
    values.push(n ?? i + 1)
  }
  return values
}
