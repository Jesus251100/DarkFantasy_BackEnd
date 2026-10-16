import { Bolsa } from './Bolsa'

/** Canta bolas y recuerda las ya salidas. No conoce el cartón. */
export class Oraculo {
  private cantadas: number[] = []
  private ultima: number | null = null

  constructor(private bolsa: Bolsa) {}

  static nuevo(maxNumber: number, pool?: number[]): Oraculo {
    const bolsa = pool && pool.length > 0 ? Bolsa.dePool(pool) : Bolsa.deRango(maxNumber)
    return new Oraculo(bolsa)
  }

  static restaurar(cantadas: number[], restantes: number[], ultima: number | null): Oraculo {
    const o = new Oraculo(Bolsa.desdeRestantes(restantes))
    o.cantadas = [...cantadas]
    o.ultima = ultima
    return o
  }

  cantar(): number | null {
    const n = this.bolsa.sacar()
    if (n === null) return null
    this.cantadas.push(n)
    this.ultima = n
    return n
  }

  yaCanto(n: number): boolean {
    return this.conjunto.has(n)
  }

  get conjunto(): ReadonlySet<number> {
    return new Set(this.cantadas)
  }

  get lista(): readonly number[] {
    return this.cantadas
  }

  get ultimaBola(): number | null {
    return this.ultima
  }

  get restantes(): number[] {
    return this.bolsa.toArray()
  }

  quedanBolas(): boolean {
    return this.bolsa.quedan()
  }
}
