-- ============================================================================
-- Carrito persistente de los asistentes de venta (spec docs/specs/2026-11-04_carrito-asistentes-venta.md).
--
-- Pedido de Mauricio (4-nov): un carrito ESTÁNDAR para todo asistente público que venda (hoy Dimi de Dimpro), guardado
-- en base de datos, que termine registrando la venta en ONE. Hasta hoy cada link de Bold era de UN producto
-- (`ferreteria_links_bold`) y la venta cruzada aceptada terminaba en dos links con dos fletes.
--
-- Qué hace (solo esquema; no escribe ni corrige filas existentes):
--   1. `carritos`: uno por conversación del asistente (cuenta + conversación de Chatwoot), por workspace. A lo sumo uno
--      vivo (`abierto` o `en_pago`) por conversación. Estados: abierto → en_pago → pagado → registrado, y vencido,
--      abandonado, cancelado. Un solo flete; total = subtotal + flete.
--   2. `carrito_lineas`: los productos, con la FOTO del precio. Con el carrito fuera de `abierto` no se tocan (trigger),
--      salvo anotar la venta de ONE de cada línea.
--   3. `carrito_pagos`: cada link de pago emitido (intento de cobro). La referencia `LNK_…` y la huella de la propuesta
--      son únicas: un «sí» repetido no crea otro link y un aviso repetido de Bold no registra dos veces. Un carrito, a lo
--      sumo un pago aprobado.
--   4. Dos funciones, solo service_role, para que el asistente cambie el carrito sin carreras:
--      `carrito_guardar_lineas` (reemplaza las líneas, sube la versión, reabre un carrito en pago anulando su link) y
--      `carrito_emitir_pago` (congela el carrito con su entrega y registra el link, si la versión no cambió).
--   5. `ferreteria_ventas`: un carrito pagado es UN negocio con una venta por línea. Se quita el índice único
--      `ferreteria_ventas_negocio_unico` (una venta por negocio) y se agrega `carrito_linea_id` (única): la línea del
--      carrito de la que salió la venta, que hace idempotente el reintento.
--   6. Retira `ferreteria_links_bold` (reemplazada por las tablas de arriba) SOLO si está vacía; si tiene filas, aborta.
--      Al 4-nov tenía 0 filas en producción.
--
-- server-only: las tres tablas las escriben y leen `chatwoot-agente` (Edge) y el webhook de Bold (Next) con
-- service_role, acotando por workspace. Guardan nombre, celular y dirección del comprador: el navegador no las lee.
-- ============================================================================

-- ── 1. carritos ──────────────────────────────────────────────────────────────

-- server-only: chatwoot-agente y /api/webhooks/bold/funciones/[workspace] con service_role; datos del comprador.
create table public.carritos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  -- Quién lo vuelve venta en ONE (el convertidor del servidor).
  dominio text not null check (dominio in ('ferreteria')),
  chatwoot_cuenta_id bigint not null,
  chatwoot_conversacion_id bigint not null,
  chatwoot_contacto_id bigint,
  canal text not null check (length(btrim(canal)) > 0),
  estado text not null default 'abierto'
    check (estado in ('abierto', 'en_pago', 'pagado', 'registrado', 'vencido', 'abandonado', 'cancelado')),
  -- Sube con cada cambio de líneas: la propuesta la lleva y el link solo se emite si no cambió.
  version integer not null default 0 check (version >= 0),
  subtotal numeric(14, 2) not null default 0 check (subtotal >= 0),
  flete numeric(14, 2) check (flete is null or flete >= 0),
  total numeric(14, 2) check (total is null or total > 0),
  moneda text not null default 'COP' check (moneda = 'COP'),
  zona text,
  ruta text check (ruta is null or ruta in ('despacho', 'recoge')),
  comprador_nombre text,
  comprador_telefono text,
  direccion text,
  -- El negocio de ONE, anotado apenas existe (el reintento no crea otro).
  negocio_id uuid references public.negocios(id) on delete set null,
  congelado_at timestamptz,
  pagado_at timestamptz,
  registrado_at timestamptz,
  cerrado_at timestamptz,
  -- Último cambio de líneas: de aquí sale el abandono.
  actividad_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint carritos_total_cuadra check (total is null or flete is null or total = subtotal + flete),
  -- Desde que se emite el link hasta que se registra, el carrito tiene entrega y total.
  constraint carritos_congelado_completo check (
    estado not in ('en_pago', 'pagado', 'registrado')
    or (total is not null and flete is not null and zona is not null and ruta is not null
        and comprador_nombre is not null and comprador_telefono is not null and congelado_at is not null)
  ),
  constraint carritos_registrado_con_negocio check (estado <> 'registrado' or negocio_id is not null)
);

