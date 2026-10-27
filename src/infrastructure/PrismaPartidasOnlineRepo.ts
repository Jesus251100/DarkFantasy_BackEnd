import { Prisma, type PrismaClient } from '../generated/prisma/client'
import type {
  IRegistroPartidasOnline,
  ResultadoOnline,
} from '../domain/online/IRegistroPartidasOnline'
import { prisma } from './prisma'

/** Monedas otorgadas al ganador humano de una partida online. */
export const RECOMPENSA_VICTORIA_ONLINE = 25

/** Guarda la partida online. Las monedas van en un paso aparte, solo si el ganador es una cuenta de esta base. */
export class PrismaPartidasOnlineRepo implements IRegistroPartidasOnline {
  constructor(private readonly db: PrismaClient = prisma) {}

  async registrar(resultado: ResultadoOnline): Promise<{ recompensaMonedas: number }> {
    const idsHumanos = [
      ...new Set(resultado.jugadores.filter((j) => !j.esBot && j.id).map((j) => j.id)),
    ]
    const cuentas = idsHumanos.length
      ? await this.db.usuario.findMany({
          where: { id: { in: idsHumanos } },
          select: { id: true },
        })
      : []
    const cuentasReales = new Set(cuentas.map((cuenta) => cuenta.id))

    const participacion = (enlazar: boolean) =>
      resultado.jugadores.map((j) => ({
        usuarioId: enlazar && cuentasReales.has(j.id) ? j.id : null,
        nombre: j.nombre,
        esBot: j.esBot,
        gano: j.gano,
        carton: j.carton as unknown as Prisma.InputJsonValue,
      }))

    const datos = (enlazar: boolean) => ({
      ganadorId: resultado.ganadorId,
      ganadorNombre: resultado.ganadorNombre,
      tamano: resultado.size,
      modosVictoria: [...resultado.winModes],
      duracionSeg: resultado.duracionSeg,
      Participacion: { create: participacion(enlazar) },
    })

    try {
      await this.db.partidaOnline.create({ data: datos(true) })
    } catch (error) {
      if (!esLlaveAjena(error)) throw error
      await this.db.partidaOnline.create({ data: datos(false) })
      return { recompensaMonedas: 0 }
    }

    const ganador = resultado.jugadores.find((j) => j.id === resultado.ganadorId)
    const usuarioGanador =
      ganador && !ganador.esBot && cuentasReales.has(ganador.id) ? ganador.id : null
    if (!usuarioGanador) return { recompensaMonedas: 0 }

    try {
      return await this.pagarVictoria(usuarioGanador, resultado.salaId)
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'error desconocido'
      console.error(`La partida online quedó guardada, pero no se sumaron las monedas: ${mensaje}`)
      return { recompensaMonedas: 0 }
    }
  }

  private async pagarVictoria(usuarioId: string, salaId: string): Promise<{ recompensaMonedas: number }> {
    return this.db.$transaction(async (tx) => {
      const progreso = await tx.progreso.upsert({
        where: { usuarioId },
        update: {
          coins: { increment: RECOMPENSA_VICTORIA_ONLINE },
          wins: { increment: 1 },
        },
        create: {
          usuarioId,
          coins: RECOMPENSA_VICTORIA_ONLINE,
          wins: 1,
        },
      })

      await tx.historialTransaccion.create({
        data: {
          usuarioId,
          tipo: 'recompensa',
          deltaMonedas: RECOMPENSA_VICTORIA_ONLINE,
          deltaDiamantes: 0,
          monedasDespues: progreso.coins,
          diamantesDespues: progreso.diamonds,
          detalle: `Victoria online (sala ${salaId.slice(0, 8)})`,
        },
      })

      return { recompensaMonedas: RECOMPENSA_VICTORIA_ONLINE }
    })
  }
}

function esLlaveAjena(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}
