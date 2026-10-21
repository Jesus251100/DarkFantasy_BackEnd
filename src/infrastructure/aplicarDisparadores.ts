import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { PrismaClient } from '../generated/prisma/client'

const archivo = join(dirname(fileURLToPath(import.meta.url)), '../../sql/disparadores.sql')

/** Vuelve a crear los seis disparadores. El SQL está en sql/disparadores.sql. */
export async function aplicarDisparadores(db: PrismaClient): Promise<void> {
  const sql = readFileSync(archivo, 'utf8')
  await db.$executeRawUnsafe(sql)
}
