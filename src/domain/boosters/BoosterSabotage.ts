import { Booster, type MonedaBooster } from './Booster'

export class BoosterSabotage extends Booster {
  readonly id = 2
  readonly nombre = 'Sabotage'
  readonly descripcion =
    'Sabotea el cartón de un jugador durante 20 segundos: bloquea casillas, cambia números y puede afectar la balotera. Tiempo de recarga: 60s.'
  readonly precio = 75
  readonly moneda: MonedaBooster = 'coins'
  readonly icono = 'sabotage'
}
