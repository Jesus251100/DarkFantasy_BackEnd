import type { DatosPartida, IRegistroPartidas } from '../domain/partida/IRegistroPartidas'

export class RegistrarPartida {
  constructor(private readonly partidas: IRegistroPartidas) {}

  ejecutar(usuarioId: string, nivel: number, gano: boolean): Promise<DatosPartida> {
    return this.partidas.registrar(usuarioId, nivel, gano)
  }
}
