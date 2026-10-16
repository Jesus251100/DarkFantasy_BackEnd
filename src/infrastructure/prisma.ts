import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../generated/prisma/client'
import { urlBaseDatos } from './conexionBd'

/** Cliente Prisma: todas las consultas a PostgreSQL pasan por aquí. */
const adapter = new PrismaPg({ connectionString: urlBaseDatos() })

export const prisma = new PrismaClient({ adapter })
