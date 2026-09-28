-- ============================================================================
-- Ferretería: los pagos de Wompi de Dimpro entran solos a ONE.
--
-- Pedido de Mauricio (28-sep): "llevar el control por ONE". Dimpro cobra por links de pago de Wompi
-- (uso único, precio fijo, `sku` = código de la publicación, p. ej. MP-26). Wompi avisa cada cambio
-- de estado de una transacción a la URL de eventos del comercio; el endpoint
-- `/api/ferreteria/wompi/eventos` verifica la firma, guarda el evento aquí y, si es un pago
-- APROBADO de un link con una publicación que existe, registra la venta anticipada por la misma
-- acción que usa la pantalla ("Registrar venta" → negocio de ONE en la línea Ferretería).
--
-- Solo ESQUEMA. No escribe ni corrige ninguna fila existente:
--   1. `ferreteria_pagos_wompi`, server-only (la escribe y la lee el servidor con service_role).
--   2. Un tipo nuevo de notificación, `ferreteria_pago`, para la campana de Dietmar.
-- ============================================================================

-- ── 1. Eventos de Wompi ──────────────────────────────────────────────────────

-- server-only: la escribe el webhook de Wompi y la lee la pestaña Ferretería, las dos con
-- service_role acotando por workspace. Guarda datos del comprador (documento, teléfono, dirección
-- de envío) y el evento crudo: el navegador no la lee directo.
create table public.ferreteria_pagos_wompi (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  -- Id de la transacción en Wompi (p. ej. 1234-1610641025-49201). Con el estado, la llave de
  -- idempotencia: Wompi reintenta el mismo evento hasta tres veces en 24 horas.
  transaccion_id text not null check (length(btrim(transaccion_id)) > 0),
  estado_wompi text not null check (estado_wompi in ('PENDING', 'APPROVED', 'DECLINED', 'VOIDED', 'ERROR')),
  -- 'prod' o 'test' (sandbox). Un evento de sandbox se guarda y nunca registra una venta.
  entorno text not null check (entorno in ('prod', 'test')),
  payment_link_id text,
  -- El `sku` del link = código de la publicación. Null si el link no lo trae.
  sku text,
  publicacion_id uuid references public.ferreteria_publicaciones(id),
  referencia text,
  metodo_pago text,
  monto numeric(14, 2),
  moneda text,
  -- Cuándo quedó el pago en su estado final (finalized_at de Wompi; si falta, created_at).
  pagado_at timestamptz,
  comprador_nombre text,
  comprador_email text,
  comprador_telefono text,
  comprador_documento text,
  -- Dirección de envío tal como la manda Wompi (address_line_1, city, region, phone_number, ...).
  envio jsonb,
  payload jsonb not null,
  -- Qué hizo ONE con el evento:
  --   recibido / procesando: de paso (una fila que se queda aquí es un corte a mitad; se reintenta)
  --   registrada: la venta y su negocio existen (venta_id)
  --   pendiente_asignar: pago aprobado sin publicación reconocible (sin sku o sku desconocido)
  --   solo_guardado: no es un pago aprobado de producción por link (rechazado, anulado, sandbox...)
  --   error: se intentó registrar y no se pudo (motivo)
  registro text not null default 'recibido'
    check (registro in ('recibido', 'procesando', 'registrada', 'pendiente_asignar', 'solo_guardado', 'error')),
  motivo text,
  venta_id uuid references public.ferreteria_ventas(id),
  veces_recibido integer not null default 1 check (veces_recibido > 0),
  recibido_at timestamptz not null default now(),
  procesado_at timestamptz,
  constraint ferreteria_pagos_wompi_evento_unico unique (transaccion_id, estado_wompi),
  constraint ferreteria_pagos_wompi_registrada_con_venta
    check (registro <> 'registrada' or venta_id is not null)
);

-- Una transacción, a lo sumo una venta.
create unique index ferreteria_pagos_wompi_venta_unica
  on public.ferreteria_pagos_wompi (venta_id) where venta_id is not null;

create index idx_ferreteria_pagos_wompi_ws on public.ferreteria_pagos_wompi (workspace_id, recibido_at desc);

alter table public.ferreteria_pagos_wompi enable row level security;
revoke all on table public.ferreteria_pagos_wompi from public, anon, authenticated;

comment on table public.ferreteria_pagos_wompi is
  'Eventos de Wompi del comercio de Dimpro (transaction.updated). Server-only: webhook /api/ferreteria/wompi/eventos y pestaña Ferretería con service_role.';

-- ── 2. Notificación del pago aprobado ────────────────────────────────────────

-- Se amplía el CHECK de `notificaciones.tipo` LEYENDO el que está en la base, no reescribiendo
-- la lista a mano: si producción tiene un tipo que las migraciones no muestran, se conserva.
do $$
declare
  v_def text;
  v_nueva text;
begin
  select pg_get_constraintdef(oid) into v_def
    from pg_constraint
   where conname = 'notificaciones_tipo_check'
     and conrelid = 'public.notificaciones'::regclass;

  if v_def is null then
    raise exception 'ferreteria: no existe notificaciones_tipo_check; no se amplía a ciegas';
  end if;

  if position('''ferreteria_pago''' in v_def) > 0 then
    raise notice 'ferreteria: notificaciones_tipo_check ya admite ferreteria_pago';
    return;
  end if;

  -- Forma de Postgres: CHECK ((tipo = ANY (ARRAY['a'::text, 'b'::text])))
  v_nueva := regexp_replace(v_def, '\]\)\)\)$', ', ''ferreteria_pago''::text])))');
  if v_nueva = v_def or position('''ferreteria_pago''' in v_nueva) = 0 then
    raise exception 'ferreteria: forma inesperada de notificaciones_tipo_check: %', v_def;
  end if;

  alter table public.notificaciones drop constraint notificaciones_tipo_check;
  execute format('alter table public.notificaciones add constraint notificaciones_tipo_check %s', v_nueva);
end $$;
