import 'dotenv/config'
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

/** Inicializa las reglas de la tienda necesarias en Supabase (id = 1). */
async function upsertReglaTienda() {
  await prisma.reglaTienda.upsert({
    where: { id: 1 },
    update: {},
    create: {
      id: 1,
      monedasPorDiamante: 100,
      diamantesPorCambio: 10,
      vidaCodigoMinutos: 15,
    },
  })
  console.log('Reglas de la tienda inicializadas (id = 1).')
}

async function main() {
  await upsertNiveles()
  await upsertReglaTienda()
  await prisma.$executeRaw`
    UPDATE "Progreso" p
    SET "xp" = GREATEST(p."xp", cardinality(p."completed") * 100),
        "rankingPoints" = COALESCE((
          SELECT COUNT(*)::int * 25
          FROM "ParticipacionOnline" po
          WHERE po."usuarioId" = p."usuarioId" AND po."esBot" = false AND po."gano" = true
        ), 0),
        "rankingInitialized" = true,
        "progressionInitialized" = true
    WHERE p."progressionInitialized" = false
  `
  await aplicarIntegridad(prisma)
  console.log('Restricciones de saldo, nivel y rol aplicadas.')
}

main()
  .finally(() => prisma.$disconnect())
