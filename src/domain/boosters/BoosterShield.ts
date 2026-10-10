import { Booster, type MonedaBooster } from './Booster'

export class BoosterShield extends Booster {
  readonly id = 4
  readonly nombre = 'Shield'
  readonly descripcion =
    'Protege al jugador de sabotajes y congelamientos durante 30 segundos. Tiempo de recarga: 50s.'
  readonly precio = 5
  readonly moneda: MonedaBooster = 'diamonds'
  readonly icono = 'shield'
}
