import { prisma } from './prisma'

/** Suma el mismo premio a los dos cazadores y deja el recibo en el historial. */
export async function pagarDiamantesCaza(usuarioIds: string[], diamantes: number): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const usuarioId of usuarioIds) {
        const progreso = await tx.progreso.upsert({
          where: { usuarioId },
          update: { diamonds: { increment: diamantes } },
          create: { usuarioId, diamonds: diamantes },
        })
        await tx.historialTransaccion.create({
          data: {
            usuarioId,
            tipo: 'recompensa',
            deltaMonedas: 0,
            deltaDiamantes: diamantes,
            monedasDespues: progreso.coins,
            diamantesDespues: progreso.diamonds,
            detalle: 'Caza de dragones',
          },
        })
      }
    })
    return true
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'error desconocido'
    console.error(`No se pudieron sumar los diamantes de la caza: ${mensaje}`)
    return false
  }
}
