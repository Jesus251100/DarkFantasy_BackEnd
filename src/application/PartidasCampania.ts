import { randomUUID } from 'node:crypto'
import { Carton } from '../domain/bingo/Carton'
import { Oraculo } from '../domain/bingo/Oraculo'
import { patronesDesdeModos } from '../domain/bingo/patrones/catalogoPatrones'
import type { CardValue, WinMode } from '../domain/bingo/tipos'

interface ConfigFase {
  tamano: number
  maxNumero: number
  cartones: number
  intervaloMs: number
  modos: WinMode[]
}

const FASES: Record<number, ConfigFase[]> = {
  1: [{ tamano: 3, maxNumero: 35, cartones: 1, intervaloMs: 3800, modos: ['row', 'column'] }],
  2: [{ tamano: 3, maxNumero: 35, cartones: 1, intervaloMs: 3600, modos: ['row', 'column', 'diagonal'] }],
  3: [{ tamano: 4, maxNumero: 50, cartones: 1, intervaloMs: 3400, modos: ['row', 'column', 'diagonal', 'L', 'O'] }],
  4: [{ tamano: 4, maxNumero: 50, cartones: 2, intervaloMs: 3300, modos: ['row', 'column', 'diagonal', 'L', 'O'] }],
  5: [{ tamano: 5, maxNumero: 75, cartones: 1, intervaloMs: 3100, modos: ['row', 'column', 'diagonal', 'L', 'O', 'plus', 'X'] }],
  6: [{ tamano: 5, maxNumero: 75, cartones: 1, intervaloMs: 3000, modos: ['row', 'column', 'diagonal', 'L', 'O', 'plus', 'X', 'H', 'T'] }],
  7: [{ tamano: 5, maxNumero: 75, cartones: 1, intervaloMs: 2900, modos: ['row', 'column', 'diagonal', 'L', 'O', 'plus', 'X', 'H', 'T', 'arrow', 'diamond'] }],
  8: [{ tamano: 5, maxNumero: 75, cartones: 2, intervaloMs: 2800, modos: ['row', 'column', 'diagonal', 'L', 'O', 'plus', 'X', 'H', 'T', 'arrow', 'diamond'] }],
  9: [{ tamano: 5, maxNumero: 75, cartones: 2, intervaloMs: 2700, modos: ['row', 'column', 'diagonal', 'L', 'O', 'plus', 'X', 'H', 'T', 'arrow', 'diamond', 'zigzag'] }],
  10: [
    { tamano: 5, maxNumero: 75, cartones: 1, intervaloMs: 2600, modos: ['full'] },
    { tamano: 5, maxNumero: 75, cartones: 2, intervaloMs: 2500, modos: ['zigzag'] },
    { tamano: 6, maxNumero: 90, cartones: 1, intervaloMs: 2400, modos: ['crown'] },
  ],
}

type EstadoRonda = 'jugando' | 'reclamando' | 'validada' | 'cerrada'

interface RondaCampania {
  id: string
  usuarioId: string
  runId: string | null
  nivel: number
  fase: number
  totalFases: number
  config: ConfigFase
  modos: WinMode[]
  valoresCartones: CardValue[][]
  oraculo: Oraculo
  iniciadaEn: number
  ultimaBolaEn: number
  estado: EstadoRonda
}

interface RunCampania {
  id: string
  usuarioId: string
  nivel: number
  siguienteFase: number
  actualizadoEn: number
}

export interface VistaRondaCampania {
  id: string
  runId: string | null
  nivel: number
  fase: number
  tamano: number
  maxNumero: number
  intervaloMs: number
  modos: WinMode[]
  cartones: CardValue[][]
}

const VIDA_RONDA_MS = 60 * 60 * 1000
const MAX_RONDAS_ACTIVAS_POR_USUARIO = 8
const MAX_RONDAS_EN_MEMORIA = 5000
const rondas = new Map<string, RondaCampania>()
const runs = new Map<string, RunCampania>()

function limpiarVencidas(ahora: number): void {
  for (const [id, ronda] of rondas) {
    if (ahora - ronda.iniciadaEn > VIDA_RONDA_MS || ronda.estado === 'cerrada') rondas.delete(id)
  }
  for (const [id, run] of runs) {
    if (ahora - run.actualizadoEn > VIDA_RONDA_MS) runs.delete(id)
  }
}

