import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { OperacionRevertida } from '../domain/campania/OperacionRevertida'
import { CargadorCampania } from './CargadorCampania'
import { IntercambiarMoneda } from './IntercambiarMoneda'

export class IntercambiarMonedaRemoto {
  private readonly cargador: CargadorCampania

  constructor(private readonly campanias: IRepositorioCampaniaUsuario) {
    this.cargador = new CargadorCampania(campanias)
  }

  async ejecutar(
    usuarioId: string,
    modo: 'diamonds-to-coins' | 'coins-to-diamonds',
  ): Promise<{ ok: true; campania: DatosCampania } | { ok: false; error: string }> {
    const campania = await this.cargador.abrir(usuarioId)
    if (!campania) return { ok: false, error: 'Usuario no encontrado.' }
    const antesMonedas = campania.jugador.monedas
    const antesDiamantes = campania.jugador.diamantes
    const caso = new IntercambiarMoneda(campania)
    const result =
      modo === 'diamonds-to-coins' ? caso.diamantesAMonedas() : caso.monedasADiamantes()
    if (!result.ok) return { ok: false, error: result.error ?? 'No se pudo intercambiar' }
    try {
      const datos = await this.campanias.guardar(usuarioId, campania.toDatos(), {
        tipo: 'intercambio',
        deltaMonedas: campania.jugador.monedas - antesMonedas,
        deltaDiamantes: campania.jugador.diamantes - antesDiamantes,
        detalle:
          modo === 'coins-to-diamonds'
            ? '50 monedas → 1 diamante'
            : '1 diamante → 50 monedas',
      })
      return { ok: true, campania: datos }
    } catch (error) {
      if (error instanceof OperacionRevertida) return { ok: false, error: error.message }
      throw error
    }
  }
}
