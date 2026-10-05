-- La memoria corta de la conversación de la bandeja de WhatsApp: el viaje en foco de cada remitente.
--
-- Diseño: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-05-conversacion-con-memoria.md, punto 1.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué
-- ─────────────────────────────────────────────────────────────────────────────
--
-- En la prueba de Mauricio (2026-10-05, 12:15–12:21) el bot preguntaba «¿De qué viaje?» dos veces en una
-- conversación en la que el único viaje era el que acababa de cargar. El bot no recordaba qué viaje cargó, mostró o
-- nombró con cada remitente. Esta tabla guarda eso: los últimos viajes en foco (con cuándo y por qué) y la consulta
-- que quedó esperando que el comercial dijera de qué viaje era. Una fila por remitente y workspace.
--
-- No guarda texto del cliente: ids de negocio, horas y el alcance de una pregunta («completo», «mínimo»).
--
-- epoca: no-rompe tabla nueva; no borra, renombra ni cambia nada que use el código de hoy.

create table public.wa_bandeja_conversacion (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  remitente_phone text not null,
  -- Los viajes en foco, del más reciente al más viejo: [{ "negocio_id", "at", "por", "faltan" }]. Pocos (el código
  -- guarda los últimos 5); vencen por la ventana del workspace (`minutos_foco`).
  focos jsonb not null default '[]'::jsonb,
  -- La consulta que espera saber de qué viaje es («¿qué falta para completo?» sin viaje en foco): { "alcance", "at" }.
  consulta_pendiente jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, remitente_phone)
);

comment on table public.wa_bandeja_conversacion is
  'Memoria corta de la bandeja de WhatsApp por remitente: los ultimos viajes en foco (cargados, mostrados o nombrados) y la consulta que espera saber de que viaje es. La escribe y la lee solo el bot (service_role).';

alter table public.wa_bandeja_conversacion enable row level security;

-- server-only: la escribe y la lee solo el bot de la bandeja (edge functions con service_role); la app no la usa.
revoke all on public.wa_bandeja_conversacion from anon, authenticated;
grant all on public.wa_bandeja_conversacion to service_role;
