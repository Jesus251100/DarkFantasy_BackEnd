import type { Progreso } from '@prisma/client'
import { campaniaVacia, type DatosCampania } from '../domain/campania/IRepositorioCampania'
import type { StockBoosters } from '../domain/campania/Jugador'

export function progresoADatos(row: Progreso, nombre: string): DatosCampania {
  const boosters =
    row.boosters && typeof row.boosters === 'object' && !Array.isArray(row.boosters)
      ? (row.boosters as StockBoosters)
      : campaniaVacia().boosters
  return {
    v: 1,
    highestUnlocked: row.highestUnlocked,
    completed: [...row.completed],
    coins: row.coins,
    diamonds: row.diamonds,
    wins: row.wins,
    displayName: nombre,
    boosters: { '1': 0, '2': 0, '3': 0, '4': 0, ...boosters },
  }
}

export function datosAProgreso(datos: DatosCampania) {
  return {
    highestUnlocked: datos.highestUnlocked,
    completed: datos.completed,
    coins: datos.coins,
    diamonds: datos.diamonds,
    wins: datos.wins,
    boosters: datos.boosters,
  }
}
