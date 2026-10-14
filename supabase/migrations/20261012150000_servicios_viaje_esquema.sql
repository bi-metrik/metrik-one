-- ============================================================================
-- F0 · Modelo de servicios del viaje (post-cotización, Trappvel → ONE core).
--
-- Plan aprobado el 2026-10-11 (D1: eje servicio a servicio). Cada servicio de la tarifa aceptada
-- (hotel, vuelo, traslado, actividad, asistencia) se vuelve una fila que recorre reserva → fecha
-- límite → pago con soporte → voucher → confirmación. El pago al proveedor es un `gastos` atado a
-- la fila, para que resumen financiero, Ejecución, /movimientos, el contador y el bot ya lo lean.
--
-- SOLO ESQUEMA más una fila de catálogo (`bloque_definitions`). No escribe ni corrige ninguna fila
-- de ningún workspace. Todo lo que se construye encima queda detrás de
-- `lineas_negocio.config_extra.servicios_viaje.activo` (ausente = apagado = como hoy).
--
-- Resoluciones de Vera (vera-criterios-post-cotizacion-2026-10-12) que cambian el diseño técnico:
--   · C6: solo «por reservar», «reservado» y «cancelado» se ESCRIBEN. «Pagado», «Confirmado» y
--     «Esperando a Edgar» se derivan de la plata y de las aprobaciones; un estado escrito a mano
--     que no coincide con la plata es el defecto que este plan vino a quitar.
--   · C13: comisión mínima del proveedor (`comision_esperada`, `comision_estado`). No bloquea.
--   · §7.2.2: las cortesías van solo como gasto `cortesia_viaje`, no como fila de servicio (si
--     fueran las dos cosas, contarían dos veces en el costo real).
--   · F4-3: tipo de aprobación `enviar_paquete_sin_cobro`.
--   · F0-8: CHECK ampliados LEYENDO el vivo y fallando si su forma no es la esperada; RLS por
--     workspace; `aprobaciones_excepcion` sin escritura para `authenticated`.
--
-- Partes:
--   1. negocio_servicios
--   2. gastos: servicio_id, medio_pago, titular_medio + categorías de viaje en el CHECK
--   3. aprobaciones_excepcion (escribe solo el servidor)
--   4. notificaciones: tipos y entidades nuevos
--   5. bloque_definitions: tipo `servicios`
-- ============================================================================

-- ── 1. Servicios del viaje ───────────────────────────────────────────────────

