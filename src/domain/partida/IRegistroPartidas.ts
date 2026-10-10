export interface DatosPartida {
  id: string
  usuarioId: string
  nivel: number
  gano: boolean
  creadoEn: Date
}

/** Historial de partidas. Segregado de la campaña (I de SOLID). */
export interface IRegistroPartidas {
  registrar(usuarioId: string, nivel: number, gano: boolean): Promise<DatosPartida>
  listarDeUsuario(usuarioId: string, limite?: number): Promise<DatosPartida[]>
}
