import type { PrismaClient } from '@prisma/client'

/**
 * Restricciones que Prisma no expresa en el esquema.
 * Se vuelven a crear al arrancar porque `db push` las puede borrar.
 * Saldo, nivel y rol no aceptan basura (checklist del instructor).
 */
const SQL = `
DO $$
BEGIN
  IF to_regclass('public."Progreso"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progreso_coins_no_negativo') THEN
    ALTER TABLE "Progreso" ADD CONSTRAINT progreso_coins_no_negativo CHECK (coins >= 0);
  END IF;

  IF to_regclass('public."Progreso"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progreso_diamonds_no_negativo') THEN
    ALTER TABLE "Progreso" ADD CONSTRAINT progreso_diamonds_no_negativo CHECK (diamonds >= 0);
  END IF;

  IF to_regclass('public."Progreso"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progreso_wins_no_negativo') THEN
    ALTER TABLE "Progreso" ADD CONSTRAINT progreso_wins_no_negativo CHECK (wins >= 0);
  END IF;

  IF to_regclass('public."Progreso"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'progreso_nivel_valido') THEN
    ALTER TABLE "Progreso"
      ADD CONSTRAINT progreso_nivel_valido
      CHECK ("highestUnlocked" >= 1 AND "highestUnlocked" <= 10);
  END IF;

  IF to_regclass('public."Usuario"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'usuario_rol_valido') THEN
    ALTER TABLE "Usuario"
      ADD CONSTRAINT usuario_rol_valido
      CHECK (rol IN ('jugador', 'administrador'));
  END IF;

  IF to_regclass('public."Partida"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partida_nivel_valido') THEN
    ALTER TABLE "Partida"
      ADD CONSTRAINT partida_nivel_valido
      CHECK (nivel >= 1 AND nivel <= 10);
  END IF;

  IF to_regclass('public."HistorialTransaccion"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historial_tipo_valido') THEN
    ALTER TABLE "HistorialTransaccion"
      ADD CONSTRAINT historial_tipo_valido
      CHECK (tipo IN ('compra', 'intercambio', 'recompensa'));
  END IF;

  IF to_regclass('public."HistorialTransaccion"') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historial_saldos_no_negativos') THEN
    ALTER TABLE "HistorialTransaccion"
      ADD CONSTRAINT historial_saldos_no_negativos
      CHECK ("monedasDespues" >= 0 AND "diamantesDespues" >= 0);
  END IF;
END $$;
`

export async function aplicarIntegridad(db: PrismaClient): Promise<void> {
  await db.$executeRawUnsafe(SQL)
}
