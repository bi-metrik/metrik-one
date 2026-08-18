-- Bitacora de lo que FunnelChat manda hacia ONE.
--
-- Por que existe: el 2026-08-14, al intentar la integracion, FunnelChat respondio
-- que "actualmente no es posible enviar datos salientes por medio del webhook desde
-- las automatizaciones de los flujos" (nota fechada 2026-05-04, prometiendo
-- activarlo). Su documentacion SI describe un paso de peticion HTTP dentro de los
-- flujos (GET/POST/PUT/PATCH/DELETE, cabecera y cuerpo JSON). Las dos cosas no
-- pueden ser ciertas a la vez, y quien lo resuelve no es el soporte sino un envio
-- real: esta tabla es el otro extremo de esa prueba.
--
-- ⚠️ La fila se escribe ANTES de validar el token, a proposito. Rechazar con 401
-- sin dejar rastro vuelve indistinguibles "no llego nada" y "llego y lo rechace",
-- que es justo el fallo mudo que este frente viene arrastrando (el mismo hueco
-- esta abierto en meta-leads-webhook con la firma HMAC). El veredicto queda en
-- `autenticado` y el motivo en texto; nada mas cuelga de estas filas todavia.

create table if not exists public.funnelchat_eventos (
  id uuid primary key default gen_random_uuid(),
  -- Se resuelve por el token; queda null cuando el token no identifica a nadie.
  workspace_id uuid references public.workspaces(id) on delete set null,
  recibido_en timestamptz not null default now(),
  metodo text not null,
  content_type text,
  -- Cabeceras SIN el token (se redacta en el endpoint: la credencial no se guarda).
  headers jsonb not null default '{}'::jsonb,
  -- Cuerpo tal como llego. Si no era JSON valido queda como {"_raw": "..."}.
  payload jsonb not null default '{}'::jsonb,
  bytes integer,
  autenticado boolean not null default false,
  motivo text
);

create index if not exists idx_funnelchat_eventos_recibido
  on public.funnelchat_eventos (recibido_en desc);
create index if not exists idx_funnelchat_eventos_workspace
  on public.funnelchat_eventos (workspace_id, recibido_en desc);

alter table public.funnelchat_eventos enable row level security;

-- server-only: la escribe el endpoint /api/webhooks/funnelchat con service_role y
-- se lee desde el servidor. Ningun cliente autenticado la consulta hoy, asi que no
-- lleva grant ni policy: si mañana una pantalla la necesita, se agrega policy por
-- workspace + grant a authenticated en su propia migracion.

comment on table public.funnelchat_eventos is
  'Bitacora cruda de las peticiones que FunnelChat envia a ONE. Se escribe antes de validar el token; `autenticado` guarda el veredicto.';
