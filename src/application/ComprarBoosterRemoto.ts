import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { OperacionRevertida } from '../domain/campania/OperacionRevertida'
import { CargadorCampania } from './CargadorCampania'
import { ComprarBooster } from './ComprarBooster'

/** Orquesta el caso de compra y lo persiste (S de SOLID: HTTP no compra). */
export class ComprarBoosterRemoto {
  private readonly cargador: CargadorCampania

  constructor(private readonly campanias: IRepositorioCampaniaUsuario) {
    this.cargador = new CargadorCampania(campanias)
  }

  async ejecutar(
    usuarioId: string,
    id: number,
    cantidad: number,
  ): Promise<{ ok: true; nombre?: string; campania: DatosCampania } | { ok: false; error: string }> {
    const campania = await this.cargador.abrir(usuarioId)
    if (!campania) return { ok: false, error: 'Usuario no encontrado.' }
    const antesMonedas = campania.jugador.monedas
    const antesDiamantes = campania.jugador.diamantes
    const compra = new ComprarBooster(campania).ejecutar(id, cantidad)
    if (!compra.ok) return { ok: false, error: compra.error ?? 'No se pudo comprar' }
    try {
      const datos = await this.campanias.guardar(usuarioId, campania.toDatos(), {
        tipo: 'compra',
        deltaMonedas: campania.jugador.monedas - antesMonedas,
        deltaDiamantes: campania.jugador.diamantes - antesDiamantes,
        detalle: `Compra de ${Math.max(1, Math.floor(cantidad))} ${compra.nombre ?? 'booster'}`,
      })
      return { ok: true, nombre: compra.nombre, campania: datos }
    } catch (error) {
      if (error instanceof OperacionRevertida) return { ok: false, error: error.message }
      throw error
    }
  }
}
