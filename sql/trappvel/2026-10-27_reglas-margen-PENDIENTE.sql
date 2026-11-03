-- ============================================================================
-- Trappvel · reglas de margen de la cotización · 2026-10-27
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de configuración de un workspace (no esquema): lo aplica la
-- sesión principal con el «sí» de Mauricio, DESPUÉS de la migración
-- `20261027150000_cotizaciones_reglas_margen.sql` y del deploy del PR que lo acompaña.
--
-- Encargo: proyectos/trappvel/clarity/briefs/2026-10-27_brief-max-reglas-de-margen-cotizacion.md
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- En `config_extra.margen` de la línea «Viaje a medida» de Trappvel:
--   1. Agrega `reglas`: el colchón por tiquete de los vuelos (nacional 10 % entre $30.000 y
--      $80.000; internacional 5 % entre $60.000 y $200.000), el piso de hotel (10 %) y el tope de
--      puntos extra (5).
--   2. Sube el mínimo (`piso_pct`) a 12: es el piso del MARGEN GLOBAL que pide la autorización.
--   3. Sube el aviso (`aviso_pct`) a 12 si estaba por debajo: Mi Negocio no admite un aviso menor
--      que el mínimo.
--   `convencion` (sobre_venta), `default_pct` (15, que ahora es el margen de los hoteles) y
--   `provisional` no se tocan.
--
-- Qué NO cambia: las cotizaciones que ya existen. Las reglas y el mínimo se COPIAN a la
-- cotización al nacer (`cotizaciones.reglas_margen`, `piso_margen_pct`), así que solo las
-- cotizaciones NUEVAS salen con reglas. Un borrador de antes sigue con el 15 % plano.
--
-- Idempotente. Aborta si la línea no es la medida o si su margen no es `sobre_venta`.
-- Reversa: 2026-10-27_reglas-margen-REVERSA.sql
-- Probado en PGlite: src/lib/cotizaciones/reglas-margen-sql.test.ts
-- ============================================================================

do $$
declare
  v_ws    constant uuid := 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc';
  v_linea constant uuid := '42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887';
  v_reglas constant jsonb := jsonb_build_object(
    'colchon_vuelo', jsonb_build_object(
      'nacional',      jsonb_build_object('pct', 10, 'piso', 30000, 'techo', 80000),
      'internacional', jsonb_build_object('pct', 5,  'piso', 60000, 'techo', 200000)
    ),
    'piso_hotel_pct', 10,
    'puntos_extra_max', 5
  );
  v_cfg    jsonb;
  v_margen jsonb;
  v_aviso  numeric;
begin
  select config_extra into v_cfg from public.lineas_negocio where id = v_linea and workspace_id = v_ws for update;
  if not found then
    raise exception 'La línea % no es del workspace % (o no existe)', v_linea, v_ws;
  end if;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);
  v_margen := v_cfg -> 'margen';
  if v_margen is null or jsonb_typeof(v_margen) <> 'object' then
    raise exception 'La línea % no declara config_extra.margen: no es la medida', v_linea;
  end if;
  if v_margen ->> 'convencion' is distinct from 'sobre_venta' then
    raise exception 'El margen de la línea % no es sobre_venta (%): las reglas suponen margen sobre el precio de venta', v_linea, v_margen ->> 'convencion';
  end if;

  v_aviso := nullif(v_margen ->> 'aviso_pct', '')::numeric;
  v_margen := v_margen
    || jsonb_build_object('reglas', v_reglas, 'piso_pct', 12)
    || jsonb_build_object('aviso_pct', greatest(12, coalesce(v_aviso, 12)));

  update public.lineas_negocio
     set config_extra = jsonb_set(v_cfg, '{margen}', v_margen)
   where id = v_linea and workspace_id = v_ws;

  raise notice 'Reglas de margen en la línea %: %', v_linea, v_margen;
end $$;
