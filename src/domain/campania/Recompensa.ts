import { logroDeNivel } from '../logros/Logros'
import type { Jugador } from './Jugador'

export const COIN_REWARD: Record<number, number> = {
  1: 250, 2: 300, 3: 350, 4: 400, 5: 450, 6: 500, 7: 550, 8: 600, 9: 700, 10: 850,
}

export const DIAMOND_REWARD: Record<number, number> = { 6: 2, 7: 3, 8: 4, 9: 5, 10: 8 }

/** Monedas si ya habías ganado ese nivel antes. */
export function coinsPorRepeticion(level: number): number {
  if (level >= 10) return 250
  if (level >= 8) return 200
  if (level >= 5) return 150
  return 100
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

  /** Recompensa extra que trae el logro de completar el nivel. */
  static deLogroNivel(level: number): Recompensa {
    const logro = logroDeNivel(level)
    return new Recompensa(logro?.monedas ?? 0, logro?.diamantes ?? 0)
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
