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

/** Los boosters que el escudo puede bloquear. */
export const BOOSTERS_OFENSIVOS = new Set([1, 2])
