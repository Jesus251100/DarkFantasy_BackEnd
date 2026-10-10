import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { prisma } from '../infrastructure/prisma'
import type { IEnviadorCorreo } from '../domain/identidad/IEnviadorCorreo'

const VIDA_MS = 10 * 60 * 1000
const ESPERA_MS = 20 * 1000
const ultimaSolicitud = new Map<string, number>()

export class SolicitarCodigo {
  constructor(private readonly correo: IEnviadorCorreo) {}

  async ejecutar(correoCrudo: string): Promise<{ bandeja?: string }> {
    const correo = correoCrudo.trim().toLowerCase()
    const existe = await prisma.usuario.findUnique({ where: { correo } })
    if (existe) {
      throw Object.assign(new Error('Ese correo ya está registrado.'), { status: 409 })
    }

    const ahora = Date.now()
    const previa = ultimaSolicitud.get(correo) ?? 0
    if (ahora - previa < ESPERA_MS) {
      throw Object.assign(new Error('Espera unos segundos para reenviar el código.'), { status: 429 })
    }

    const codigo = randomInt(0, 1_000_000).toString().padStart(6, '0')
    const codigoHash = await bcrypt.hash(codigo, 10)

    await prisma.codigoVerificacion.updateMany({
      where: { correo, usado: false },
      data: { usado: true },
    })
    await prisma.codigoVerificacion.create({
      data: {
        correo,
        codigoHash,
        expiraEn: new Date(ahora + VIDA_MS),
      },
    })

    try {
      await this.correo.enviarCodigo(correo, codigo)
    } catch (e) {
      const detalle = e instanceof Error ? e.message : 'error SMTP'
      const local = Boolean(this.correo.bandejaLocal())
      throw Object.assign(
        new Error(
          local
            ? `No se pudo enviar el correo (${detalle}). ¿Está el servicio de mail de Docker?`
            : `No se pudo enviar el correo (${detalle}). Revisa SMTP_USER y la contraseña de aplicación de Gmail.`,
        ),
        { status: 503 },
      )
    }

    ultimaSolicitud.set(correo, ahora)
    console.log(`[verificación] correo enviado a ${correo}`)
    return { bandeja: this.correo.bandejaLocal() }
  }
}

export async function consumirCodigo(correo: string, codigo: string): Promise<boolean> {
  const filas = await prisma.codigoVerificacion.findMany({
    where: { correo, usado: false, expiraEn: { gt: new Date() } },
    orderBy: { creadoEn: 'desc' },
    take: 5,
  })
  for (const fila of filas) {
    const ok = await bcrypt.compare(codigo, fila.codigoHash)
    if (ok) {
      await prisma.codigoVerificacion.update({
        where: { id: fila.id },
        data: { usado: true },
      })
      return true
    }
  }
  return false
}
