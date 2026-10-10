import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { CargadorCampania } from './CargadorCampania'

export class ActualizarNombre {
  private readonly cargador: CargadorCampania

  constructor(private readonly campanias: IRepositorioCampaniaUsuario) {
    this.cargador = new CargadorCampania(campanias)
  }

  async ejecutar(usuarioId: string, nombre: string): Promise<DatosCampania | null> {
    const campania = await this.cargador.abrir(usuarioId)
    if (!campania) return null
    campania.jugador.setNombre(nombre)
    campania.persistir()
    return this.campanias.guardar(usuarioId, campania.toDatos())
  }
}
