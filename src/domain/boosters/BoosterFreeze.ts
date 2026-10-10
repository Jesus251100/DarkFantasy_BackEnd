import { Booster, type MonedaBooster } from './Booster'

export class BoosterFreeze extends Booster {
  readonly id = 1
  readonly nombre = 'Freeze'
  readonly descripcion =
    'Congela el cartón de un jugador por 20 segundos. Durante este tiempo no podrá marcar ninguna casilla. Tiempo de recarga: 50s.'
  readonly precio = 50
  readonly moneda: MonedaBooster = 'coins'
  readonly icono = 'freeze'
}
