-- ============================================================
-- 20260927000001_fechas_bogota_festivos_calculados
-- ============================================================
-- Desde 2026-09-27 la referencia de todo el sistema es la hora de Bogota (UTC-5,
-- sin horario de verano) y los festivos de Colombia. La instancia Postgres corre
-- en UTC (`SHOW TimeZone` = UTC), asi que entre las 19:00 y la medianoche de
-- Bogota `CURRENT_DATE` ya es mañana y `date_trunc('day', ts)` corta el dia cinco
-- horas antes.
--
-- Esta migracion NO reescribe filas de ninguna tabla de negocio. Hace:
--
--   1. `hoy_bogota()`: el dia civil de Bogota, para reemplazar `CURRENT_DATE`.
--   2. Festivos CALCULADOS (Ley 51 de 1983 + Pascua de Meeus):
--      `pascua_gregoriana(anio)` y `festivos_colombia_de(anio)`. Espejo de
--      `src/lib/dates/festivos-colombia.ts` y de `calendario-co.py`.
--      Antes de sembrar, comprueba que el calculo coincida con 2026 y 2027 tal
--      como estaban escritos a mano; si no coincide, la migracion aborta.
--   3. Siembra `festivos_colombia` de 2025 a 2100 desde el calculo. La tabla se
--      queda como cache (la leen por fila `horas_habiles_entre`,
--      `horas_habiles_jornada`, `dias_habiles_entre` y la app), pero ya no se
--      escribe a mano. Efecto visible: `festivos_hasta_anio` pasa de 2027 a 2100
--      y el aviso de "calendario sin sembrar" del tablero de operaciones se apaga.
--      Unico dato que se inserta, y es de referencia, no de cliente.
--   4. `horas_habiles_entre`: corta los dias en Bogota, como ya lo hacia
--      `horas_habiles_jornada`. ⚠️ Mueve veredictos de SLA en /flujo y /equipo
--      para rangos que empiezan o terminan entre 19:00 y 23:59 de Bogota. El espejo
--      TS (`src/lib/negocios/horas-habiles.ts`) cambia en el mismo PR.
--   5. Reemplaza `CURRENT_DATE` por `hoy_bogota()` en las 9 funciones que lo usan
--      (inventario leido de produccion el 2026-09-27, no de este repo: el ledger
--      esta derivado y el repo puede no tener la ultima version de cada una):
--        fn_auto_cerrar_proyecto_entregado  fecha_cierre = CURRENT_DATE
--        get_comercial_kpis_mes_soena       mes en curso y dia del mes (ritmo)
--        get_comercial_perfil_soena         date_trunc('month', CURRENT_DATE)
--        get_comercial_serie_mensual_soena  idem
--        get_comercial_serie_seccional_soena idem
--        get_comercial_serie_vendedor_soena idem
--        get_next_cotizacion_consecutivo    año del consecutivo COT-YYYY
--        plazos_pendientes                  dias habiles hasta hoy, año en curso
--        recalcular_margen                  ventana de 6 meses
--      Se hace sobre `pg_get_functiondef` para no pisar la version viva con una
--      copia vieja. CREATE OR REPLACE FUNCTION conserva owner, grants, SECURITY
--      DEFINER y search_path.
--   6. DEFAULT de las 13 columnas `date` que usaban CURRENT_DATE. Solo cambia el
--      default para filas nuevas; no toca filas existentes (ALTER ... SET DEFAULT
--      es solo catalogo).
--
-- Fuera de alcance (anotado para despues): las vistas `v_cartera_negocio` y
-- `v_facturas_estado` restan dias con CURRENT_DATE. Reescribir una vista con
-- CREATE OR REPLACE borra `security_invoker`, asi que van en su propio PR.
-- ============================================================


-- ------------------------------------------------------------
-- 1. Dia civil de Bogota
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.hoy_bogota()
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (now() AT TIME ZONE 'America/Bogota')::date
$$;

COMMENT ON FUNCTION public.hoy_bogota() IS
  'Dia civil de Bogota (UTC-5 fijo). Usar en lugar de CURRENT_DATE: la instancia corre en UTC y desde las 19:00 de Bogota CURRENT_DATE ya es mañana.';

REVOKE EXECUTE ON FUNCTION public.hoy_bogota() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hoy_bogota() TO authenticated, service_role;


-- ------------------------------------------------------------
-- 2. Festivos calculados
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pascua_gregoriana(p_anio integer)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  a int := p_anio % 19;
  b int := p_anio / 100;
  c int := p_anio % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
BEGIN
  RETURN make_date(
    p_anio,
    (h + l - 7 * m + 114) / 31,
    (h + l - 7 * m + 114) % 31 + 1
  );
END;
$$;

COMMENT ON FUNCTION public.pascua_gregoriana(integer) IS
  'Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). Base de los festivos moviles de Colombia.';

