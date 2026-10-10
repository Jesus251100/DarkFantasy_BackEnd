import type { PrismaClient } from '@prisma/client'
import type {
  IConsultasAdmin,
  ReportesAdmin,
  ResumenUsuarioAdmin,
} from '../domain/admin/IConsultasAdmin'
import { prisma } from './prisma'

export class PrismaAdminRepo implements IConsultasAdmin {
  constructor(private readonly db: PrismaClient = prisma) {}

  async listarUsuarios(): Promise<ResumenUsuarioAdmin[]> {
    const usuarios = await this.db.usuario.findMany({
      orderBy: { creadoEn: 'desc' },
      include: { progreso: true, _count: { select: { partidas: true } } },
    })
    return usuarios.map((u) => ({
      id: u.id,
      correo: u.correo,
      rol: u.rol,
      nombre: u.nombre,
      creadoEn: u.creadoEn,
      coins: u.progreso?.coins ?? 0,
      diamonds: u.progreso?.diamonds ?? 0,
      wins: u.progreso?.wins ?? 0,
      highestUnlocked: u.progreso?.highestUnlocked ?? 1,
      completed: u.progreso?.completed ?? [],
      partidas: u._count.partidas,
    }))
  }

  async reportes(): Promise<ReportesAdmin> {
    const [totalUsuarios, totalPartidas, victorias, porNivel] = await Promise.all([
      this.db.usuario.count(),
      this.db.partida.count(),
      this.db.partida.count({ where: { gano: true } }),
      this.db.partida.groupBy({
        by: ['nivel'],
        _count: { nivel: true },
        orderBy: { nivel: 'asc' },
      }),
    ])
    return {
      totalUsuarios,
      totalPartidas,
      victorias,
      porNivel: porNivel.map((p) => ({ nivel: p.nivel, partidas: p._count.nivel })),
    }
  }

  async actividad() {
    const [partidas, registros, transacciones] = await Promise.all([
      this.db.partida.findMany({
        orderBy: { creadoEn: 'desc' },
        take: 30,
        include: { usuario: { select: { nombre: true, correo: true } } },
      }),
      this.db.usuario.findMany({
        orderBy: { creadoEn: 'desc' },
        take: 10,
        select: { nombre: true, correo: true, creadoEn: true },
      }),
      this.db.historialTransaccion.findMany({
        orderBy: { creadoEn: 'desc' },
        take: 30,
        include: { usuario: { select: { nombre: true, correo: true } } },
      }),
    ])
    return {
      partidas: partidas.map((p) => ({
        id: p.id,
        nivel: p.nivel,
        gano: p.gano,
        creadoEn: p.creadoEn,
        nombre: p.usuario.nombre,
        correo: p.usuario.correo,
      })),
      registros,
      transacciones: transacciones.map((t) => ({
        id: t.id,
        tipo: t.tipo,
        deltaMonedas: t.deltaMonedas,
        deltaDiamantes: t.deltaDiamantes,
        detalle: t.detalle,
        creadoEn: t.creadoEn,
        nombre: t.usuario.nombre,
        correo: t.usuario.correo,
      })),
    }
  }
}