create unique index carritos_uno_vivo_por_conversacion
  on public.carritos (workspace_id, chatwoot_cuenta_id, chatwoot_conversacion_id)
  where estado in ('abierto', 'en_pago');
create index idx_carritos_estado on public.carritos (workspace_id, estado, actividad_at);
create index idx_carritos_conversacion on public.carritos (workspace_id, chatwoot_cuenta_id, chatwoot_conversacion_id, created_at desc);

alter table public.carritos enable row level security;
revoke all on table public.carritos from public, anon, authenticated;

comment on table public.carritos is
  'Carrito de un asistente de venta, uno vivo por conversación de Chatwoot. Server-only: chatwoot-agente y el webhook de Bold con service_role. Spec: docs/specs/2026-11-04_carrito-asistentes-venta.md';

-- ── 2. carrito_lineas ────────────────────────────────────────────────────────

-- server-only: como `carritos`.
create table public.carrito_lineas (
  id uuid primary key default gen_random_uuid(),
  carrito_id uuid not null references public.carritos(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  orden smallint not null check (orden between 1 and 20),
  -- Qué es: hoy una publicación de Ferretería. Sin FK: el dominio lo valida (la tabla es de todos los asistentes).
  item_tipo text not null check (item_tipo in ('ferreteria_publicacion')),
  item_id uuid not null,
  -- Foto de lo que vio el cliente.
  codigo text not null check (length(btrim(codigo)) > 0),
  descripcion text not null default '',
  cantidad integer not null check (cantidad between 1 and 50),
  precio_unitario numeric(14, 2) not null check (precio_unitario > 0),
  subtotal numeric(14, 2) generated always as (precio_unitario * cantidad) stored,
  -- La venta de ONE de esta línea, anotada apenas se inserta.
  venta_id uuid,
  created_at timestamptz not null default now(),
  constraint carrito_lineas_orden_unico unique (carrito_id, orden),
  constraint carrito_lineas_item_unico unique (carrito_id, item_tipo, item_id)
);

create unique index carrito_lineas_venta_unica on public.carrito_lineas (venta_id) where venta_id is not null;

alter table public.carrito_lineas enable row level security;
revoke all on table public.carrito_lineas from public, anon, authenticated;

comment on table public.carrito_lineas is
  'Productos de un carrito con la foto del precio y la venta de ONE que salió de cada uno. Server-only, como carritos.';

-- La línea es del workspace de su carrito, y con el carrito fuera de `abierto` solo se anota su venta.
create or replace function public.carrito_lineas_guarda() returns trigger
language plpgsql
set search_path = public
as $fn$
declare
  v_carrito public.carritos%rowtype;
begin
  select * into v_carrito from public.carritos where id = coalesce(new.carrito_id, old.carrito_id);
  if tg_op = 'DELETE' then
    -- Borrar el carrito entero (cascade) sí se puede; borrar una línea suelta, solo con el carrito abierto.
    if found and v_carrito.estado <> 'abierto' then
      raise exception 'carrito_lineas: el carrito % está %, sus líneas no se borran', v_carrito.id, v_carrito.estado
        using errcode = 'P0001';
    end if;
    return old;
  end if;
  if not found then
    raise exception 'carrito_lineas: el carrito % no existe', new.carrito_id using errcode = 'P0001';
  end if;
  if new.workspace_id <> v_carrito.workspace_id then
    raise exception 'carrito_lineas: la línea no es del workspace del carrito' using errcode = 'P0001';
  end if;
  if v_carrito.estado <> 'abierto' then
    -- `subtotal` es generada: en un BEFORE la fila nueva aún no la trae.
    if tg_op = 'INSERT' or (to_jsonb(new) - 'venta_id' - 'subtotal') is distinct from (to_jsonb(old) - 'venta_id' - 'subtotal') then
      raise exception 'carrito_lineas: el carrito % está %, sus líneas no cambian', v_carrito.id, v_carrito.estado
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$fn$;
revoke execute on function public.carrito_lineas_guarda() from public, anon, authenticated;

create trigger trg_carrito_lineas_guarda
  before insert or update or delete on public.carrito_lineas
  for each row execute function public.carrito_lineas_guarda();

-- ── 3. carrito_pagos ─────────────────────────────────────────────────────────

-- server-only: como `carritos`.
create table public.carrito_pagos (
  id uuid primary key default gen_random_uuid(),
  carrito_id uuid not null references public.carritos(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id),
  pasarela text not null default 'bold' check (pasarela in ('bold')),
  -- El `LNK_…` de Bold: lo que el webhook trae en `data.metadata.reference`.
  referencia text not null check (referencia ~ '^LNK_[A-Za-z0-9]+$'),
  url text not null check (url ~ '^https://'),
  -- La huella de la propuesta confirmada: un «sí» repetido no crea un segundo link.
  huella text not null check (length(btrim(huella)) > 0),
  -- La versión del carrito que se congeló en este link.
  version integer not null,
  monto numeric(14, 2) not null check (monto > 0),
  vence_at timestamptz not null,
  --   creado: el link existe, sin pago aprobado
  --   procesando: el webhook lo tomó (una fila que se queda aquí es un corte a mitad; se reintenta pasados 2 minutos)
  --   aprobado: la plata entró y la venta quedó registrada en ONE
  --   rechazado: Bold avisó un pago rechazado (el link sigue abierto en Bold)
  --   vencido: el link venció o lo reemplazó otro (motivo)
  --   error: se intentó registrar y no se pudo (motivo)
  estado text not null default 'creado'
    check (estado in ('creado', 'procesando', 'aprobado', 'rechazado', 'vencido', 'error')),
  motivo text,
  monto_recibido numeric(14, 2),
  reclamado_at timestamptz,
  veces_recibido integer not null default 0 check (veces_recibido >= 0),
  created_at timestamptz not null default now(),
  procesado_at timestamptz,
  constraint carrito_pagos_referencia_unica unique (workspace_id, referencia),
  constraint carrito_pagos_huella_unica unique (workspace_id, huella)
);

create unique index carrito_pagos_un_aprobado on public.carrito_pagos (carrito_id) where estado = 'aprobado';
create index idx_carrito_pagos_carrito on public.carrito_pagos (carrito_id, created_at desc);

alter table public.carrito_pagos enable row level security;
revoke all on table public.carrito_pagos from public, anon, authenticated;

comment on table public.carrito_pagos is
  'Links de pago emitidos para un carrito (intentos de cobro). Idempotencia por referencia LNK_ y por huella. Server-only, como carritos.';

-- ── 4. Funciones del asistente ───────────────────────────────────────────────

-- Reemplaza las líneas del carrito vivo de la conversación (lo crea si no hay). Atómica, con el carrito bloqueado.
--   · Un carrito abierto sin cambios desde hace más de `p_abandono` se marca `abandonado` y se empieza otro.
--   · Un carrito en pago se reabre: sus links `creado` pasan a `vencido` (motivo reemplazado). Si tiene un pago en curso
--     o aprobado, no se toca: error `carrito_pagado`.
--   · Las mismas líneas (código, cantidad y precio) no suben la versión.
--   · Sin líneas: el carrito se cancela.
-- `p_lineas`: [{item_tipo, item_id, codigo, descripcion, cantidad, precio_unitario}], en orden.
create or replace function public.carrito_guardar_lineas(
  p_workspace uuid,
  p_dominio text,
  p_cuenta bigint,
  p_conversacion bigint,
  p_canal text,
  p_contacto bigint,
  p_lineas jsonb,
  p_abandono interval default interval '7 days'
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_carrito public.carritos%rowtype;
  v_ahora timestamptz := now();
  v_nuevas jsonb;
  v_actuales jsonb;
  v_subtotal numeric(14, 2);
begin
  if jsonb_typeof(p_lineas) is distinct from 'array' then
    raise exception 'carrito_guardar_lineas: p_lineas tiene que ser un arreglo' using errcode = '22023';
  end if;

  select * into v_carrito from public.carritos
   where workspace_id = p_workspace and chatwoot_cuenta_id = p_cuenta and chatwoot_conversacion_id = p_conversacion
     and estado in ('abierto', 'en_pago')
   for update;

  if found and v_carrito.estado = 'abierto' and v_carrito.actividad_at < v_ahora - p_abandono then
    update public.carritos set estado = 'abandonado', cerrado_at = v_ahora, updated_at = v_ahora where id = v_carrito.id;
    v_carrito := null;
  end if;

  v_nuevas := coalesce((
    select jsonb_agg(jsonb_build_object(
             'item_tipo', x->>'item_tipo', 'item_id', x->>'item_id', 'codigo', x->>'codigo',
             'cantidad', (x->>'cantidad')::int, 'precio_unitario', round((x->>'precio_unitario')::numeric, 2))
           order by o)
      from jsonb_array_elements(p_lineas) with ordinality as t(x, o)), '[]'::jsonb);

  if v_carrito.id is null then
    if jsonb_array_length(v_nuevas) = 0 then
      return null;
    end if;
    insert into public.carritos (workspace_id, dominio, chatwoot_cuenta_id, chatwoot_conversacion_id, chatwoot_contacto_id, canal)
    values (p_workspace, p_dominio, p_cuenta, p_conversacion, p_contacto, p_canal)
    returning * into v_carrito;
  else
    if v_carrito.dominio <> p_dominio then
      raise exception 'carrito_guardar_lineas: el carrito vivo es del dominio %', v_carrito.dominio using errcode = 'P0001';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object(
             'item_tipo', item_tipo, 'item_id', item_id::text, 'codigo', codigo,
             'cantidad', cantidad, 'precio_unitario', precio_unitario) order by orden), '[]'::jsonb)
      into v_actuales
      from public.carrito_lineas where carrito_id = v_carrito.id;
    if v_actuales = v_nuevas and v_carrito.estado = 'abierto' then
      return v_carrito.id;
    end if;
    if v_carrito.estado = 'en_pago' then
      if exists (select 1 from public.carrito_pagos where carrito_id = v_carrito.id and estado in ('procesando', 'aprobado')) then
        raise exception 'carrito_pagado' using errcode = 'P0001', hint = 'El carrito ya tiene un pago en curso o aprobado.';
      end if;
      if v_actuales = v_nuevas then
        return v_carrito.id;
      end if;
      update public.carrito_pagos
         set estado = 'vencido', motivo = 'reemplazado: el cliente cambió el carrito', procesado_at = v_ahora
       where carrito_id = v_carrito.id and estado in ('creado', 'rechazado', 'error');
      update public.carritos set estado = 'abierto', congelado_at = null, updated_at = v_ahora where id = v_carrito.id;
    end if;
  end if;

  delete from public.carrito_lineas where carrito_id = v_carrito.id;

  if jsonb_array_length(v_nuevas) = 0 then
    update public.carritos
       set estado = 'cancelado', subtotal = 0, version = version + 1, actividad_at = v_ahora, cerrado_at = v_ahora, updated_at = v_ahora
     where id = v_carrito.id;
    return v_carrito.id;
  end if;

  insert into public.carrito_lineas (carrito_id, workspace_id, orden, item_tipo, item_id, codigo, descripcion, cantidad, precio_unitario)
  select v_carrito.id, p_workspace, o, x->>'item_tipo', (x->>'item_id')::uuid, x->>'codigo', coalesce(x->>'descripcion', ''),
         (x->>'cantidad')::int, round((x->>'precio_unitario')::numeric, 2)
    from jsonb_array_elements(p_lineas) with ordinality as t(x, o);

  select sum(subtotal) into v_subtotal from public.carrito_lineas where carrito_id = v_carrito.id;
  update public.carritos
     set subtotal = v_subtotal, total = case when flete is null then null else v_subtotal + flete end,
         version = version + 1, actividad_at = v_ahora, updated_at = v_ahora
   where id = v_carrito.id;
  return v_carrito.id;
