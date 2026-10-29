-- ============================================================================
-- Ferretería: el asistente de ventas de Dimpro cobra con links de Bold (ensayo con conocidos, 29-oct).
--
-- El asistente público (Chatwoot) arma la compra con el catálogo de Ferretería, el cliente la confirma y el código
-- crea un link de Bold con las llaves del workspace (bóveda, #1294). El webhook de Bold del workspace
-- (`/api/webhooks/bold/funciones/[workspace]`) reconoce el `LNK_…` en esta tabla y registra la venta de Ferretería
-- con su negocio en ONE (la misma `registrarVenta` de la pantalla y de Wompi), una sola vez por link.
--
-- Solo ESQUEMA. No escribe ni corrige ninguna fila existente:
--   1. `ferreteria_links_bold`, server-only: la escriben el asistente (Edge Function) y el webhook (Next), los dos con
--      service_role. Guarda nombre, celular y dirección del comprador: el navegador no la lee directo.
--   2. `ferreteria_ventas.cantidad` (default 1): una compra del asistente puede ser de 1 a 3 unidades. Las ventas de
--      siempre quedan en 1, que es lo que eran.
--   3. `ferreteria_conversaciones.canal` admite 'instagram' (la bandeja de Instagram de empresa de Dimpro).
-- ============================================================================

-- ── 1. Links de Bold del asistente ───────────────────────────────────────────

-- server-only: la escriben y la leen el asistente (chatwoot-agente) y el webhook de Bold con service_role, acotando
-- por workspace. Trae datos del comprador (nombre, celular, dirección).
create table public.ferreteria_links_bold (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  -- El `LNK_…` que asignó Bold: es lo que el webhook trae en `data.metadata.reference`.
  referencia text not null check (referencia ~ '^LNK_[A-Za-z0-9]+$'),
  url text not null check (url ~ '^https://'),
  -- La huella de la propuesta confirmada: un «sí» repetido no crea un segundo link.
  huella text not null check (length(btrim(huella)) > 0),
  publicacion_id uuid not null references public.ferreteria_publicaciones(id),
  cantidad integer not null check (cantidad between 1 and 3),
  precio_unitario numeric(14, 2) not null check (precio_unitario > 0),
  flete numeric(14, 2) not null default 0 check (flete >= 0),
  -- precio_unitario × cantidad + flete. Es lo que cobra el link.
  monto numeric(14, 2) not null check (monto > 0),
  -- La zona de la tabla de flete del reglamento ('bogota', 'recoge'…) y la ruta de la venta.
  zona text not null,
  ruta text not null check (ruta in ('recoge', 'despacho')),
  comprador_nombre text not null,
  comprador_telefono text not null,
  direccion text,
  -- La conversación de Chatwoot de donde salió (para confirmarle al cliente y pasar a persona con `despachar`).
  chatwoot_cuenta_id integer not null,
  chatwoot_conversacion_id integer not null,
  canal text not null,
  vence_at timestamptz,
  -- Qué hizo ONE con el pago:
  --   creado: el link existe, sin pago aprobado
  --   procesando: el webhook lo tomó (una fila que se queda aquí es un corte a mitad; se reintenta)
  --   registrada: la venta y su negocio existen (venta_id)
  --   rechazado: Bold avisó un pago rechazado (el link sigue abierto en Bold)
  --   error: se intentó registrar y no se pudo (motivo)
  registro text not null default 'creado'
    check (registro in ('creado', 'procesando', 'registrada', 'rechazado', 'error')),
  motivo text,
  monto_recibido numeric(14, 2),
  venta_id uuid references public.ferreteria_ventas(id),
  veces_recibido integer not null default 0 check (veces_recibido >= 0),
  created_at timestamptz not null default now(),
  procesado_at timestamptz,
  constraint ferreteria_links_bold_referencia_unica unique (workspace_id, referencia),
  constraint ferreteria_links_bold_huella_unica unique (workspace_id, huella),
  constraint ferreteria_links_bold_registrada_con_venta check (registro <> 'registrada' or venta_id is not null)
);

-- Un link, a lo sumo una venta.
create unique index ferreteria_links_bold_venta_unica
  on public.ferreteria_links_bold (venta_id) where venta_id is not null;

create index idx_ferreteria_links_bold_conversacion
  on public.ferreteria_links_bold (workspace_id, chatwoot_cuenta_id, chatwoot_conversacion_id);

alter table public.ferreteria_links_bold enable row level security;
revoke all on table public.ferreteria_links_bold from public, anon, authenticated;

comment on table public.ferreteria_links_bold is
  'Links de Bold que crea el asistente de ventas (Chatwoot) para una compra de Ferretería. Server-only: chatwoot-agente y /api/webhooks/bold/funciones/[workspace] con service_role.';

-- ── 2. Cantidad de la venta ──────────────────────────────────────────────────

alter table public.ferreteria_ventas
  add column cantidad integer not null default 1 check (cantidad between 1 and 50);

comment on column public.ferreteria_ventas.cantidad is
  'Unidades de la publicación en esta venta. precio_final es el de todas; costo_dia es el costo F de UNA unidad.';

-- ── 3. Instagram como canal de una conversación ──────────────────────────────

alter table public.ferreteria_conversaciones drop constraint if exists ferreteria_conversaciones_canal_check;
alter table public.ferreteria_conversaciones
  add constraint ferreteria_conversaciones_canal_check check (canal in ('messenger', 'whatsapp', 'instagram'));
