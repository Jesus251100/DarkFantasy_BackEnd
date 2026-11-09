import { LOGROS, type DefinicionLogro } from '../domain/logros/Logros'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { CargadorCampania } from './CargadorCampania'

export interface LogroVista extends DefinicionLogro {
  desbloqueado: boolean
  progresoActual: number
}

/** Catálogo de logros con el estado real del jugador. */
export class ListarLogros {
  private readonly cargador: CargadorCampania
  private readonly campanias: IRepositorioCampaniaUsuario

  constructor(campanias: IRepositorioCampaniaUsuario) {
    this.campanias = campanias
    this.cargador = new CargadorCampania(campanias)
  }

  async ejecutar(usuarioId: string): Promise<LogroVista[] | null> {
    const campania = await this.cargador.abrir(usuarioId)
    if (!campania) return null
    const completados = new Set(campania.completed)
    const eventos = new Set(await this.campanias.listarCodigosLogro(usuarioId))
    const victoriasOnline = await this.campanias.contarVictoriasOnline(usuarioId)
    return LOGROS.map((logro) => {
      const objetivo = logro.objetivo ?? 1
      const progresoActual = logro.codigo === 'racha-online'
        ? Math.min(objetivo, victoriasOnline)
        : ((logro.nivel === null ? eventos.has(logro.codigo) : completados.has(logro.nivel)) ? objetivo : 0)
      return { ...logro, progresoActual, desbloqueado: progresoActual >= objetivo }
    })
  }
}