end;
$fn$;

revoke execute on function public.carrito_guardar_lineas(uuid, text, bigint, bigint, text, bigint, jsonb, interval) from public, anon, authenticated;
grant execute on function public.carrito_guardar_lineas(uuid, text, bigint, bigint, text, bigint, jsonb, interval) to service_role;

-- Congela el carrito con su entrega y registra el link de pago emitido. Solo si la versión es la de la propuesta.
--   · La misma huella otra vez: devuelve el pago que ya existe (idempotente).
--   · Otro link `creado` del mismo carrito pasa a `vencido` (reemplazado por este).
--   · El monto del link tiene que ser subtotal + flete.
-- Errores: `carrito_no_vivo`, `carrito_cambio` (otra versión), `carrito_pagado`, `monto_no_cuadra`.
create or replace function public.carrito_emitir_pago(
  p_workspace uuid,
  p_carrito uuid,
  p_version integer,
  p_zona text,
  p_ruta text,
  p_flete numeric,
  p_nombre text,
  p_telefono text,
  p_direccion text,
  p_referencia text,
  p_url text,
  p_huella text,
  p_monto numeric,
  p_vence_at timestamptz
) returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_carrito public.carritos%rowtype;
  v_pago uuid;
  v_ahora timestamptz := now();
begin
  select id into v_pago from public.carrito_pagos where workspace_id = p_workspace and huella = p_huella;
  if v_pago is not null then
    return v_pago;
  end if;

  select * into v_carrito from public.carritos where id = p_carrito and workspace_id = p_workspace for update;
  if not found or v_carrito.estado not in ('abierto', 'en_pago') then
    raise exception 'carrito_no_vivo' using errcode = 'P0001';
  end if;
  if v_carrito.version <> p_version then
    raise exception 'carrito_cambio' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.carrito_pagos where carrito_id = p_carrito and estado in ('procesando', 'aprobado')) then
    raise exception 'carrito_pagado' using errcode = 'P0001';
  end if;
  if round(p_monto, 2) <> round(v_carrito.subtotal + p_flete, 2) then
    raise exception 'monto_no_cuadra' using errcode = 'P0001',
      detail = format('link %s, carrito %s + flete %s', p_monto, v_carrito.subtotal, p_flete);
  end if;

  update public.carrito_pagos
     set estado = 'vencido', motivo = 'reemplazado por otro link', procesado_at = v_ahora
   where carrito_id = p_carrito and estado in ('creado', 'rechazado', 'error');

  update public.carritos
     set estado = 'en_pago', zona = p_zona, ruta = p_ruta, flete = p_flete, total = subtotal + p_flete,
         comprador_nombre = p_nombre, comprador_telefono = p_telefono, direccion = p_direccion,
         congelado_at = v_ahora, updated_at = v_ahora
   where id = p_carrito;

  insert into public.carrito_pagos (carrito_id, workspace_id, referencia, url, huella, version, monto, vence_at)
  values (p_carrito, p_workspace, p_referencia, p_url, p_huella, p_version, p_monto, p_vence_at)
  returning id into v_pago;
  return v_pago;
