import type { Prisma } from '../generated/prisma/client'
import { LOGROS } from '../domain/logros/Logros'

/** Desbloquea un logro de evento y paga su recompensa una sola vez. */
export async function otorgarLogro(
  tx: Prisma.TransactionClient,
  usuarioId: string,
  codigo: string,
): Promise<boolean> {
  const definicion = LOGROS.find((logro) => logro.codigo === codigo)
  if (!definicion) throw new Error(`Logro no definido: ${codigo}`)
  const creado = await tx.logroUsuario.createMany({
    data: [{ usuarioId, codigo }],
    skipDuplicates: true,
  })
  if (!creado.count) return false

  const progreso = await tx.progreso.upsert({
    where: { usuarioId },
    update: { coins: { increment: definicion.monedas }, diamonds: { increment: definicion.diamantes } },
    create: { usuarioId, coins: definicion.monedas, diamonds: definicion.diamantes },
  })
  await tx.historialTransaccion.create({
    data: {
      usuarioId,
      tipo: 'recompensa',
      deltaMonedas: definicion.monedas,
      deltaDiamantes: definicion.diamantes,
      monedasDespues: progreso.coins,
      diamantesDespues: progreso.diamonds,
      detalle: `Logro ${definicion.nombre}: +${definicion.monedas} monedas y +${definicion.diamantes} diamantes`,
    },
  })
  return true
}
