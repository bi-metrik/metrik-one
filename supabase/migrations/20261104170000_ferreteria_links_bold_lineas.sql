-- ============================================================================
-- Ferretería: el link de Bold del asistente de ventas lleva un CARRITO (varios productos, un solo pago y un solo flete).
--
-- Pedido de Mauricio (4-nov): «debemos funcionar como un carrito de compras: a medida que el cliente va agregando
-- elementos se va haciendo un carrito y después es una sola liquidación». Hasta hoy cada link era de UN producto y la
-- venta cruzada aceptada terminaba en dos links (y dos fletes).
--
-- Qué escribe (solo esquema, sin datos):
--   1. `ferreteria_links_bold_lineas`: una fila por producto del link (publicación, cantidad, precio unitario) y la venta
--      que el webhook registra para esa línea. Al pagar, ONE registra UNA venta por línea, cada una con su negocio (la
--      Ferretería de siempre: entrega y cierre por venta). La venta se anota en su línea APENAS se inserta, como en el
--      link: un reintento de Bold tras un corte no crea otra.
--   2. Nada cambia en `ferreteria_links_bold`: sus columnas de producto (publicacion_id, cantidad, precio_unitario) siguen
--      llenas con la PRIMERA línea y `venta_id` con la venta de esa línea; `monto` es la suma de las líneas + el flete.
--      Un link sin líneas (los de antes de esta migración) es de un solo producto, el de sus columnas.
--
-- server-only: la escriben y la leen el asistente (chatwoot-agente) y el webhook de Bold con service_role, como el link.
-- ============================================================================

create table public.ferreteria_links_bold_lineas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  link_id uuid not null references public.ferreteria_links_bold(id) on delete cascade,
  -- El orden del carrito (la primera es la que va en las columnas del link).
  orden integer not null check (orden between 1 and 10),
  publicacion_id uuid not null references public.ferreteria_publicaciones(id),
  cantidad integer not null check (cantidad between 1 and 3),
  precio_unitario numeric(14, 2) not null check (precio_unitario > 0),
  venta_id uuid references public.ferreteria_ventas(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint ferreteria_links_bold_lineas_orden_unico unique (link_id, orden),
  constraint ferreteria_links_bold_lineas_publicacion_unica unique (link_id, publicacion_id)
);

create unique index ferreteria_links_bold_lineas_venta_unica
  on public.ferreteria_links_bold_lineas (venta_id) where venta_id is not null;

alter table public.ferreteria_links_bold_lineas enable row level security;
revoke all on table public.ferreteria_links_bold_lineas from public, anon, authenticated;

comment on table public.ferreteria_links_bold_lineas is
  'Los productos del carrito de un link de Bold del asistente de ventas, con la venta que registró cada uno. Server-only: chatwoot-agente y /api/webhooks/bold/funciones/[workspace] con service_role.';
