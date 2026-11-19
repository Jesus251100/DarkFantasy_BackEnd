/** El evento del mundo sale en esta fracción de las partidas que lo permiten. */
export const PROBABILIDAD_RADAR = 0.05

/** El radar se muestra al cantar esta bola. Si la ronda acaba antes, sigue pendiente. */
export const BOLA_DEL_RADAR = 8

/** Partidas que hay que empezar después de usar el localizador. */
export const ESPERA_LOCALIZADOR = 2

export const ID_LOCALIZADOR = 5

export function sortearRadar(permitido: boolean, azar: number): boolean {
  return permitido && azar < PROBABILIDAD_RADAR
}

export interface MedidaAvance {
  hechas: number
  total: number
  ratio: number
}

/**
 * Avance de la mejor figura del método. El centro gratis no cuenta.
 * Una figura con una casilla bloqueada por sabotaje no entra.
 */
export function medirAvance(
  celdas: Array<{ numero: number; libre: boolean }>,
  figuras: number[][],
  cantadas: ReadonlySet<number>,
  bloqueadas: ReadonlySet<number>,
): MedidaAvance {
  let mejor: MedidaAvance = { hechas: 0, total: 0, ratio: -1 }
  for (const figura of figuras) {
    if (figura.some((indice) => bloqueadas.has(indice))) continue
    const utiles = figura.filter((indice) => {
      const celda = celdas[indice]
      return Boolean(celda && !celda.libre)
    })
    if (utiles.length === 0) continue
    const hechas = utiles.filter((indice) => cantadas.has(celdas[indice]?.numero ?? -1)).length
    const ratio = hechas / utiles.length
    if (ratio > mejor.ratio) mejor = { hechas, total: utiles.length, ratio }
  }
  if (mejor.ratio < 0) return { hechas: 0, total: 0, ratio: 0 }
  return mejor
}

export interface CandidatoRadar {
  nombre: string
  asiento: number
  hechas: number
  total: number
  ratio: number
  bola: number
}

export interface ContactoRadar {
  nombre: string
  hechas: number
  total: number
}

/** Más avance gana. Si empatan, gana quien llegó primero. Si siguen iguales, el asiento de la izquierda. */
export function elegirLider(candidatos: CandidatoRadar[]): ContactoRadar | null {
  if (candidatos.length === 0) return null
  const ordenados = [...candidatos].sort((a, b) => {
    if (b.ratio !== a.ratio) return b.ratio - a.ratio
    if (a.bola !== b.bola) return a.bola - b.bola
    return a.asiento - b.asiento
  })
  const lider = ordenados[0]
  if (!lider) return null
  return { nombre: lider.nombre, hechas: lider.hechas, total: lider.total }
}
