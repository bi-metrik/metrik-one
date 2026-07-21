-- ============================================================
-- contacto_interacciones — bitácora genérica de interacciones por contacto
-- ------------------------------------------------------------
-- Cambio de paradigma: un lead de Meta (o WhatsApp/web/manual) ya NO crea un
-- negocio automáticamente. Crea (o reusa) un CONTACTO y registra una
-- INTERACCIÓN aquí. El humano decide luego cuáles convierten a negocio.
--
-- Grano: una fila por interacción entrante (lead de Meta, mensaje de WhatsApp,
-- formulario web, registro manual). El payload guarda el crudo declarado
-- (field_data de Meta + metadata de campaña) para no perder contexto.
--
-- Multi-tenant: RLS por workspace (patrón current_user_workspace_id()).
-- La consume el cliente authenticated (UI Contacto 360 + server actions del
-- flujo de conversión), por eso: RLS on + policy por workspace + grant a
-- authenticated. El webhook la escribe con service_role (bypasea RLS).
-- ============================================================

create table if not exists public.contacto_interacciones (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contacto_id  uuid not null references public.contactos(id) on delete cascade,
  -- Canal de origen de la interacción.
  fuente       text not null check (fuente in ('meta', 'whatsapp', 'web', 'manual')),
  -- Referencia externa para idempotencia (ej. leadgen_id de Meta). Nullable:
  -- una interacción manual no siempre tiene ref externa.
  fuente_ref   text,
  -- Crudo de la interacción: field_data del lead + metadata de campaña.
  payload      jsonb not null default '{}',
  -- Ciclo de vida de la interacción (bandeja de leads):
  --   nueva              → recién entró, sin gestionar
  --   contactada         → el comercial ya la trabajó
  --   descartada         → no aplica / spam / duplicado descartado
  --   convertida         → se creó un negocio a partir de ella (negocio_id set)
  --   posible_duplicado  → el dedup detectó conflicto (mismo teléfono, distinto email)
  estado       text not null default 'nueva'
                 check (estado in ('nueva', 'contactada', 'descartada', 'convertida', 'posible_duplicado')),
  -- Negocio creado al convertir (SET NULL si el negocio se borra, no perdemos el registro).
  negocio_id   uuid references public.negocios(id) on delete set null,
  -- Cuándo ocurrió la interacción en el origen (created_time de Meta), no cuándo la ingerimos.
  ocurrida_at  timestamptz,
  created_at   timestamptz default now()
);

alter table public.contacto_interacciones enable row level security;

-- Aislamiento por workspace (patrón canónico). Lectura + escritura del cliente
-- authenticated (la UI marca contactada/descartada y convierte). El webhook usa
-- service_role, que bypasea RLS.
drop policy if exists contacto_interacciones_rw on public.contacto_interacciones;
create policy contacto_interacciones_rw on public.contacto_interacciones
  for all to authenticated
  using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

grant select, insert, update, delete on public.contacto_interacciones to authenticated;

-- Idempotencia: una fuente_ref (ej. leadgen_id) no se ingiere dos veces por
-- workspace+fuente. Parcial (solo cuando fuente_ref no es null) para no bloquear
-- interacciones manuales sin ref.
create unique index if not exists uq_contacto_interacciones_fuente_ref
  on public.contacto_interacciones (workspace_id, fuente, fuente_ref)
  where fuente_ref is not null;

-- Interacciones de un contacto (timeline del Contacto 360).
create index if not exists idx_contacto_interacciones_ws_contacto
  on public.contacto_interacciones (workspace_id, contacto_id);

-- Bandeja de leads por estado (interacciones sin convertir / posibles duplicados).
create index if not exists idx_contacto_interacciones_ws_estado
  on public.contacto_interacciones (workspace_id, estado);

-- ============================================================
-- ROLLBACK (correr manualmente si hay que revertir):
--
-- drop index if exists public.idx_contacto_interacciones_ws_estado;
-- drop index if exists public.idx_contacto_interacciones_ws_contacto;
-- drop index if exists public.uq_contacto_interacciones_fuente_ref;
-- drop policy if exists contacto_interacciones_rw on public.contacto_interacciones;
-- drop table if exists public.contacto_interacciones;
-- ============================================================
