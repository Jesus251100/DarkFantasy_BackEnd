import type { PrismaClient } from '@prisma/client'
import type { DatosPartida, IRegistroPartidas } from '../domain/partida/IRegistroPartidas'
import { prisma } from './prisma'

export class PrismaPartidasRepo implements IRegistroPartidas {
  constructor(private readonly db: PrismaClient = prisma) {}

  async registrar(usuarioId: string, nivel: number, gano: boolean): Promise<DatosPartida> {
    const row = await this.db.partida.create({
      data: { usuarioId, nivel, gano },
    })
    return {
      id: row.id,
      usuarioId: row.usuarioId,
      nivel: row.nivel,
      gano: row.gano,
      creadoEn: row.creadoEn,
    }
  }

  async listarDeUsuario(usuarioId: string, limite = 40): Promise<DatosPartida[]> {
    const rows = await this.db.partida.findMany({
      where: { usuarioId },
      orderBy: { creadoEn: 'desc' },
      take: limite,
    })
    return rows.map((row) => ({
      id: row.id,
      usuarioId: row.usuarioId,
      nivel: row.nivel,
      gano: row.gano,
      creadoEn: row.creadoEn,
    }))
  }
}
