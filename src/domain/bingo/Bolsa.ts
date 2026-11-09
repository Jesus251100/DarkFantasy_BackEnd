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

  sacarConPreferencias(preferidos: readonly number[], evitados: readonly number[], probabilidad: number): number | null {
    if (this.restantes.length === 0) return null
    const preferidosSet = new Set(preferidos)
    const evitadosSet = new Set(evitados)
    const buenos = this.restantes.flatMap((numero, indice) => preferidosSet.has(numero) ? [indice] : [])
    const neutros = this.restantes.flatMap((numero, indice) =>
      !preferidosSet.has(numero) && !evitadosSet.has(numero) ? [indice] : [],
    )
    const elegir = (indices: number[]) => indices[Math.floor(Math.random() * indices.length)]
    const candidato = buenos.length && Math.random() < probabilidad
      ? elegir(buenos)
      : neutros.length
        ? elegir(neutros)
        : evitadosSet.size
          ? elegir(this.restantes.flatMap((numero, indice) => evitadosSet.has(numero) ? [indice] : []))
          : Math.floor(Math.random() * this.restantes.length)
    if (candidato === undefined) return this.sacar()
    return this.restantes.splice(candidato, 1)[0] ?? null
  }

  toArray(): number[] {
    return [...this.restantes]
  }
}
