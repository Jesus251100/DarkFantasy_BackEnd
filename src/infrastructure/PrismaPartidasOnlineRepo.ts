import { Prisma, type PrismaClient } from '../generated/prisma/client'
import type {
  IRegistroPartidasOnline,
  ResultadoOnline,
} from '../domain/online/IRegistroPartidasOnline'
import { prisma } from './prisma'

/** Monedas otorgadas al ganador humano de una partida online. */
export const RECOMPENSA_VICTORIA_ONLINE = 25
export const XP_PARTICIPACION_ONLINE = 25
export const XP_VICTORIA_ONLINE = 75
export const PENALIZACION_XP_ABANDONO = 50
export const PENALIZACION_MONEDAS_ABANDONO = 10
export const PENALIZACION_RANKING_ABANDONO = 25

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
    for (const usuarioId of idsHumanos) {
      if (cuentasReales.has(usuarioId)) await this.obtenerPuntosRanking(usuarioId)
    }

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

    try {
      return await this.pagarRecompensas(resultado, cuentasReales)
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : 'error desconocido'
      console.error(`La partida online quedó guardada, pero no se aplicaron sus recompensas: ${mensaje}`)
      return { recompensaMonedas: 0 }
    }
  }

  async penalizarAbandono(usuarioId: string, salaId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.progreso.upsert({ where: { usuarioId }, update: {}, create: { usuarioId } })
      await tx.$queryRaw`SELECT "usuarioId" FROM "Progreso" WHERE "usuarioId" = ${usuarioId} FOR UPDATE`
      const detalle = `Abandono de partida online (${salaId.slice(0, 8)})`
      const yaAplicada = await tx.historialTransaccion.findFirst({
        where: { usuarioId, tipo: 'penalizacion', detalle: { startsWith: detalle } },
        select: { id: true },
      })
      if (yaAplicada) return
      await this.inicializarRanking(tx, usuarioId)
      const fila = await tx.progreso.findUniqueOrThrow({ where: { usuarioId } })
      const monedas = Math.max(0, fila.coins - PENALIZACION_MONEDAS_ABANDONO)
      const xp = Math.max(0, fila.xp - PENALIZACION_XP_ABANDONO)
      const rankingPoints = Math.max(0, fila.rankingPoints - PENALIZACION_RANKING_ABANDONO)
      const progreso = await tx.progreso.update({
        where: { usuarioId },
        data: { coins: monedas, xp, rankingPoints, progressionInitialized: true },
      })
      await tx.historialTransaccion.create({
        data: {
          usuarioId,
          tipo: 'penalizacion',
          deltaMonedas: monedas - fila.coins,
          deltaDiamantes: 0,
          monedasDespues: progreso.coins,
          diamantesDespues: progreso.diamonds,
          detalle: `${detalle}: -${fila.xp - xp} XP, -${fila.coins - monedas} monedas, -${fila.rankingPoints - rankingPoints} ranking`,
        },
      })
    })
  }

  async obtenerPuntosRanking(usuarioId: string): Promise<number> {
    return this.db.$transaction(async (tx) => {
      await tx.progreso.upsert({ where: { usuarioId }, update: {}, create: { usuarioId } })
      await this.inicializarRanking(tx, usuarioId)
      const progreso = await tx.progreso.findUnique({ where: { usuarioId }, select: { rankingPoints: true } })
      return progreso?.rankingPoints ?? 0
    })
  }

  private async pagarRecompensas(
    resultado: ResultadoOnline,
    cuentasReales: Set<string>,
  ): Promise<{ recompensaMonedas: number }> {
    return this.db.$transaction(async (tx) => {
      let recompensaMonedas = 0
      const humanos = resultado.jugadores.filter((jugador) => !jugador.esBot && cuentasReales.has(jugador.id))
      for (const jugador of humanos) {
        await tx.progreso.upsert({ where: { usuarioId: jugador.id }, update: {}, create: { usuarioId: jugador.id } })
        await this.inicializarRanking(tx, jugador.id)
        const gano = jugador.id === resultado.ganadorId
        const monedasPremio = gano ? RECOMPENSA_VICTORIA_ONLINE : 0
        const xpPremio = XP_PARTICIPACION_ONLINE + (gano ? XP_VICTORIA_ONLINE - XP_PARTICIPACION_ONLINE : 0)
        const progreso = await tx.progreso.update({
          where: { usuarioId: jugador.id },
          data: {
            coins: { increment: monedasPremio },
            xp: { increment: xpPremio },
            progressionInitialized: true,
            rankingPoints: { increment: gano ? RECOMPENSA_VICTORIA_ONLINE : 0 },
            wins: gano ? { increment: 1 } : undefined,
          },
        })
        if (gano) recompensaMonedas = monedasPremio
        await tx.historialTransaccion.create({
          data: {
            usuarioId: jugador.id,
            tipo: 'recompensa',
            deltaMonedas: monedasPremio,
            deltaDiamantes: 0,
            monedasDespues: progreso.coins,
            diamantesDespues: progreso.diamonds,
            detalle: gano
              ? `Victoria online: +${xpPremio} XP y +${RECOMPENSA_VICTORIA_ONLINE} monedas`
              : `Participación online: +${xpPremio} XP`,
          },
        })
      }
      return { recompensaMonedas }
    })
  }

  private async inicializarRanking(tx: Prisma.TransactionClient, usuarioId: string): Promise<void> {
    const fila = await tx.progreso.findUnique({ where: { usuarioId } })
    if (!fila || fila.rankingInitialized) return
    const victorias = await tx.participacionOnline.count({ where: { usuarioId, esBot: false, gano: true } })
    await tx.progreso.update({
      where: { usuarioId },
      data: { rankingPoints: victorias * RECOMPENSA_VICTORIA_ONLINE, rankingInitialized: true },
    })
  }
}

function esLlaveAjena(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003'
}
