import type { Recompensa } from './Recompensa'

export type StockBoosters = Record<string, number>

/** Jugador de la campaña: nombre, monedas, diamantes e inventario. */
export class Jugador {
  constructor(
    public nombre: string,
    public monedas: number,
    public diamantes: number,
    public boosters: StockBoosters,
  ) {}

  static inicial(): Jugador {
    return new Jugador('Jugador', 0, 0, { '1': 0, '2': 0, '3': 0, '4': 0 })
  }

  gastarMonedas(amount: number): boolean {
    if (amount <= 0) return true
    if (this.monedas < amount) return false
    this.monedas -= amount
    return true
  }

  gastarDiamantes(amount: number): boolean {
    if (amount <= 0) return true
    if (this.diamantes < amount) return false
    this.diamantes -= amount
    return true
  }

  ganarMonedas(amount: number): void {
    if (amount > 0) this.monedas += amount
  }

  ganarDiamantes(amount: number): void {
    if (amount > 0) this.diamantes += amount
  }

  recibir(recompensa: Recompensa): void {
    this.ganarMonedas(recompensa.monedas)
    this.ganarDiamantes(recompensa.diamantes)
  }

  cantidadBooster(id: number): number {
    return this.boosters[String(id)] ?? 0
  }

  agregarBooster(id: number, qty: number): void {
    if (qty <= 0) return
    const key = String(id)
    this.boosters[key] = (this.boosters[key] ?? 0) + qty
  }

  setNombre(name: string): void {
    const next = name.trim()
    if (!next) return
    this.nombre = next.slice(0, 40)
  }
}
