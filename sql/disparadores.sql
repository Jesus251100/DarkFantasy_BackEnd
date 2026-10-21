-- Disparadores del bingo. Un disparador es una función que PostgreSQL
-- ejecuta sola cuando entra, cambia o sale una fila.
-- Se vuelven a crear al arrancar, después del catálogo.

DO $disparadores$
BEGIN
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_codigo_nuevo()
RETURNS trigger
LANGUAGE plpgsql
AS $cuerpo$
DECLARE
  minutos integer := 10;
BEGIN
  IF to_regclass('public."ReglaTienda"') IS NOT NULL THEN
    SELECT "vidaCodigoMinutos" INTO minutos
    FROM "ReglaTienda"
    WHERE id = 1;
    IF minutos IS NULL OR minutos < 1 THEN
      minutos := 10;
    END IF;
  END IF;

  UPDATE "CodigoVerificacion"
     SET usado = true
   WHERE correo = NEW.correo
     AND usado = false;

  NEW."expiraEn" := now() + make_interval(mins => minutos);
  NEW.usado := false;
  RETURN NEW;
END;
$cuerpo$
$fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_victoria_anota_nivel()
RETURNS trigger
LANGUAGE plpgsql
AS $cuerpo$
BEGIN
  IF NEW.gano THEN
    INSERT INTO "NivelCompletado" ("usuarioId", "nivelNumero")
    VALUES (NEW."usuarioId", NEW.nivel)
    ON CONFLICT ("usuarioId", "nivelNumero") DO NOTHING;
  END IF;
  RETURN NEW;
END;
$cuerpo$
$fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_alcancia_fecha()
RETURNS trigger
LANGUAGE plpgsql
AS $cuerpo$
BEGIN
  NEW."actualizadoEn" := now();
  RETURN NEW;
END;
$cuerpo$
$fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_alcancia_copia_mochila()
RETURNS trigger
LANGUAGE plpgsql
AS $cuerpo$
BEGIN
  IF to_regclass('public."Booster"') IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO "InventarioBooster" ("usuarioId", "boosterId", cantidad)
  SELECT NEW."usuarioId", b.id, COALESCE((NEW.boosters->>b.id::text)::int, 0)
  FROM "Booster" b
  ON CONFLICT ("usuarioId", "boosterId")
  DO UPDATE SET cantidad = EXCLUDED.cantidad;

  RETURN NEW;
END;
$cuerpo$
$fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_recibo_cuadra()
RETURNS trigger
LANGUAGE plpgsql
AS $cuerpo$
DECLARE
  v_coins integer;
  v_diamonds integer;
BEGIN
  SELECT coins, diamonds INTO v_coins, v_diamonds
  FROM "Progreso"
  WHERE "usuarioId" = NEW."usuarioId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'El recibo no tiene alcancía de ese jugador'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."monedasDespues" IS DISTINCT FROM v_coins
     OR NEW."diamantesDespues" IS DISTINCT FROM v_diamonds THEN
    RAISE EXCEPTION 'El recibo no cuadra con las monedas y diamantes del jugador'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."monedasDespues" - NEW."deltaMonedas" < 0
     OR NEW."diamantesDespues" - NEW."deltaDiamantes" < 0 THEN
    RAISE EXCEPTION 'El movimiento dejaría un saldo anterior negativo'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$cuerpo$
$fn$;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.fn_mochila_no_negativa()
RETURNS trigger
LANGUAGE plpgsql
AS $cuerpo$
BEGIN
  IF NEW.cantidad IS NULL OR NEW.cantidad < 0 THEN
    RAISE EXCEPTION 'La mochila no acepta cantidades negativas'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$cuerpo$
$fn$;

  IF to_regclass('public."CodigoVerificacion"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS disparador_codigo_nuevo ON "CodigoVerificacion"';
    EXECUTE 'CREATE TRIGGER disparador_codigo_nuevo
      BEFORE INSERT ON "CodigoVerificacion"
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_codigo_nuevo()';
    EXECUTE $c$COMMENT ON TRIGGER disparador_codigo_nuevo ON "CodigoVerificacion" IS
      'Al pedir un código nuevo apaga los anteriores y pone la vida que dice ReglaTienda.'$c$;
  END IF;

  IF to_regclass('public."Partida"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS disparador_victoria_anota_nivel ON "Partida"';
    EXECUTE 'CREATE TRIGGER disparador_victoria_anota_nivel
      AFTER INSERT ON "Partida"
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_victoria_anota_nivel()';
    EXECUTE $c$COMMENT ON TRIGGER disparador_victoria_anota_nivel ON "Partida" IS
      'Si la partida se ganó, anota ese nivel en NivelCompletado.'$c$;
  END IF;

  IF to_regclass('public."Progreso"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS disparador_alcancia_fecha ON "Progreso"';
    EXECUTE 'CREATE TRIGGER disparador_alcancia_fecha
      BEFORE UPDATE ON "Progreso"
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_alcancia_fecha()';
    EXECUTE $c$COMMENT ON TRIGGER disparador_alcancia_fecha ON "Progreso" IS
      'Cada vez que cambia la alcancía, guarda la hora en actualizadoEn.'$c$;

    EXECUTE 'DROP TRIGGER IF EXISTS disparador_alcancia_copia_mochila ON "Progreso"';
    EXECUTE 'CREATE TRIGGER disparador_alcancia_copia_mochila
      AFTER INSERT OR UPDATE OF boosters ON "Progreso"
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_alcancia_copia_mochila()';
    EXECUTE $c$COMMENT ON TRIGGER disparador_alcancia_copia_mochila ON "Progreso" IS
      'Copia el JSON de boosters a InventarioBooster.'$c$;
  END IF;

  IF to_regclass('public."HistorialTransaccion"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS disparador_recibo_cuadra ON "HistorialTransaccion"';
    EXECUTE 'CREATE TRIGGER disparador_recibo_cuadra
      BEFORE INSERT ON "HistorialTransaccion"
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_recibo_cuadra()';
    EXECUTE $c$COMMENT ON TRIGGER disparador_recibo_cuadra ON "HistorialTransaccion" IS
      'No deja guardar un recibo cuyo saldo no coincida con Progreso.'$c$;
  END IF;

  IF to_regclass('public."InventarioBooster"') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS disparador_mochila_no_negativa ON "InventarioBooster"';
    EXECUTE 'CREATE TRIGGER disparador_mochila_no_negativa
      BEFORE INSERT OR UPDATE ON "InventarioBooster"
      FOR EACH ROW
      EXECUTE FUNCTION public.fn_mochila_no_negativa()';
    EXECUTE $c$COMMENT ON TRIGGER disparador_mochila_no_negativa ON "InventarioBooster" IS
      'Rechaza una cantidad negativa de objetos.'$c$;
  END IF;
END
$disparadores$;
