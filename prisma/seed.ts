import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaClient } from '@prisma/client'
import { aplicarIntegridad } from '../src/infrastructure/aplicarIntegridad'

const prisma = new PrismaClient()

async function upsertUser(
  correo: string,
  clave: string,
  rol: string,
  nombre: string,
  highestUnlocked = 1,
) {
  const claveHash = await bcrypt.hash(clave, 10)
  const usuario = await prisma.usuario.upsert({
    where: { correo },
    update: { claveHash, rol, nombre },
    create: {
      correo,
      claveHash,
      rol,
      nombre,
      progreso: { create: { highestUnlocked } },
    },
  })
  const progreso = await prisma.progreso.findUnique({ where: { usuarioId: usuario.id } })
  if (!progreso) {
    await prisma.progreso.create({ data: { usuarioId: usuario.id, highestUnlocked } })
  } else if (highestUnlocked > progreso.highestUnlocked) {
    await prisma.progreso.update({
      where: { usuarioId: usuario.id },
      data: { highestUnlocked },
    })
  }
  return usuario
}

async function main() {
  await upsertUser('jugador@darkfantasy.local', 'jugador123', 'jugador', 'Jugador')
  await upsertUser('jugador@darkfantasy.com', 'jugador123', 'jugador', 'Jugador')
  await upsertUser('admin@darkfantasy.local', 'admin123', 'administrador', 'Admin', 10)
  await upsertUser('admin@darkfantasy.com', 'admin123', 'administrador', 'Admin', 10)
  console.log('Usuarios de prueba:')
  console.log('  jugador@darkfantasy.local / jugador123')
  console.log('  jugador@darkfantasy.com / jugador123')
  console.log('  admin@darkfantasy.local / admin123')
  console.log('  admin@darkfantasy.com / admin123')
  await aplicarIntegridad(prisma)
  console.log('Restricciones de saldo, nivel y rol aplicadas.')
}

main()
  .finally(() => prisma.$disconnect())
