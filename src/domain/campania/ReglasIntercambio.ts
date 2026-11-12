/** Tasa fija de conversión: 1 diamante por 50 monedas. */
export const MONEDAS_POR_DIAMANTE = 50

/** Tope de diamantes por un solo cambio, para no desbordar el saldo. */
export const MAX_DIAMANTES_POR_CAMBIO = 100_000

export type ModoIntercambio = 'diamonds-to-coins' | 'coins-to-diamonds'

export function movimientoDeCambio(modo: ModoIntercambio, diamantes: number): {
  monedas: number
  deltaMonedas: number
  deltaDiamantes: number
} {
  const monedas = diamantes * MONEDAS_POR_DIAMANTE
  if (modo === 'diamonds-to-coins') {
    return { monedas, deltaMonedas: monedas, deltaDiamantes: -diamantes }
  }
  return { monedas, deltaMonedas: -monedas, deltaDiamantes: diamantes }
}
