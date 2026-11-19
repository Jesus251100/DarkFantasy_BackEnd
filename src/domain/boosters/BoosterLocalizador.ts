import { Booster, type MonedaBooster } from './Booster'

export class BoosterLocalizador extends Booster {
  readonly id = 5
  readonly nombre = 'Localizador'
  readonly descripcion =
    'Muestra quién lleva más avance en el método de victoria. Solo tú ves el resultado. Espera: 2 partidas.'
  readonly precio = 20
  readonly moneda: MonedaBooster = 'diamonds'
  readonly icono = 'localizador'
}
