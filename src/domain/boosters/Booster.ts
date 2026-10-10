export type MonedaBooster = 'coins' | 'diamantes' | 'diamonds'

/** Contrato de un booster. Las hijas definen precio, moneda y ficha (O/L). */
export abstract class Booster {
  abstract readonly id: number
  abstract readonly nombre: string
  abstract readonly descripcion: string
  abstract readonly precio: number
  abstract readonly moneda: MonedaBooster
  abstract readonly icono: string
}