export class PartidasCampania {
  iniciar(
    usuarioId: string,
    nivel: number,
    fase: number,
    modo: WinMode | undefined,
    runId: string | undefined,
    highestUnlocked: number,
  ): VistaRondaCampania {
    const ahora = Date.now()
    limpiarVencidas(ahora)
    const activasDelUsuario = [...rondas.values()].filter(
      (ronda) => ronda.usuarioId === usuarioId && (ronda.estado === 'jugando' || ronda.estado === 'reclamando'),
    ).length
    if (activasDelUsuario >= MAX_RONDAS_ACTIVAS_POR_USUARIO || rondas.size >= MAX_RONDAS_EN_MEMORIA) {
      throw Object.assign(new Error('Hay demasiadas rondas activas. Cierra una partida anterior e inténtalo de nuevo.'), {
        status: 429,
      })
    }
    const fases = FASES[nivel]
    if (!fases || nivel > highestUnlocked) throw new Error('Nivel todavía no desbloqueado.')
    const config = fases[fase - 1]
    if (!config) throw new Error('Fase inválida.')

    let run: RunCampania | null = null
    if (fases.length > 1) {
      if (fase === 1) {
        run = {
          id: randomUUID(),
          usuarioId,
          nivel,
          siguienteFase: 1,
          actualizadoEn: ahora,
        }
        runs.set(run.id, run)
      } else {
        run = runId ? (runs.get(runId) ?? null) : null
        if (
          !run ||
          run.usuarioId !== usuarioId ||
          run.nivel !== nivel ||
          run.siguienteFase !== fase
        ) {
          throw new Error('Debes superar la fase anterior para continuar.')
        }
        run.actualizadoEn = ahora
      }
    } else if (fase !== 1) {
      throw new Error('Fase inválida.')
    }

    const modos = modo ? [modo] : [...config.modos]
    if (modos.some((item) => !config.modos.includes(item))) throw new Error('Método de victoria inválido.')
    const valoresCartones = Array.from({ length: config.cartones }, () =>
      Carton.aleatorio(config.tamano, config.maxNumero).toValores(),
    )
    const ronda: RondaCampania = {
      id: randomUUID(),
      usuarioId,
      runId: run?.id ?? null,
      nivel,
      fase,
      totalFases: fases.length,
      config,
      modos,
      valoresCartones,
      oraculo: Oraculo.nuevo(config.maxNumero),
      iniciadaEn: ahora,
      // El frontend solicita la primera bola tras esperar el intervalo completo.
      ultimaBolaEn: ahora - config.intervaloMs,
      estado: 'jugando',
    }
    rondas.set(ronda.id, ronda)
    return this.vista(ronda)
  }

  siguienteBola(usuarioId: string, rondaId: string): number {
    const ronda = this.obtener(usuarioId, rondaId)
    if (ronda.estado !== 'jugando') throw new Error('La ronda ya terminó.')
    const ahora = Date.now()
    if (ahora - ronda.ultimaBolaEn < ronda.config.intervaloMs) {
      throw Object.assign(new Error('Espera a que el oráculo cante la siguiente bola.'), { status: 429 })
    }
    const numero = ronda.oraculo.cantar()
    if (numero === null) throw new Error('No quedan bolas por cantar.')
    ronda.ultimaBolaEn = ahora
    return numero
  }

  comenzarReclamo(usuarioId: string, rondaId: string, cartonIndex: number): RondaCampania | null {
    const ronda = this.obtener(usuarioId, rondaId)
    if (ronda.estado === 'validada') return ronda
    if (ronda.estado !== 'jugando') return null
    const valores = ronda.valoresCartones[cartonIndex]
    if (!valores) return null
    const carton = Carton.desdeValores(valores)
    if (!carton.evaluarVictoriaPorBolas(patronesDesdeModos(ronda.modos), ronda.oraculo.conjunto).won) {
      return null
    }
    ronda.estado = 'reclamando'
    return ronda
  }

  confirmarReclamo(ronda: RondaCampania): void {
    ronda.estado = 'validada'
    if (ronda.runId) {
      const run = runs.get(ronda.runId)
      if (run) {
        run.siguienteFase = ronda.fase + 1
        run.actualizadoEn = Date.now()
        if (ronda.fase >= ronda.totalFases) runs.delete(run.id)
      }
    }
  }

  cancelarReclamo(ronda: RondaCampania): void {
    if (ronda.estado === 'reclamando') ronda.estado = 'jugando'
  }

  cerrar(usuarioId: string, rondaId: string): void {
    const ronda = this.obtener(usuarioId, rondaId)
    if (ronda.estado === 'jugando') ronda.estado = 'cerrada'
  }

  private obtener(usuarioId: string, rondaId: string): RondaCampania {
    const ronda = rondas.get(rondaId)
    if (!ronda || ronda.usuarioId !== usuarioId || Date.now() - ronda.iniciadaEn > VIDA_RONDA_MS) {
      throw new Error('Ronda no válida o vencida. Inicia una nueva partida.')
    }
    return ronda
  }

  private vista(ronda: RondaCampania): VistaRondaCampania {
    return {
      id: ronda.id,
      runId: ronda.runId,
      nivel: ronda.nivel,
      fase: ronda.fase,
      tamano: ronda.config.tamano,
      maxNumero: ronda.config.maxNumero,
      intervaloMs: ronda.config.intervaloMs,
      modos: [...ronda.modos],
      cartones: ronda.valoresCartones.map((c) => [...c]),
    }
  }
}
