export type TipoEfectoBooster = 'freeze' | 'sabotage' | 'luck' | 'shield'

export interface DefinicionEfectoBooster {
  tipo: TipoEfectoBooster
  duracionMs: number
}

/** Duración y efecto de cada booster del catálogo (id 1..4). */
export const EFECTOS_BOOSTER: Record<number, DefinicionEfectoBooster> = {
  1: { tipo: 'freeze', duracionMs: 20_000 },
  2: { tipo: 'sabotage', duracionMs: 20_000 },
  3: { tipo: 'luck', duracionMs: 30_000 },
  4: { tipo: 'shield', duracionMs: 30_000 },
}

/** Tiempos de recarga descritos en el inventario. */
export const RECARGA_BOOSTER_MS: Record<number, number> = {
  1: 50_000,
  2: 60_000,
  3: 50_000,
  4: 50_000,
}

/** Ataque: hielo y sabotaje. Solo pueden caer sobre otro jugador. */
export const BOOSTERS_OFENSIVOS = new Set([1, 2])

/** Defensa: suerte y escudo. Solo pueden cubrir a quien los lanza. */
export const BOOSTERS_DEFENSIVOS = new Set([3, 4])

/** Devuelve el motivo del rechazo, o null si ese jugador puede recibir el booster. */
export function rechazoDeObjetivo(boosterId: number, lanzadorId: string, objetivoId: string): string | null {
  if (BOOSTERS_OFENSIVOS.has(boosterId)) {
    return objetivoId === lanzadorId ? 'Este ataque solo se lanza a los demás.' : null
  }
  if (BOOSTERS_DEFENSIVOS.has(boosterId)) {
    return objetivoId === lanzadorId ? null : 'La defensa solo te cubre a ti.'
  }
  return 'Booster desconocido.'
}
