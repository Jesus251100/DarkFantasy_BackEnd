import { Campania } from '../domain/campania/Campania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { RepoMemoriaCampania } from '../domain/campania/RepoMemoriaCampania'

/** Reconstruye la entidad Campania desde el puerto de persistencia. */
export class CargadorCampania {
  constructor(private readonly repo: IRepositorioCampaniaUsuario) {}

  async abrir(usuarioId: string): Promise<Campania | null> {
    const datos = await this.repo.obtener(usuarioId)
    if (!datos) return null
    return new Campania(new RepoMemoriaCampania(datos))
  }
}
