-- ============================================================================
-- Viajes · moneda de los servicios y de los pagos a proveedor, y el tipo «Tren»
-- (QA Trappvel 2026-10-29, grupo G9: H6-1, H9-1, H6-3, M9-1).
--
-- Decisiones de Mauricio del 2026-10-29 (ronda 2):
--   5. Se crea el tipo de servicio «Tren» y se puede juntar Tren y Vuelo como opciones del
--      mismo trayecto.
--   7. Autorizada la migración que agrega moneda, monto original y TRM a servicios y pagos a
--      proveedor: SOLO columnas nuevas, sin tocar datos.
--
-- ADITIVA. No escribe, corrige ni rellena ninguna fila de ningún workspace:
--   1. negocio_servicios: moneda, costo_moneda, tasa_cotizada (nulas; null = en pesos). Las copia
--      la app al generar el servicio desde la cotización aceptada. Las filas viejas quedan en
--      null y la app sigue leyendo la moneda del ítem de la cotización (PR #1364).
--   2. gastos: moneda, monto_moneda, tasa_cambio (nulas; null = pagado en pesos). Las escribe la
--      app en el pago a proveedor de un servicio cotizado en otra moneda. Los pagos viejos quedan
--      en null y la app sigue leyendo la TRM del texto del gasto («· USD a TRM 4.230», #1364).
--   3. CHECK de tipo: 'tren' en cotizacion_ranuras.tipo y en negocio_servicios.tipo. Se amplía el
--      CHECK; ninguna fila existente puede tener 'tren' (el CHECK de hoy lo impide).
--
-- Vistas: ninguna se recrea. Las que leen estas tablas (negocio_servicio_fechas, v_mc_*, v_pyl_mes,
-- …) tienen su lista de columnas fija desde que se crearon: una columna nueva no las cambia y su
-- security_invoker queda como está.
--
-- Idempotente: se puede correr dos veces.
-- ============================================================================

-- ── 1. Servicios del viaje: la moneda en que se cotizó ───────────────────────

alter table public.negocio_servicios
  add column if not exists moneda        text,
  add column if not exists costo_moneda  numeric(15, 2),
  add column if not exists tasa_cotizada numeric(12, 4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'negocio_servicios_moneda_coherente'
                   and conrelid = 'public.negocio_servicios'::regclass) then
    -- Las tres juntas o ninguna; la moneda es un código ISO de tres letras y nunca COP (en pesos =
    -- null); el monto y la tasa, positivos.
    alter table public.negocio_servicios
      add constraint negocio_servicios_moneda_coherente check (
        (moneda is null and costo_moneda is null and tasa_cotizada is null)
        or (moneda ~ '^[A-Z]{3}$' and moneda <> 'COP' and costo_moneda > 0 and tasa_cotizada > 0)
      );
  end if;
end $$;

comment on column public.negocio_servicios.moneda is
  'Moneda en que se cotizó el servicio (ISO de 3 letras, nunca COP). Null = en pesos, o fila anterior al 2026-10-29 (la app lee entonces items.tarifa_pax).';
comment on column public.negocio_servicios.costo_moneda is
  'Lo cotizado en esa moneda (costo_cotizado ÷ tasa_cotizada), copiado al generar el servicio. Null = en pesos.';
comment on column public.negocio_servicios.tasa_cotizada is
  'Pesos por unidad de la moneda con que se cotizó (la tasa de la cotización). Null = en pesos.';

-- ── 2. Pago al proveedor: la moneda y la TRM del pago ────────────────────────

alter table public.gastos
  add column if not exists moneda       text,
  add column if not exists monto_moneda numeric(15, 2),
  add column if not exists tasa_cambio  numeric(12, 4);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'gastos_moneda_coherente'
                   and conrelid = 'public.gastos'::regclass) then
    alter table public.gastos
      add constraint gastos_moneda_coherente check (
        (moneda is null and monto_moneda is null and tasa_cambio is null)
        or (moneda ~ '^[A-Z]{3}$' and moneda <> 'COP' and monto_moneda > 0 and tasa_cambio > 0)
      );
  end if;
end $$;

comment on column public.gastos.moneda is
  'Moneda en que se le pagó al proveedor (ISO de 3 letras, nunca COP). Null = en pesos, o pago anterior al 2026-10-29 (la TRM puede venir en la descripción: «· USD a TRM 4.230»).';
comment on column public.gastos.monto_moneda is
  'Lo pagado en esa moneda (monto ÷ tasa_cambio). Null = en pesos.';
comment on column public.gastos.tasa_cambio is
  'TRM del pago: pesos por unidad de la moneda. Separa la diferencia de cambio del sobrecosto del proveedor. Null = en pesos.';

-- ── 3. El tipo «Tren» ────────────────────────────────────────────────────────

-- cotizacion_ranuras: mismo patrón que 20261027174500_cotizacion_ranuras_tipo_paquete.sql (se
-- busca el CHECK por su definición, no por su nombre).
do $$
declare
  restriccion record;
begin
  for restriccion in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.cotizacion_ranuras'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%tipo%'
      and pg_get_constraintdef(c.oid) ilike '%traslado%'
  loop
    execute format('alter table public.cotizacion_ranuras drop constraint %I', restriccion.conname);
  end loop;
end;
$$;

alter table public.cotizacion_ranuras
  add constraint cotizacion_ranuras_tipo_check
  check (tipo in ('vuelo', 'hotel', 'actividad', 'traslado', 'otro', 'paquete', 'tren'));

comment on column public.cotizacion_ranuras.tipo is
  'El tipo del catalogo (ranuras-pantallazo.ts, el primer sinonimo de cada uno): vuelo, hotel, actividad, traslado, tren, otro («Otro servicio») o paquete («Paquete de bloqueo»: hotel + vuelo de un operador, un valor por persona). Otro y paquete solo los escribe la cotizacion por pasos.';

-- negocio_servicios: igual, buscando el CHECK de tipo por su definición.
do $$
declare
  restriccion record;
begin
  for restriccion in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.negocio_servicios'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%tipo%'
      and pg_get_constraintdef(c.oid) ilike '%asistencia%'
  loop
    execute format('alter table public.negocio_servicios drop constraint %I', restriccion.conname);
  end loop;
end;
$$;

alter table public.negocio_servicios
  add constraint negocio_servicios_tipo_check
  check (tipo in ('vuelo', 'hotel', 'traslado', 'actividad', 'asistencia', 'otro', 'tren'));