CREATE OR REPLACE FUNCTION public.festivos_colombia_de(p_anio integer)
RETURNS TABLE (fecha date, descripcion text)
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  WITH p AS (SELECT public.pascua_gregoriana(p_anio) AS pascua),
  base (fecha, descripcion, emiliani) AS (
    SELECT make_date(p_anio, 1, 1),   'Año Nuevo',                  false FROM p UNION ALL
    SELECT make_date(p_anio, 1, 6),   'Reyes Magos',                true  FROM p UNION ALL
    SELECT make_date(p_anio, 3, 19),  'San José',                   true  FROM p UNION ALL
    SELECT pascua - 3,                'Jueves Santo',               false FROM p UNION ALL
    SELECT pascua - 2,                'Viernes Santo',              false FROM p UNION ALL
    SELECT make_date(p_anio, 5, 1),   'Día del Trabajo',            false FROM p UNION ALL
    SELECT pascua + 39,               'Ascensión del Señor',        true  FROM p UNION ALL
    SELECT pascua + 60,               'Corpus Christi',             true  FROM p UNION ALL
    SELECT pascua + 68,               'Sagrado Corazón',            true  FROM p UNION ALL
    SELECT make_date(p_anio, 6, 29),  'San Pedro y San Pablo',      true  FROM p UNION ALL
    SELECT make_date(p_anio, 7, 20),  'Independencia',              false FROM p UNION ALL
    SELECT make_date(p_anio, 8, 7),   'Batalla de Boyacá',          false FROM p UNION ALL
    SELECT make_date(p_anio, 8, 15),  'Asunción de la Virgen',      true  FROM p UNION ALL
    SELECT make_date(p_anio, 10, 12), 'Día de la Raza',             true  FROM p UNION ALL
    SELECT make_date(p_anio, 11, 1),  'Todos los Santos',           true  FROM p UNION ALL
    SELECT make_date(p_anio, 11, 11), 'Independencia de Cartagena', true  FROM p UNION ALL
    SELECT make_date(p_anio, 12, 8),  'Inmaculada Concepción',      false FROM p UNION ALL
    SELECT make_date(p_anio, 12, 25), 'Navidad',                    false FROM p
  )
  -- Ley Emiliani: si no cae lunes, pasa al lunes siguiente (dow: 0 = domingo, 1 = lunes).
  SELECT
    CASE WHEN emiliani THEN fecha + ((8 - EXTRACT(DOW FROM fecha)::int) % 7) ELSE fecha END,
    descripcion
  FROM base
  ORDER BY 1;
$$;

COMMENT ON FUNCTION public.festivos_colombia_de(integer) IS
  'Festivos de Colombia del año, calculados (Ley 51/1983 + Pascua). Pueden salir dos en la misma fecha (2025-06-30). Espejo: src/lib/dates/festivos-colombia.ts.';

