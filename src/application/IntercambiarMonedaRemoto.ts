import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { OperacionRevertida } from '../domain/campania/OperacionRevertida'

export class IntercambiarMonedaRemoto {
  constructor(private readonly campanias: IRepositorioCampaniaUsuario) {
  }

  async ejecutar(
    usuarioId: string,
    modo: 'diamonds-to-coins' | 'coins-to-diamonds',
  ): Promise<{ ok: true; campania: DatosCampania } | { ok: false; error: string }> {
    try {
      return { ok: true, campania: await this.campanias.intercambiar(usuarioId, modo) }
    } catch (error) {
      if (error instanceof OperacionRevertida) return { ok: false, error: error.message }
      throw error
    }
  }
}
