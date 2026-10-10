import type { Jugador } from './Jugador'

export const COIN_REWARD: Record<number, number> = {
  1: 50, 2: 70, 3: 90, 4: 110, 5: 130, 6: 150, 7: 170, 8: 200, 9: 230, 10: 350,
}

export const DIAMOND_REWARD: Record<number, number> = { 10: 5 }

/** Monedas si ya habías ganado ese nivel antes. */
export function coinsPorRepeticion(level: number): number {
  if (level >= 10) return 30
  if (level >= 5) return 20
  return 10
}

export class Recompensa {
  constructor(
    readonly monedas: number,
    readonly diamantes: number,
  ) {}

  static deNivel(level: number): Recompensa {
    return new Recompensa(COIN_REWARD[level] ?? 50, DIAMOND_REWARD[level] ?? 0)
  }

  static deRepeticion(level: number): Recompensa {
    return new Recompensa(coinsPorRepeticion(level), 0)
  }

  aplicar(jugador: Jugador): void {
    jugador.recibir(this)
  }

  texto(unlockedNext: number | null, level: number, maxLevel: number): string {
    const parts: string[] = []
    if (this.monedas > 0) parts.push(`+${this.monedas} 🪙`)
    if (this.diamantes > 0) parts.push(`+${this.diamantes} 💎`)
    if (unlockedNext) parts.push(`Nivel ${unlockedNext} desbloqueado`)
    else if (level >= maxLevel) parts.push('Campaña completada')
    return parts.join(' · ')
  }
}
