import type { StockBoosters } from './Jugador'

export const MAX_LEVEL = 10
export const STORAGE_KEY = 'df_campaign_v1'

export interface DatosCampania {
  v: 1
  highestUnlocked: number
  completed: number[]
  coins: number
  diamonds: number
  wins: number
  displayName: string
  boosters: StockBoosters
}

export interface IRepositorioCampania {
  cargar(): DatosCampania
  guardar(datos: DatosCampania): void
}

export function campaniaVacia(): DatosCampania {
  return {
    v: 1,
    highestUnlocked: 1,
    completed: [],
    coins: 0,
    diamonds: 0,
    wins: 0,
    displayName: 'Jugador',
    boosters: { '1': 0, '2': 0, '3': 0, '4': 0 },
  }
}
