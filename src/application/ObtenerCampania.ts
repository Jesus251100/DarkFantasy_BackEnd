import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { CargadorCampania } from './CargadorCampania'

export class ObtenerCampania {
  private readonly cargador: CargadorCampania

  constructor(repo: IRepositorioCampaniaUsuario) {
    this.cargador = new CargadorCampania(repo)
  }

  async ejecutar(usuarioId: string): Promise<DatosCampania | null> {
    const campania = await this.cargador.abrir(usuarioId)
    return campania?.toDatos() ?? null
  }
}