-- Lo lee y escribe la sesión (`authenticated`) por workspace; el rol de quien edita lo revisan las
-- acciones del servidor (Vera C15), no la base.
create table public.negocio_servicios (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  negocio_id           uuid not null references public.negocios(id) on delete cascade,
  cotizacion_id        uuid references public.cotizaciones(id) on delete set null,
  -- La tarifa aceptada de la que salió (cotizacion_itinerarios). Null en una fila manual.
  itinerario_id        uuid references public.cotizacion_itinerarios(id) on delete set null,
  -- El ítem de la cotización de origen. Con `negocio_id`, la llave de idempotencia de la generación.
  item_id              uuid references public.items(id) on delete set null,
  tipo                 text not null
                       check (tipo in ('vuelo', 'hotel', 'traslado', 'actividad', 'asistencia', 'otro')),
  nombre               text not null check (length(btrim(nombre)) between 1 and 200),
  proveedor_nombre     text check (proveedor_nombre is null or length(proveedor_nombre) <= 200),
  proveedor_empresa_id uuid references public.empresas(id) on delete set null,
  localizador          text check (localizador is null or length(localizador) <= 100),
  -- Solo lo que se escribe a mano (C6). Pagado / Confirmado / Esperando a Edgar se derivan.
  estado               text not null default 'por_reservar'
                       check (estado in ('por_reservar', 'reservado', 'cancelado')),
  fecha_servicio       date,
  fecha_limite_pago    date,
  -- Copia en COP al generar: la cotización se puede corregir después y el presupuesto de la fila no.
  costo_cotizado       numeric(15, 2) not null default 0 check (costo_cotizado >= 0),
  -- Si el proveedor cobra distinto de lo cotizado. Null = costo_cotizado.
  valor_por_pagar      numeric(15, 2) check (valor_por_pagar is null or valor_por_pagar >= 0),
  -- Referencias `one://` (src/lib/almacenamiento/referencia.ts), nunca un link pegado (F0-6).
  voucher_ref          text,
  confirmacion_ref     text,
  confirmado_at        timestamptz,
  -- Comisión del proveedor (C13): se muestra aparte en el cierre y no entra al margen real.
  comision_esperada    numeric(15, 2) check (comision_esperada is null or comision_esperada >= 0),
  comision_estado      text check (comision_estado in ('por_cobrar', 'llego', 'perdida')),
  responsable_staff_id uuid references public.staff(id) on delete set null,
  orden                integer not null default 0,
  origen               text not null default 'cotizacion' check (origen in ('cotizacion', 'manual')),
  created_by           uuid references public.staff(id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint negocio_servicios_comision_coherente
    check (comision_estado is null or comision_esperada is not null)
);

-- Idempotencia de la generación (F0-3): un ítem de la cotización, una fila por negocio.
create unique index negocio_servicios_item_unico
  on public.negocio_servicios (negocio_id, item_id) where item_id is not null;
create index idx_negocio_servicios_negocio on public.negocio_servicios (negocio_id, orden);
-- Lo que lee el motor de recordatorios de fecha límite (PR 4).
create index idx_negocio_servicios_limite
  on public.negocio_servicios (workspace_id, fecha_limite_pago)
  where estado in ('por_reservar', 'reservado') and fecha_limite_pago is not null;

alter table public.negocio_servicios enable row level security;
revoke all on table public.negocio_servicios from public, anon;
create policy negocio_servicios_ws on public.negocio_servicios for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update, delete on public.negocio_servicios to authenticated;

comment on table public.negocio_servicios is
  'Servicios que la empresa compra a proveedores para cumplir la venta (F0 post-cotización). Una fila por ítem de la tarifa aceptada; el pago es gastos.servicio_id. Estado escrito: por_reservar/reservado/cancelado; pagado/confirmado/esperando se derivan.';

-- ── 2. Pago al proveedor = gastos ────────────────────────────────────────────

alter table public.gastos
  add column if not exists servicio_id   uuid references public.negocio_servicios(id) on delete set null,
  -- id de workspaces.config_extra.medios_pago_proveedor
  add column if not exists medio_pago    text,
  -- Sale del medio; nadie lo escoge aparte (F3-2).
  add column if not exists titular_medio text check (titular_medio in ('empresa', 'personal'));
create index if not exists idx_gastos_servicio on public.gastos (servicio_id) where servicio_id is not null;

-- Categorías de viaje. Se amplía LEYENDO el CHECK vivo, no reescribiendo la lista: si producción
-- tiene una categoría que las migraciones no muestran, se conserva.
do $$
declare
  v_def text;
  v_nueva text;
  v_cat text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'gastos_categoria_check'
     and conrelid = 'public.gastos'::regclass;
  if v_def is null then
    raise exception 'servicios_viaje: no existe gastos_categoria_check; no se amplía a ciegas';
  end if;

  v_nueva := v_def;
  foreach v_cat in array array['proveedor_viaje', 'cortesia_viaje'] loop
    if position(quote_literal(v_cat) in v_nueva) = 0 then
      -- Forma de Postgres: CHECK ((categoria = ANY (ARRAY['a'::text, 'b'::text])))
      v_nueva := regexp_replace(v_nueva, '\]\)\)\)$', format(', %s::text])))', quote_literal(v_cat)));
      if position(quote_literal(v_cat) in v_nueva) = 0 then
        raise exception 'servicios_viaje: forma inesperada de gastos_categoria_check: %', v_def;
      end if;
    end if;
  end loop;

  if v_nueva <> v_def then
    alter table public.gastos drop constraint gastos_categoria_check;
    execute format('alter table public.gastos add constraint gastos_categoria_check %s', v_nueva);
  end if;
end $$;

-- ── 3. Aprobaciones por excepción ────────────────────────────────────────────

-- Decide plata: la escribe solo el servidor (service_role) después de revisar el rol de quien
-- pide y de quien aprueba. La sesión solo lee las de su workspace (para pintar «Esperando a
-- Edgar»). Una aprobación que no caduca sola cuando cambia lo aprobado no controla nada: `huella`
-- guarda lo aprobado y el servidor la compara antes de darla por vigente.
create table public.aprobaciones_excepcion (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  entidad_tipo   text not null check (entidad_tipo in ('servicio', 'gasto', 'plan_pago', 'etapa', 'factura')),
  entidad_id     uuid not null,
  tipo           text not null check (tipo in (
                   'pago_sin_abono', 'medio_personal', 'desviacion_costo',
                   'plan_fuera_de_regla', 'forzar_factura', 'enviar_paquete_sin_cobro')),
  estado         text not null default 'solicitada'
                 check (estado in ('solicitada', 'aprobada', 'rechazada', 'caducada')),
  huella         text not null check (length(btrim(huella)) > 0),
  detalle        jsonb not null default '{}'::jsonb,
  motivo         text,
  solicitada_por uuid references public.staff(id) on delete set null,
  solicitada_at  timestamptz not null default now(),
  decidida_por   uuid references public.staff(id) on delete set null,
  decidida_at    timestamptz,
  -- «No aprobar» exige motivo (F3-4).
  constraint aprobaciones_excepcion_rechazo_con_motivo
    check (estado <> 'rechazada' or length(btrim(coalesce(motivo, ''))) > 0),
  constraint aprobaciones_excepcion_decision_con_autor
    check (estado not in ('aprobada', 'rechazada') or (decidida_por is not null and decidida_at is not null))
);

-- Una sola pedida o vigente por entidad y tipo (§7.2.1).
create unique index aprobaciones_excepcion_vigente
  on public.aprobaciones_excepcion (entidad_id, tipo) where estado in ('solicitada', 'aprobada');
create index idx_aprobaciones_excepcion_negocio on public.aprobaciones_excepcion (negocio_id, estado);
create index idx_aprobaciones_excepcion_pendientes
  on public.aprobaciones_excepcion (workspace_id, solicitada_at) where estado = 'solicitada';

alter table public.aprobaciones_excepcion enable row level security;
revoke all on table public.aprobaciones_excepcion from public, anon, authenticated;
create policy aprobaciones_excepcion_lee on public.aprobaciones_excepcion for select
  using (workspace_id = (select public.current_user_workspace_id()));
grant select on public.aprobaciones_excepcion to authenticated;

comment on table public.aprobaciones_excepcion is
  'Aprobaciones de dirección por excepción (pago sin abono, tarjeta personal, desviación de costo, plan fuera de regla, forzar factura, paquete sin cobro). Escribe solo service_role; authenticated lee por workspace.';

-- ── 4. Notificaciones ────────────────────────────────────────────────────────

-- Mismo método: se agregan a lo que haya en la base, fallando si la forma no es la esperada.
do $$
declare
  v_tabla constant regclass := 'public.notificaciones'::regclass;
  v_cambios constant jsonb := jsonb_build_object(
    'notificaciones_tipo_check', jsonb_build_array(
      'pago_proveedor_por_vencer', 'pago_proveedor_vencido', 'cuota_por_vencer',
      'aprobacion_pendiente', 'aprobacion_decidida', 'toque_seguimiento', 'viaje_sin_listo'),
    'notificaciones_entidad_tipo_check', jsonb_build_array('servicio', 'plan_pago'));
  v_nombre text;
  v_def text;
  v_nueva text;
  v_valor text;
begin
  for v_nombre in select jsonb_object_keys(v_cambios) loop
    select pg_get_constraintdef(oid) into v_def
      from pg_constraint where conname = v_nombre and conrelid = v_tabla;
    if v_def is null then
      raise exception 'servicios_viaje: no existe %; no se amplía a ciegas', v_nombre;
    end if;

    v_nueva := v_def;
    for v_valor in select jsonb_array_elements_text(v_cambios -> v_nombre) loop
      if position(quote_literal(v_valor) in v_nueva) = 0 then
        v_nueva := regexp_replace(v_nueva, '\]\)\)\)$', format(', %s::text])))', quote_literal(v_valor)));
        if position(quote_literal(v_valor) in v_nueva) = 0 then
          raise exception 'servicios_viaje: forma inesperada de %: %', v_nombre, v_def;
        end if;
      end if;
    end loop;

    if v_nueva <> v_def then
      execute format('alter table public.notificaciones drop constraint %I', v_nombre);
      execute format('alter table public.notificaciones add constraint %I %s', v_nombre, v_nueva);
    end if;
  end loop;
end $$;

-- ── 5. Bloque «Servicios del viaje» ──────────────────────────────────────────

do $$
declare
  v_def text;
  v_nueva text;
  v_codigo_de text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'bloque_definitions_tipo_check'
     and conrelid = 'public.bloque_definitions'::regclass;
  if v_def is null then
    raise exception 'servicios_viaje: no existe bloque_definitions_tipo_check; no se amplía a ciegas';
  end if;

  if position('''servicios''' in v_def) = 0 then
    v_nueva := regexp_replace(v_def, '\]\)\)\)$', ', ''servicios''::text])))');
    if position('''servicios''' in v_nueva) = 0 then
      raise exception 'servicios_viaje: forma inesperada de bloque_definitions_tipo_check: %', v_def;
    end if;
    alter table public.bloque_definitions drop constraint bloque_definitions_tipo_check;
    execute format('alter table public.bloque_definitions add constraint bloque_definitions_tipo_check %s', v_nueva);
  end if;

  if exists (select 1 from public.bloque_definitions where tipo = 'servicios') then
    return;
  end if;

  -- `codigo` es único. Si B32 ya es de otro bloque, se frena en vez de inventar otro código.
  select tipo into v_codigo_de from public.bloque_definitions where codigo = 'B32';
  if v_codigo_de is not null then
    raise exception 'servicios_viaje: el código B32 ya es del bloque %', v_codigo_de;
  end if;

  insert into public.bloque_definitions
    (codigo, tipo, nombre, descripcion, is_visualization, can_be_gate, supports_array_items, default_estado, icon_name)
  values
    ('B32', 'servicios', 'Servicios del viaje',
     'Una fila por servicio de la tarifa aceptada (vuelo, hotel, traslado, actividad, asistencia) con proveedor, localizador, fecha límite de pago, soporte, voucher y confirmación. El pago al proveedor es un gasto del negocio atado a la fila',
     false, false, false, 'editable', 'Luggage');
end $$;
