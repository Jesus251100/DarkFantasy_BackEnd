import type { Campania } from '../domain/campania/Campania'
import { MONEDAS_POR_DIAMANTE } from '../domain/campania/ReglasIntercambio'

export class IntercambiarMoneda {
  constructor(private readonly campania: Campania) {}

  diamantesAMonedas(unidades = 1): { ok: boolean; error?: string } {
    const n = Math.floor(unidades)
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: 'Elige al menos un diamante' }
    }
    if (!this.campania.jugador.gastarDiamantes(n)) {
      return { ok: false, error: 'No tienes diamantes suficientes' }
    }
    this.campania.jugador.ganarMonedas(n * MONEDAS_POR_DIAMANTE)
    this.campania.persistir()
    return { ok: true }
  }

  monedasADiamantes(unidades = 1): { ok: boolean; error?: string } {
    const n = Math.floor(unidades)
    if (!Number.isInteger(n) || n < 1) {
      return { ok: false, error: 'Elige al menos un diamante' }
    }
    if (!this.campania.jugador.gastarMonedas(n * MONEDAS_POR_DIAMANTE)) {
      return { ok: false, error: 'No tienes monedas suficientes' }
    }
    this.campania.jugador.ganarDiamantes(n)
    this.campania.persistir()
    return { ok: true }
  }
}
