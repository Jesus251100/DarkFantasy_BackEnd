import type { Campania } from '../domain/campania/Campania'
import { CatalogoBoosters } from '../domain/boosters/CatalogoBoosters'

export class ComprarBooster {
  constructor(private readonly campania: Campania) {}

  ejecutar(id: number, cantidad: number): { ok: boolean; error?: string; nombre?: string } {
    const booster = CatalogoBoosters.porId(id)
    if (!booster) return { ok: false, error: 'Booster desconocido' }
    const qty = Math.max(1, Math.floor(cantidad))
    const total = booster.precio * qty
    const ok =
      booster.moneda === 'diamonds'
        ? this.campania.jugador.gastarDiamantes(total)
        : this.campania.jugador.gastarMonedas(total)
    if (!ok) {
      return {
        ok: false,
        error: booster.moneda === 'diamonds' ? 'Diamantes insuficientes' : 'Monedas insuficientes',
      }
    }
    this.campania.jugador.agregarBooster(booster.id, qty)
    this.campania.persistir()
    return { ok: true, nombre: booster.nombre }
  }
}
