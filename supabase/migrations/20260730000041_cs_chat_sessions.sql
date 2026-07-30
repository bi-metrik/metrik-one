-- ============================================================
-- cs_chat_sessions — estado del bot de customer service por WhatsApp
-- ------------------------------------------------------------
-- Genérico y opt-in: la conversación se activa SOLO si algún workspace
-- declara `config_extra.wa_customer_bot`. Sin esa config, ningún número
-- entra a este flujo y el webhook se comporta exactamente como hoy.
--
-- Quien escribe NO es usuario de ONE: es un cliente final del cliente.
-- Por eso el estado no puede colgar de `staff` ni de `profiles`, igual
-- que en ve_chat_sessions y cardumen_chat_sessions.
--
-- La sesión se guarda por teléfono, no por (teléfono, workspace): un
-- número escribe a UN bot a la vez. `workspace_id` queda en la fila para
-- saber a qué cliente pertenece el lead al cerrar.
--
-- Acceso: SOLO service_role (la edge function). RLS habilitado y SIN
-- grants a anon/authenticated, según la convención de CLAUDE.md para
-- tablas server-only.
-- ============================================================

create table if not exists public.cs_chat_sessions (
  phone        text primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  state        jsonb not null default '{}'::jsonb,
  closed       boolean not null default false,
  -- Trazabilidad del desenlace: qué se hizo con la conversación al cerrar.
  -- null mientras sigue abierta.
  desenlace    text,
  contacto_id  uuid references public.contactos(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint cs_chat_sessions_desenlace_check
    check (desenlace is null or desenlace in ('lead_capturado', 'abandonada', 'expirada', 'salida_explicita'))
);

-- Barrido de sesiones abiertas viejas y lectura por workspace.
create index if not exists idx_cs_chat_sessions_abiertas
  on public.cs_chat_sessions (updated_at) where closed = false;

create index if not exists idx_cs_chat_sessions_workspace
  on public.cs_chat_sessions (workspace_id, created_at desc);

alter table public.cs_chat_sessions enable row level security;

-- Sin policies y sin grants a propósito: la consume únicamente la edge
-- function con service_role, que bypasea RLS. Dejarla sin grant a
-- anon/authenticated es lo más seguro — la anon key viaja en el bundle
-- del browser y aquí hay teléfonos y nombres de personas.
revoke all on public.cs_chat_sessions from anon, authenticated;

comment on table public.cs_chat_sessions is
  'Estado del bot de customer service por WhatsApp. Server-only (service_role). Opt-in por workspaces.config_extra.wa_customer_bot.';
comment on column public.cs_chat_sessions.desenlace is
  'Qué pasó al cerrar: lead_capturado | abandonada | expirada | salida_explicita. Null mientras está abierta.';
