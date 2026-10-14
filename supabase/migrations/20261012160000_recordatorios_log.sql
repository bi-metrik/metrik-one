-- ============================================================================
-- Motor de recordatorios hacia atrás (post-cotización, PR 4).
--
-- Diseño técnico §4 (max-diseno-tecnico-post-cotizacion-2026-10-12) y Vera §7.2.1 y §7.7: un
-- recordatorio se RECLAMA antes de mandarse con un INSERT que choca contra la llave única, así dos
-- corridas del cron a la vez (Vercel puede entregar dos) mandan uno solo. `fecha_objetivo` va en la
-- llave: si la fecha límite o el envío se mueven, el recordatorio se rearma solo.
--
-- Un aviso repetido no se deshace; uno perdido sí se recupera: `fallido` con `intentos < 3` se
-- vuelve a reclamar en la siguiente corrida si sigue aplicando. Un `reclamado` que se quedó así
-- (la función murió a mitad del envío) NO se reintenta: no se sabe si salió.
--
-- SOLO ESQUEMA. No escribe ni corrige ninguna fila. El motor solo lee líneas con
-- `lineas_negocio.config_extra.recordatorios.activo = true` (ausente = apagado = como hoy).
-- ============================================================================

-- server-only: lo escribe y lo lee solo el cron `/api/crons/recordatorios` con service_role.
create table public.recordatorios_log (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  negocio_id     uuid not null references public.negocios(id) on delete cascade,
  -- id de la regla en `config_extra.recordatorios.reglas` de la línea (p. ej. `toque_1`).
  regla_id       text not null check (length(btrim(regla_id)) between 1 and 60),
  entidad_tipo   text not null check (entidad_tipo in ('cotizacion', 'servicio', 'cuota', 'negocio')),
  entidad_id     uuid not null,
  -- La fecha de la que cuelga el aviso (envío, fecha límite de pago, cuota), no el día en que sale.
  fecha_objetivo date not null,
  -- profile_id del staff, o `cliente:<contacto_id>` para el viajero.
  destinatario   text not null check (length(btrim(destinatario)) > 0),
  canal          text not null check (canal in ('in_app', 'email', 'wa_manual')),
  estado         text not null default 'reclamado'
                 check (estado in ('reclamado', 'enviado', 'fallido', 'omitido')),
  intentos       integer not null default 1 check (intentos between 1 and 3),
  error          text,
  created_at     timestamptz not null default now(),
  enviado_at     timestamptz,
  constraint recordatorios_log_una_vez
    unique (regla_id, entidad_id, fecha_objetivo, destinatario, canal)
);

create index idx_recordatorios_log_negocio on public.recordatorios_log (negocio_id, created_at desc);
create index idx_recordatorios_log_reintentos
  on public.recordatorios_log (created_at) where estado = 'fallido' and intentos < 3;

alter table public.recordatorios_log enable row level security;
revoke all on table public.recordatorios_log from public, anon, authenticated;

comment on table public.recordatorios_log is
  'Recordatorios hacia atrás ya reclamados (motor de /api/crons/recordatorios). Llave única = una vez por regla, entidad, fecha objetivo, destinatario y canal. Escribe y lee solo service_role.';
