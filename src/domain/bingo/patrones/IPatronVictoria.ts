import type { Carton } from '../Carton'
import type { WinMode } from '../tipos'

/**
 * Contrato de un método de victoria (O de SOLID).
 * Un patrón nuevo = una clase nueva; el motor no se toca.
 */
export interface IPatronVictoria {
  readonly id: WinMode
  nombre(): string
  indices(tamano: number): number[][]
  /** true si hay un patrón marcado Y cubierto por el oráculo. */
  indicesGanadores(carton: Carton, cantadas: ReadonlySet<number>): number[] | null
  /** Marcado completo pero alguna bola no ha salido. */
  marcadoSinCantar(carton: Carton, cantadas: ReadonlySet<number>): boolean
}
