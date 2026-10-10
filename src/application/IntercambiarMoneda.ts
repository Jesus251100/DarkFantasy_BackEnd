import type { Campania } from '../domain/campania/Campania'

const RATIO = 50

export class IntercambiarMoneda {
  constructor(private readonly campania: Campania) {}

  diamantesAMonedas(): { ok: boolean; error?: string } {
    if (!this.campania.jugador.gastarDiamantes(1)) {
      return { ok: false, error: 'No tienes diamantes suficientes' }
    }
    this.campania.jugador.ganarMonedas(RATIO)
    this.campania.persistir()
    return { ok: true }
  }

  monedasADiamantes(): { ok: boolean; error?: string } {
    if (!this.campania.jugador.gastarMonedas(RATIO)) {
      return { ok: false, error: 'No tienes monedas suficientes' }
    }
    this.campania.jugador.ganarDiamantes(1)
    this.campania.persistir()
    return { ok: true }
  }
}
