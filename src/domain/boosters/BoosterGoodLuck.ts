import { Booster, type MonedaBooster } from './Booster'

export class BoosterGoodLuck extends Booster {
  readonly id = 3
  readonly nombre = 'Good Luck'
  readonly descripcion =
    'Aumenta la probabilidad de obtener los números necesarios para ganar durante 30 segundos. Tiempo de recarga: 50s.'
  readonly precio = 5
  readonly moneda: MonedaBooster = 'diamonds'
  readonly icono = 'luck'
}
