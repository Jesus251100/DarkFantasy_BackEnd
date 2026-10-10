/** La base rechazó el movimiento y no dejó el saldo a medias. */
export class OperacionRevertida extends Error {
  constructor(mensaje = 'Saldo insuficiente. La operación se revirtió.') {
    super(mensaje)
    this.name = 'OperacionRevertida'
  }
}
