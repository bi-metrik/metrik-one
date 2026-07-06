-- Voz de Venezuela (estudio de escucha, motor Gemini) — estado de conversacion por telefono.
-- El participante NO es usuario de ONE. Consumida SOLO server-side por el webhook (service_role).
-- Aislada del motor Haiku de Cardumen (cardumen_chat_sessions). Por convencion ONE:
-- RLS habilitado, sin grant a anon/authenticated, sin policy (service_role bypasea RLS).

create table if not exists public.ve_chat_sessions (
  phone       text primary key,
  state       jsonb not null default '{"history":[],"crisis":null,"turns":0}'::jsonb,
  closed      boolean not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.ve_chat_sessions enable row level security;

-- Indice para el lookup de sesiones abiertas (hot path del webhook).
create index if not exists idx_ve_chat_open
  on public.ve_chat_sessions (phone)
  where closed = false;

comment on table public.ve_chat_sessions is
  'Estado de conversacion Voz de Venezuela por telefono. Server-only (service_role). state jsonb = {history[],crisis,turns}. El participante no es usuario de ONE.';
