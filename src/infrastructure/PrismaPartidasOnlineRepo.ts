import { Prisma, type PrismaClient } from '../generated/prisma/client'
import type {
  IRegistroPartidasOnline,
  ResultadoOnline,
} from '../domain/online/IRegistroPartidasOnline'
import { prisma } from './prisma'

/** Monedas otorgadas al ganador humano de una partida online. */
export const RECOMPENSA_VICTORIA_ONLINE = 25

/** Persiste la partida online y recompensa al ganador si es humano. */
export class PrismaPartidasOnlineRepo implements IRegistroPartidasOnline {
  constructor(private readonly db: PrismaClient = prisma) {}

  async registrar(resultado: ResultadoOnline): Promise<{ recompensaMonedas: number }> {
    const ganador = resultado.jugadores.find((j) => j.id === resultado.ganadorId)
    const usuarioGanador = ganador && !ganador.esBot ? ganador.id : null

    return this.db.$transaction(async (tx) => {
      await tx.partidaOnline.create({
        data: {
          ganadorId: resultado.ganadorId,
          ganadorNombre: resultado.ganadorNombre,
          tamano: resultado.size,
          modosVictoria: [...resultado.winModes],
          duracionSeg: resultado.duracionSeg,
          Participacion: {
            create: resultado.jugadores.map((j) => ({
              usuarioId: j.esBot ? null : j.id,
              nombre: j.nombre,
              esBot: j.esBot,
              gano: j.gano,
              carton: j.carton as unknown as Prisma.InputJsonValue,
            })),
          },
        },
      })

      if (!usuarioGanador) return { recompensaMonedas: 0 }

      const progreso = await tx.progreso.upsert({
        where: { usuarioId: usuarioGanador },
        update: {
          coins: { increment: RECOMPENSA_VICTORIA_ONLINE },
          wins: { increment: 1 },
        },
        create: {
          usuarioId: usuarioGanador,
          coins: RECOMPENSA_VICTORIA_ONLINE,
          wins: 1,
        },
      })

      await tx.historialTransaccion.create({
        data: {
          usuarioId: usuarioGanador,
          tipo: 'recompensa',
          deltaMonedas: RECOMPENSA_VICTORIA_ONLINE,
          deltaDiamantes: 0,
          monedasDespues: progreso.coins,
          diamantesDespues: progreso.diamonds,
          detalle: `Victoria online (sala ${resultado.salaId.slice(0, 8)})`,
        },
      })

      return { recompensaMonedas: RECOMPENSA_VICTORIA_ONLINE }
    })
  }
}
