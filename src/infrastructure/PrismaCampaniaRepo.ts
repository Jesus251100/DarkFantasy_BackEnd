import type { PrismaClient } from '../generated/prisma/client'
import type { DatosCampania } from '../domain/campania/IRepositorioCampania'
import type {
  FilaTransaccion,
  IRepositorioCampaniaUsuario,
  MovimientoEconomico,
} from '../domain/campania/IRepositorioCampaniaUsuario'
import { OperacionRevertida } from '../domain/campania/OperacionRevertida'
import {
  MAX_DIAMANTES_POR_CAMBIO,
  movimientoDeCambio,
} from '../domain/campania/ReglasIntercambio'
import { prisma } from './prisma'
import { datosAProgreso, progresoADatos } from './ProgresoMapper'

/** Adaptador PostgreSQL de la campaña (Liskov respecto al puerto). */
export class PrismaCampaniaRepo implements IRepositorioCampaniaUsuario {
  constructor(private readonly db: PrismaClient = prisma) {}

  async obtener(usuarioId: string): Promise<DatosCampania | null> {
    const usuario = await this.db.usuario.findUnique({
      where: { id: usuarioId },
      include: { progreso: true },
    })
    if (!usuario) return null
    const progreso =
      usuario.progreso ?? (await this.db.progreso.create({ data: { usuarioId } }))
    return progresoADatos(progreso, usuario.nombre)
  }

  async guardar(
    usuarioId: string,
    datos: DatosCampania,
    movimiento?: MovimientoEconomico,
  ): Promise<DatosCampania> {
    if (!movimiento) {
      await this.db.usuario.update({
        where: { id: usuarioId },
        data: { nombre: datos.displayName },
      })
      const progreso = await this.db.progreso.findUnique({ where: { usuarioId } })
      if (!progreso) throw new Error('Usuario no encontrado.')
      return progresoADatos(progreso, datos.displayName)
    }

    try {
      return await this.db.$transaction(async (tx) => {
        const bloqueo = await tx.$queryRaw<Array<{ coins: number; diamonds: number }>>`
          SELECT coins, diamonds
          FROM "Progreso"
          WHERE "usuarioId" = ${usuarioId}
          FOR UPDATE
        `
        const fila = bloqueo[0]
        if (!fila) throw new Error('Usuario no encontrado.')

        const monedas = fila.coins + movimiento.deltaMonedas
        const diamantes = fila.diamonds + movimiento.deltaDiamantes
        if (
          monedas < 0 ||
          diamantes < 0 ||
          datos.coins !== monedas ||
          datos.diamonds !== diamantes
        ) {
          throw new OperacionRevertida()
        }

        await tx.usuario.update({
          where: { id: usuarioId },
          data: { nombre: datos.displayName },
        })
        const progreso = await tx.progreso.update({
          where: { usuarioId },
          data: datosAProgreso(datos),
        })

        if (movimiento.deltaMonedas !== 0 || movimiento.deltaDiamantes !== 0) {
          await tx.historialTransaccion.create({
            data: {
              usuarioId,
              tipo: movimiento.tipo,
              deltaMonedas: movimiento.deltaMonedas,
              deltaDiamantes: movimiento.deltaDiamantes,
              monedasDespues: progreso.coins,
              diamantesDespues: progreso.diamonds,
              detalle: movimiento.detalle.slice(0, 200),
            },
          })
        }

        return progresoADatos(progreso, datos.displayName)
      })
    } catch (error) {
      if (error instanceof OperacionRevertida) throw error
      if (esViolacionDeSaldo(error)) throw new OperacionRevertida()
      throw error
    }
  }

  async intercambiar(
    usuarioId: string,
    modo: 'diamonds-to-coins' | 'coins-to-diamonds',
    diamantes: number,
  ): Promise<DatosCampania> {
    if (!Number.isInteger(diamantes) || diamantes < 1 || diamantes > MAX_DIAMANTES_POR_CAMBIO) {
      throw new OperacionRevertida('La cantidad de cambio no es válida.')
    }
    const cambio = movimientoDeCambio(modo, diamantes)
    return this.db.$transaction(async (tx) => {
      await tx.progreso.upsert({ where: { usuarioId }, update: {}, create: { usuarioId } })
      const filas = await tx.$queryRaw<Array<{ coins: number; diamonds: number }>>`
        SELECT coins, diamonds FROM "Progreso" WHERE "usuarioId" = ${usuarioId} FOR UPDATE
      `
      const saldo = filas[0]
      if (!saldo) throw new OperacionRevertida('No se encontró el saldo de esta cuenta.')
      const { monedas, deltaMonedas, deltaDiamantes } = cambio
      if (saldo.coins + deltaMonedas < 0) {
        throw new OperacionRevertida(`No tienes ${monedas} monedas suficientes.`)
      }
      if (saldo.diamonds + deltaDiamantes < 0) {
        throw new OperacionRevertida(`No tienes ${diamantes} diamantes suficientes.`)
      }
      const progreso = await tx.progreso.update({
        where: { usuarioId },
        data: { coins: saldo.coins + deltaMonedas, diamonds: saldo.diamonds + deltaDiamantes },
      })
      const usuario = await tx.usuario.findUnique({ where: { id: usuarioId }, select: { nombre: true } })
      if (!usuario) throw new OperacionRevertida('No se encontró esta cuenta.')
      await tx.historialTransaccion.create({
        data: {
          usuarioId, tipo: 'intercambio', deltaMonedas, deltaDiamantes,
          monedasDespues: progreso.coins, diamantesDespues: progreso.diamonds,
          detalle:
            modo === 'coins-to-diamonds'
              ? `${monedas} monedas → ${diamantes} diamantes`
              : `${diamantes} diamantes → ${monedas} monedas`,
        },
      })
      return progresoADatos(progreso, usuario.nombre)
    })
  }

  async listarTransacciones(usuarioId: string, limite = 40): Promise<FilaTransaccion[]> {
    const filas = await this.db.historialTransaccion.findMany({
      where: { usuarioId },
      orderBy: { creadoEn: 'desc' },
      take: limite,
    })
    return filas.map((fila) => ({
      id: fila.id,
      tipo: fila.tipo,
      deltaMonedas: fila.deltaMonedas,
      deltaDiamantes: fila.deltaDiamantes,
      monedasDespues: fila.monedasDespues,
      diamantesDespues: fila.diamantesDespues,
      detalle: fila.detalle,
      creadoEn: fila.creadoEn,
    }))
  }

  async listarCodigosLogro(usuarioId: string): Promise<string[]> {
    const rows = await this.db.logroUsuario.findMany({ where: { usuarioId }, select: { codigo: true } })
    return rows.map((row) => row.codigo)
  }

  contarVictoriasOnline(usuarioId: string): Promise<number> {
    return this.db.participacionOnline.count({ where: { usuarioId, esBot: false, gano: true } })
  }
}

function esViolacionDeSaldo(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  const message = 'message' in error ? String(error.message) : ''
  return (
    code === 'P2004' ||
    message.includes('progreso_coins_no_negativo') ||
    message.includes('progreso_diamonds_no_negativo') ||
    message.includes('23514')
  )
}
