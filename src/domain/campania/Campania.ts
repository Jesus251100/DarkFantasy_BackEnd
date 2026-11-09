import { Jugador } from './Jugador'
import { Recompensa } from './Recompensa'
import { logroDeNivel } from '../logros/Logros'
import {
  MAX_LEVEL,
  campaniaVacia,
  type DatosCampania,
  type IRepositorioCampania,
} from './IRepositorioCampania'

export interface LogroDesbloqueado {
  nivel: number
  codigo: string
  nombre: string
  imagen: string
  monedas: number
  diamantes: number
}

export interface ResultadoClear {
  level: number
  firstClear: boolean
  coins: number
  diamonds: number
  xp: number
  unlockedNext: number | null
  hint: string
  logro: LogroDesbloqueado | null
}

/** Progreso de la campaña. Depende de IRepositorioCampania (D de SOLID). */
export class Campania {
  jugador: Jugador
  highestUnlocked: number
  completed: number[]
  xp: number
  wins: number

  constructor(private readonly repo: IRepositorioCampania) {
    const datos = sanitizar(this.repo.cargar())
    this.highestUnlocked = datos.highestUnlocked
    this.completed = [...datos.completed]
    this.xp = datos.xp
    this.wins = datos.wins
    this.jugador = new Jugador(
      datos.displayName,
      datos.coins,
      datos.diamonds,
      { ...datos.boosters },
    )
  }

  get completedCount(): number {
    return this.completed.length
  }

  get progressPercent(): number {
    return Math.round((this.completedCount / MAX_LEVEL) * 100)
  }

  get campaignLevel(): number {
    return Math.max(1, this.completedCount)
  }

  estaDesbloqueado(level: number): boolean {
    return level >= 1 && level <= this.highestUnlocked
  }

  estaCompletado(level: number): boolean {
    return this.completed.includes(level)
  }

  completarNivel(level: number): ResultadoClear {
    const blank: ResultadoClear = {
      level,
      firstClear: false,
      coins: 0,
      diamonds: 0,
      xp: 0,
      unlockedNext: null,
      hint: '',
      logro: null,
    }
    if (level < 1 || level > MAX_LEVEL) return blank

    this.wins += 1

    if (this.completed.includes(level)) {
      const extra = Recompensa.deRepeticion(level)
      extra.aplicar(this.jugador)
      this.xp += 25
      this.persistir()
      return {
        level,
        firstClear: false,
        coins: extra.monedas,
        diamonds: 0,
        xp: 25,
        unlockedNext: null,
        hint: `+${extra.monedas} 🪙 · +25 XP (repetición)`,
        logro: null,
      }
    }

    this.completed = [...this.completed, level].sort((a, b) => a - b)
    const reward = Recompensa.deNivel(level)
    const definicionLogro = logroDeNivel(level)
    const logro: LogroDesbloqueado | null = definicionLogro ? { ...definicionLogro, nivel: level } : null
    const bono = Recompensa.deLogroNivel(level)
    this.xp += 100
    reward.aplicar(this.jugador)
    bono.aplicar(this.jugador)

    const coins = reward.monedas + bono.monedas
    const diamonds = reward.diamantes + bono.diamantes

    const unlockedNext = level < MAX_LEVEL ? level + 1 : null
    if (unlockedNext) {
      this.highestUnlocked = Math.max(this.highestUnlocked, unlockedNext)
    }

    const total = new Recompensa(coins, diamonds)
    const partes = [total.texto(unlockedNext, level, MAX_LEVEL), '+100 XP']
    if (logro) partes.push(`Logro: ${logro.nombre}`)

    this.persistir()
    return {
      level,
      firstClear: true,
      coins,
      diamonds,
      xp: 100,
      unlockedNext,
      hint: partes.filter(Boolean).join(' · '),
      logro,
    }
  }

  persistir(): void {
    this.repo.guardar(this.toDatos())
  }

  toDatos(): DatosCampania {
    return {
      v: 1,
      highestUnlocked: this.highestUnlocked,
      completed: [...this.completed],
      xp: this.xp,
      coins: this.jugador.monedas,
      diamonds: this.jugador.diamantes,
      wins: this.wins,
      displayName: this.jugador.nombre,
      boosters: { ...this.jugador.boosters },
    }
  }
}

function asInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

export function sanitizar(raw: Partial<DatosCampania>): DatosCampania {
  const base = campaniaVacia()
  const completed = Array.isArray(raw.completed)
    ? [...new Set(raw.completed.map((n) => asInt(n, 0)).filter((n) => n >= 1 && n <= MAX_LEVEL))]
    : []
  completed.sort((a, b) => a - b)

  let highestUnlocked = asInt(raw.highestUnlocked, 1)
  highestUnlocked = Math.min(MAX_LEVEL, Math.max(1, highestUnlocked))
  for (const n of completed) {
    if (n >= MAX_LEVEL) highestUnlocked = MAX_LEVEL
    else highestUnlocked = Math.max(highestUnlocked, n + 1)
  }

  const boosters = { ...base.boosters, ...raw.boosters }
  for (const key of Object.keys(boosters)) {
    boosters[key] = asInt(boosters[key], 0)
  }

  const name = typeof raw.displayName === 'string' ? raw.displayName.trim() : ''

  return {
    v: 1,
    highestUnlocked,
    completed,
    xp: asInt(raw.xp, completed.length * 100),
    coins: asInt(raw.coins, 0),
    diamonds: asInt(raw.diamonds, 0),
    wins: asInt(raw.wins, 0),
    displayName: name || base.displayName,
    boosters,
  }
}
