import { shuffleInPlace } from './geometria'

/** Bolsa de bolas del oráculo. Una responsabilidad: barajar y sacar. */
export class Bolsa {
  private constructor(private restantes: number[]) {}

  static deRango(maxNumber: number): Bolsa {
    return new Bolsa(shuffleInPlace(Array.from({ length: maxNumber }, (_, i) => i + 1)))
  }

  static dePool(pool: number[]): Bolsa {
    return new Bolsa(shuffleInPlace([...pool]))
  }

  static desdeRestantes(restantes: number[]): Bolsa {
    return new Bolsa([...restantes])
  }

  quedan(): boolean {
    return this.restantes.length > 0
  }

  sacar(): number | null {
    const n = this.restantes.shift()
    return n ?? null
  }

  toArray(): number[] {
    return [...this.restantes]
  }
}
