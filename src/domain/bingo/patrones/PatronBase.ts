import type { Carton } from '../Carton'
import type { WinMode } from '../tipos'
import type { IPatronVictoria } from './IPatronVictoria'

/** Plantilla común: las hijas solo definen id, nombre e índices (Liskov). */
export abstract class PatronBase implements IPatronVictoria {
  abstract readonly id: WinMode
  abstract nombre(): string
  abstract indices(tamano: number): number[][]

  indicesGanadores(carton: Carton, cantadas: ReadonlySet<number>): number[] | null {
    for (const idxs of this.indices(carton.tamano)) {
      if (this.todasMarcadas(carton, idxs) && this.todasCantadas(carton, idxs, cantadas)) {
        return idxs
      }
    }
    return null
  }

  marcadoSinCantar(carton: Carton, cantadas: ReadonlySet<number>): boolean {
    for (const idxs of this.indices(carton.tamano)) {
      if (this.todasMarcadas(carton, idxs) && !this.todasCantadas(carton, idxs, cantadas)) {
        return true
      }
    }
    return false
  }

  private todasMarcadas(carton: Carton, idxs: number[]): boolean {
    return idxs.every((i) => carton.celdaEn(i)?.estaMarcada === true)
  }

  private todasCantadas(
    carton: Carton,
    idxs: number[],
    cantadas: ReadonlySet<number>,
  ): boolean {
    return idxs.every((i) => carton.celdaEn(i)?.cubreBola(cantadas) === true)
  }
}
