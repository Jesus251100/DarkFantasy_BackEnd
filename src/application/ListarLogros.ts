import { LOGROS, type DefinicionLogro } from '../domain/logros/Logros'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { CargadorCampania } from './CargadorCampania'

export interface LogroVista extends DefinicionLogro {
  desbloqueado: boolean
}

/** Catálogo de logros con el estado real del jugador. */
export class ListarLogros {
  private readonly cargador: CargadorCampania

  constructor(campanias: IRepositorioCampaniaUsuario) {
    this.cargador = new CargadorCampania(campanias)
  }

  async ejecutar(usuarioId: string): Promise<LogroVista[] | null> {
    const campania = await this.cargador.abrir(usuarioId)
    if (!campania) return null
    const completados = new Set(campania.completed)
    return LOGROS.map((logro) => ({
      ...logro,
      desbloqueado: completados.has(logro.nivel),
    }))
  }
}
