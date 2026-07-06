-- Voz de Venezuela — registro estructurado por conversacion (salida del serializador al cierre).
-- Server-only (service_role): RLS habilitado, sin grant, sin policy (service_role bypasea RLS).
-- Si la conversacion fue de crisis, se marca `crisis` y NO se extraen campos de difusion
-- (testimonio derivado de una emergencia con poblacion vulnerable: no difundible).

create table if not exists public.ve_respuestas (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  atribucion   text,                       -- 'anonima' | 'con_nombre'
  nombre       text,                        -- solo si atribucion = 'con_nombre'
  ubicacion    text,
  necesidades  jsonb not null default '[]'::jsonb,
  quien_ayudo  text,
  historia     text,                        -- la voz "para el mundo"
  resumen      text,
  idioma       text,
  crisis       text,                        -- tipo de crisis si la hubo (registro NO difundible)
  turnos       int,
  payload      jsonb not null default '{}'::jsonb,  -- record completo + raw_history de respaldo
  created_at   timestamptz not null default now()
);

alter table public.ve_respuestas enable row level security;

create index if not exists idx_ve_respuestas_phone on public.ve_respuestas (phone);
create index if not exists idx_ve_respuestas_created on public.ve_respuestas (created_at desc);

comment on table public.ve_respuestas is
  'Registro estructurado de cada conversacion Voz de Venezuela (serializador al cierre). Server-only. Los registros con `crisis` no son difundibles.';