REVOKE EXECUTE ON FUNCTION public.pascua_gregoriana(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.festivos_colombia_de(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pascua_gregoriana(integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.festivos_colombia_de(integer) TO authenticated, service_role;


-- ------------------------------------------------------------
-- 3. El calculo tiene que coincidir con lo sembrado a mano; luego se siembra
-- ------------------------------------------------------------
DO $$
DECLARE
  v_diff int;
BEGIN
  SELECT count(*) INTO v_diff FROM (
    (SELECT fecha FROM public.festivos_colombia WHERE EXTRACT(YEAR FROM fecha) IN (2026, 2027)
     EXCEPT
     SELECT f.fecha FROM generate_series(2026, 2027) a, public.festivos_colombia_de(a) f)
    UNION ALL
    (SELECT f.fecha FROM generate_series(2026, 2027) a, public.festivos_colombia_de(a) f
     WHERE EXISTS (SELECT 1 FROM public.festivos_colombia x WHERE EXTRACT(YEAR FROM x.fecha) = a)
     EXCEPT
     SELECT fecha FROM public.festivos_colombia WHERE EXTRACT(YEAR FROM fecha) IN (2026, 2027))
  ) d;
  IF v_diff > 0 THEN
    RAISE EXCEPTION 'festivos_colombia_de no coincide con los festivos sembrados de 2026-2027 (% fechas distintas)', v_diff;
  END IF;
END;
$$;

INSERT INTO public.festivos_colombia (fecha, descripcion)
SELECT f.fecha, string_agg(f.descripcion, ' y ' ORDER BY f.descripcion)
FROM generate_series(2025, 2100) AS a, public.festivos_colombia_de(a) AS f
GROUP BY f.fecha
ON CONFLICT (fecha) DO NOTHING;

COMMENT ON TABLE public.festivos_colombia IS
  'Festivos de Colombia 2025-2100, sembrados desde festivos_colombia_de(anio) (Ley 51/1983 + Pascua). Es cache del calculo: no se escribe a mano. Migracion 20260927000001.';


-- ------------------------------------------------------------
-- 4. horas_habiles_entre corta los dias en Bogota
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horas_habiles_entre(start_ts timestamp with time zone, end_ts timestamp with time zone)
RETURNS numeric
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  total_hours NUMERIC;
  non_business_days INTEGER;
BEGIN
  IF start_ts IS NULL OR end_ts IS NULL OR end_ts <= start_ts THEN
    RETURN 0;
  END IF;

  -- Total horas calendario
  total_hours := EXTRACT(EPOCH FROM (end_ts - start_ts)) / 3600.0;

  -- Contar dias sab/dom/festivo en el rango [dia(inicio), dia(fin)), con los dias
  -- cortados en Bogota. Antes era date_trunc('day', ts) con la instancia en UTC:
  -- el viernes a las 19:00 de Bogota ya contaba como sabado.
  SELECT COUNT(*) INTO non_business_days
  FROM generate_series(
    (start_ts AT TIME ZONE 'America/Bogota')::date,
    (end_ts AT TIME ZONE 'America/Bogota')::date - 1,
    INTERVAL '1 day'
  ) AS d
  WHERE EXTRACT(ISODOW FROM d) IN (6, 7)
     OR d::date IN (SELECT fecha FROM public.festivos_colombia);

  RETURN GREATEST(total_hours - (non_business_days * 24), 0);
END;
$function$;

-- CREATE OR REPLACE conserva la ACL (hoy: postgres, authenticated, service_role).
-- El revoke es idempotente y deja la decision escrita.
REVOKE EXECUTE ON FUNCTION public.horas_habiles_entre(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon;

COMMENT ON FUNCTION public.horas_habiles_entre(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Horas habiles entre dos timestamps. Un dia (de Bogota) sabado/domingo/festivo cuenta 0h, un dia L-V no-festivo cuenta 24h. Usado para calcular SLA por etapa. Espejo: src/lib/negocios/horas-habiles.ts.';


-- ------------------------------------------------------------
-- 5. CURRENT_DATE → hoy_bogota() en las funciones vivas
-- ------------------------------------------------------------
DO $$
DECLARE
  r record;
  v_def text;
  v_nuevo text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.proname IN (
        'fn_auto_cerrar_proyecto_entregado',
        'get_comercial_kpis_mes_soena',
        'get_comercial_perfil_soena',
        'get_comercial_serie_mensual_soena',
        'get_comercial_serie_seccional_soena',
        'get_comercial_serie_vendedor_soena',
        'get_next_cotizacion_consecutivo',
        'plazos_pendientes',
        'recalcular_margen'
      )
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_nuevo := regexp_replace(v_def, '\mcurrent_date\M', 'public.hoy_bogota()', 'gi');
    IF v_nuevo <> v_def THEN
      EXECUTE v_nuevo;
      RAISE NOTICE 'hoy_bogota: reescrita %', r.proname;
    END IF;
  END LOOP;

  -- Ninguna funcion de public puede quedar leyendo CURRENT_DATE.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f'
      AND pg_get_functiondef(p.oid) ~* '\mcurrent_date\M'
  ) THEN
    RAISE EXCEPTION 'quedan funciones en public con CURRENT_DATE: %', (
      SELECT string_agg(p.proname, ', ') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.prokind = 'f' AND pg_get_functiondef(p.oid) ~* '\mcurrent_date\M'
    );
  END IF;
END;
$$;


-- ------------------------------------------------------------
-- 6. DEFAULT de las columnas date: dia de Bogota
-- ------------------------------------------------------------
-- Mismo literal que ya usa proceso_snapshots.tomado_en. Sin funcion propia a
-- proposito: un DEFAULT que depende de una funcion impide recrearla sin tocar la tabla.
ALTER TABLE public.cobros                   ALTER COLUMN fecha               SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.gastos                   ALTER COLUMN fecha               SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.horas                    ALTER COLUMN fecha               SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.cuentas_cobro_emitidas   ALTER COLUMN fecha_emision       SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.facturas                 ALTER COLUMN fecha_emision       SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.payments                 ALTER COLUMN payment_date        SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.expenses                 ALTER COLUMN expense_date        SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.time_entries             ALTER COLUMN entry_date          SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.proyectos                ALTER COLUMN fecha_inicio        SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.riesgos                  ALTER COLUMN fecha_identificacion SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.compliance_sujetos       ALTER COLUMN relacion_desde      SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.compliance_liberaciones  ALTER COLUMN vigente_desde       SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
ALTER TABLE public.compliance_aceptaciones  ALTER COLUMN fecha_aceptacion    SET DEFAULT ((now() AT TIME ZONE 'America/Bogota'))::date;
