-- CardumenChat — estado de conversacion por telefono (participante NO es usuario de ONE).
-- Consumida SOLO server-side por el webhook (service_role). Por convencion ONE:
-- RLS habilitado, sin grant a anon/authenticated, sin policy (service_role bypasea RLS).

create table if not exists public.cardumen_chat_sessions (
  phone       text primary key,
  state       jsonb not null default '{}'::jsonb,
  closed      boolean not null default false,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

alter table public.cardumen_chat_sessions enable row level security;

-- Indice para el lookup de sesiones abiertas (hot path del webhook).
create index if not exists idx_cardumen_chat_open
  on public.cardumen_chat_sessions (phone)
  where closed = false;

comment on table public.cardumen_chat_sessions is
  'Estado de conversacion CardumenChat por telefono. Server-only (service_role). El participante no es usuario de ONE.';
