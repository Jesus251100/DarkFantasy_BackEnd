import { PrismaClient } from '@prisma/client'
import { urlBaseDatos } from './conexionBd'

/** Cliente Prisma: todas las consultas a PostgreSQL pasan por aquí. */
export const prisma = new PrismaClient({
  datasources: {
    db: { url: urlBaseDatos() },
  },
})