end;
$fn$;

revoke execute on function public.carrito_emitir_pago(uuid, uuid, integer, text, text, numeric, text, text, text, text, text, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.carrito_emitir_pago(uuid, uuid, integer, text, text, numeric, text, text, text, text, text, text, numeric, timestamptz) to service_role;

-- ── 5. Ventas de Ferretería: un negocio, varias ventas ───────────────────────

drop index if exists public.ferreteria_ventas_negocio_unico;
create index if not exists idx_ferreteria_ventas_negocio on public.ferreteria_ventas (negocio_id) where negocio_id is not null;

alter table public.ferreteria_ventas
  add column carrito_linea_id uuid references public.carrito_lineas(id) on delete set null;

create unique index ferreteria_ventas_carrito_linea_unica
  on public.ferreteria_ventas (carrito_linea_id) where carrito_linea_id is not null;

comment on column public.ferreteria_ventas.carrito_linea_id is
  'La línea del carrito del asistente de la que salió esta venta (un carrito pagado = un negocio con una venta por línea).';

-- ── 6. Retiro de ferreteria_links_bold ───────────────────────────────────────

-- epoca: no-rompe ferreteria_links_bold es server-only (el navegador nunca la lee) y está vacía; el webhook de hoy lee
-- «tabla inexistente» como «no es de Ferretería». Entre aplicar esto y desplegar chatwoot-agente, Dimi no puede crear
-- links (pasa a persona con pago_no_disponible): aplicar y desplegar seguidos.

do $$
declare
  v_filas bigint;
begin
  if to_regclass('public.ferreteria_links_bold') is null then
    return;
  end if;
  execute 'select count(*) from public.ferreteria_links_bold' into v_filas;
  if v_filas > 0 then
    raise exception 'ferreteria_links_bold tiene % filas: no se retira sin pasarlas a carritos', v_filas;
  end if;
  drop table public.ferreteria_links_bold;
end $$;
