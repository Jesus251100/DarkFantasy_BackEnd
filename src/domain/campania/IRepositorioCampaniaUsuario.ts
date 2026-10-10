import type { DatosCampania } from './IRepositorioCampania'

/** Compra, intercambio o recompensa. Los deltas se suman al saldo bloqueado. */
export interface MovimientoEconomico {
  tipo: 'compra' | 'intercambio' | 'recompensa'
  deltaMonedas: number
  deltaDiamantes: number
  detalle: string
}

export interface FilaTransaccion {
  id: string
  tipo: string
  deltaMonedas: number
  deltaDiamantes: number
  monedasDespues: number
  diamantesDespues: number
  detalle: string
  creadoEn: Date
}

/**
 * Puerto de persistencia por usuario (D de SOLID).
 * Campania sigue usando IRepositorioCampania síncrono;
 * esta interfaz habla con PostgreSQL.
 */
export interface IRepositorioCampaniaUsuario {
  obtener(usuarioId: string): Promise<DatosCampania | null>
  /**
   * Sin movimiento solo cambia el nombre.
   * Con movimiento guarda progreso e historial en la misma transacción.
   */
  guardar(
    usuarioId: string,
    datos: DatosCampania,
    movimiento?: MovimientoEconomico,
  ): Promise<DatosCampania>
  listarTransacciones(usuarioId: string, limite?: number): Promise<FilaTransaccion[]>
}
