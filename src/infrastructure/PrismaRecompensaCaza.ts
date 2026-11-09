import { prisma } from './prisma'

export async function pagarExperienciaCaza(usuarioIds: string[], xp: number): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const usuarioId of [...new Set(usuarioIds)]) {
        const progreso = await tx.progreso.upsert({
          where: { usuarioId },
          update: { xp: { increment: xp }, progressionInitialized: true },
          create: { usuarioId, xp, progressionInitialized: true },
        })
        await tx.historialTransaccion.create({
          data: {
            usuarioId,
            tipo: 'recompensa',
            deltaMonedas: 0,
            deltaDiamantes: 0,
            monedasDespues: progreso.coins,
            diamantesDespues: progreso.diamonds,
            detalle: `Caza de dragones: +${xp} XP por participar`,
          },
        })
      }
    })
    return true
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'error desconocido'
    console.error(`No se pudo sumar la experiencia de la caza: ${mensaje}`)
    return false
  }
}

/** Suma el mismo premio a los dos cazadores y deja el recibo en el historial. */
export async function pagarDiamantesCaza(usuarioIds: string[], diamantes: number): Promise<boolean> {
  try {
    await prisma.$transaction(async (tx) => {
      for (const usuarioId of usuarioIds) {
        const progreso = await tx.progreso.upsert({
          where: { usuarioId },
          update: { diamonds: { increment: diamantes }, xp: { increment: 100 }, progressionInitialized: true },
          create: { usuarioId, diamonds: diamantes, xp: 100, progressionInitialized: true },
        })
        await tx.historialTransaccion.create({
          data: {
            usuarioId,
            tipo: 'recompensa',
            deltaMonedas: 0,
            deltaDiamantes: diamantes,
            monedasDespues: progreso.coins,
            diamantesDespues: progreso.diamonds,
            detalle: 'Caza de dragones: +100 XP',
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
