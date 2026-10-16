import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { aplicarIntegridad } from '../src/infrastructure/aplicarIntegridad'
import { COIN_REWARD, DIAMOND_REWARD, coinsPorRepeticion } from '../src/domain/campania/Recompensa'
import { MAX_LEVEL } from '../src/domain/campania/IRepositorioCampania'
import { urlBaseDatos } from '../src/infrastructure/conexionBd'

const adapter = new PrismaPg({ connectionString: urlBaseDatos() })
const prisma = new PrismaClient({ adapter })

/** Nivel mínimo requerido por la FK de `Partida.nivel` -> `Nivel.numero`. */
async function upsertNiveles() {
  for (let numero = 1; numero <= MAX_LEVEL; numero += 1) {
    const esFinal = numero === MAX_LEVEL
    await prisma.nivel.upsert({
      where: { numero },
      update: {},
      create: {
        numero,
        claveSesion: `level-${numero}`,
        pista: `Completa el nivel ${numero}`,
        muestraJefe: esFinal,
        fondo: esFinal ? 'final' : 'gif',
        monedasPrimeraVez: COIN_REWARD[numero] ?? 50,
        monedasRepeticion: coinsPorRepeticion(numero),
        diamantesPrimeraVez: DIAMOND_REWARD[numero] ?? 0,
        reaccionBaseMs: 1200,
        jitterMs: 300,
        probabilidadFallo: 0.15,
        apuntaAlPatron: true,
      },
    })
  }
  console.log(`Niveles cargados: 1-${MAX_LEVEL}`)
}

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
  await upsertNiveles()
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
