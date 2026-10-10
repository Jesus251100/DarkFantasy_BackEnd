import type { ResultadoClear } from '../domain/campania/Campania'
import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { IRepositorioCampaniaUsuario } from '../domain/campania/IRepositorioCampaniaUsuario'
import { OperacionRevertida } from '../domain/campania/OperacionRevertida'
import type { IRegistroPartidas } from '../domain/partida/IRegistroPartidas'
import { CargadorCampania } from './CargadorCampania'

export class CompletarNivel {
  private readonly cargador: CargadorCampania

  constructor(
    private readonly campanias: IRepositorioCampaniaUsuario,
    private readonly partidas: IRegistroPartidas,
  ) {
    this.cargador = new CargadorCampania(campanias)
  }

  async ejecutar(
    usuarioId: string,
    nivel: number,
  ): Promise<
    { resultado: ResultadoClear; campania: DatosCampania } | { error: string } | null
  > {
    const campania = await this.cargador.abrir(usuarioId)
    if (!campania) return null
    const antesMonedas = campania.jugador.monedas
    const antesDiamantes = campania.jugador.diamantes
    const resultado = campania.completarNivel(nivel)
    try {
      const datos = await this.campanias.guardar(usuarioId, campania.toDatos(), {
        tipo: 'recompensa',
        deltaMonedas: campania.jugador.monedas - antesMonedas,
        deltaDiamantes: campania.jugador.diamantes - antesDiamantes,
        detalle: resultado.hint || `Recompensa del nivel ${nivel}`,
      })
      await this.partidas.registrar(usuarioId, nivel, true)
      return { resultado, campania: datos }
    } catch (error) {
      if (error instanceof OperacionRevertida) return { error: error.message }
      throw error
    }
  }
}
