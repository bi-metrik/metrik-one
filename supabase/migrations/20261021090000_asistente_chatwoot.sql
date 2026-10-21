-- El asistente público sobre Chatwoot (Sabor & Experiencias, etapa 1): la conversación por conversación de Chatwoot y
-- la prueba de los avisos y autorizaciones de datos.
--
-- Diseño: proyectos/sabor-experiencias/clarity/docs/entrada/diseno-asistente-etapa1.md (§3.3, §5, §9, §11) y
-- brief-max-asistente-etapa1.md, puntos 1, 2 y 6.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué tablas nuevas y no columnas en `wa_conversacion`
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La llave de la conversación de Chatwoot es cuenta + id de conversación, no un teléfono (en Instagram y TikTok no hay
-- teléfono). `wa_conversacion` tiene `phone not null`, su RPC de salientes y la cuenta del uso del mes de Trappvel
-- (`bot_uso_mes`). Cambiarla arriesga al bot de Trappvel, que está en producción (brief, punto 2). Aquí nada toca
-- `wa_conversacion`.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Qué hace
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. `chatwoot_conversacion`: una fila por mensaje, en las dos direcciones.
--    · entrante: lo que escribió el contacto (o su nota de voz, ya transcrita en `texto`), guardado por el webhook
--      ANTES de responder 200. `chatwoot_message_id` único por cuenta: el reintento de Chatwoot no entra dos veces.
--    · saliente: lo que el asistente publica. Nace `generado` y pasa a `publicado` cuando Chatwoot lo acepta. La API
--      de crear mensaje de Chatwoot no tiene clave de idempotencia: una sola fila por (turno, ranura) hace que el mismo
--      turno no publique dos veces la misma cosa (§3.3). `incierto` = no se sabe si llegó: no se reintenta a ciegas.
--    · `enmascarado`: el mensaje traía un dato de salud y en nuestra base queda sin el detalle (§5.3).
-- 2. `chatwoot_consentimientos`: la prueba del aviso de datos y de cada autorización (Decreto 1377 de 2013, art. 8):
--    tipo (`aviso`, `general`, `sensible`), respuesta, versión y huella sha256 del texto, el mensaje de aceptación y
--    su id en Chatwoot, canal y fecha. No se edita (trigger); se puede borrar (supresión de datos, «borren mis datos»).
--
-- No siembra nada. No toca datos existentes. El reglamento del asistente va en `bot_parametros`/`bot_reglamentos`
-- (migración 20261006213200), con el bot `asistente-publico`, y la semilla de PRUEBA vive en
-- `sql/sabor/2026-10-21_reglamento-asistente-PRUEBA.sql`, que no se aplica en producción.
--
-- Retención: sin borrado automático. Cuánto se conserva lo decide Emilio (E2-E5 abiertas).
--
-- epoca: no-rompe tablas y trigger nuevos; nada del código de hoy los usa.

create table public.chatwoot_conversacion (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cuenta_id bigint not null,
  conversacion_id bigint not null,
  inbox_id bigint,
  canal text not null,
  direccion text not null,
  clase text not null,
  texto text,
  enmascarado boolean not null default false,
  -- El adjunto (audio) como llegó: tipo, url y extensión. Nunca los bytes.
  adjunto jsonb,
  opciones jsonb,
  toque_id text,
  chatwoot_message_id bigint,
  turno_id uuid,
  -- Solo salientes: qué lugar del turno ocupa (`respuesta`, `aviso_demora`, `extra_1`, `nota`…). Única por turno.
  ranura text,
  estado text,
  traza jsonb,
  -- Lo que tardó el webhook en guardar el mensaje (para la meta de p99 < 1 s).
  ms_webhook integer,
  created_at timestamptz not null default now(),
  publicado_at timestamptz,
  constraint chatwoot_conversacion_canal check (canal in ('instagram', 'tiktok', 'whatsapp', 'otro')),
  constraint chatwoot_conversacion_direccion check (direccion in ('entrante', 'saliente')),
  constraint chatwoot_conversacion_clase check (clase in ('escrito', 'toque', 'audio', 'imagen', 'otro', 'bot', 'nota')),
  constraint chatwoot_conversacion_estado check (
    (direccion = 'entrante' and estado is null)
    or (direccion = 'saliente' and estado in ('generado', 'publicado', 'fallido', 'incierto'))
  ),
  constraint chatwoot_conversacion_ranura check ((direccion = 'saliente') = (ranura is not null))
);

comment on table public.chatwoot_conversacion is
  'Conversacion del asistente publico sobre Chatwoot, una fila por mensaje. Llave: cuenta_id + conversacion_id. '
  'Salientes: generado -> publicado, una fila por (turno, ranura) para no publicar dos veces. Solo service_role.';

create unique index chatwoot_conversacion_mensaje on public.chatwoot_conversacion (cuenta_id, chatwoot_message_id)
  where chatwoot_message_id is not null and direccion = 'entrante';
create unique index chatwoot_conversacion_ranura_turno on public.chatwoot_conversacion (turno_id, ranura)
  where direccion = 'saliente';
create index chatwoot_conversacion_hilo on public.chatwoot_conversacion (workspace_id, cuenta_id, conversacion_id, created_at);
-- El gasto del día (tope de presupuesto, §11): trazas de turnos del modelo por workspace y fecha.
create index chatwoot_conversacion_trazas_modelo on public.chatwoot_conversacion (workspace_id, created_at)
  where traza->>'tipo' = 'modelo';

alter table public.chatwoot_conversacion enable row level security;
-- server-only: la leen y escriben solo la función `chatwoot-agente` y el arnés, con la llave de servicio.
revoke all on public.chatwoot_conversacion from anon, authenticated;
grant all on public.chatwoot_conversacion to service_role;

create table public.chatwoot_consentimientos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cuenta_id bigint not null,
  conversacion_id bigint not null,
  canal text not null,
  tipo text not null,
  respuesta text not null,
  -- La respuesta fija mostrada (`rf.bienvenida`, `rf.autorizacion`, `rf.autorizacion_sensible`), su versión y huella.
  texto_clave text not null,
  texto_version text not null,
  texto_huella text not null,
  -- El mensaje con que la persona respondió («sí», el botón) y su id en Chatwoot. En el aviso: el id del aviso publicado.
  mensaje_texto text,
  chatwoot_message_id bigint,
  created_at timestamptz not null default now(),
  constraint chatwoot_consentimientos_tipo check (tipo in ('aviso', 'general', 'sensible')),
  constraint chatwoot_consentimientos_respuesta check (
    (tipo = 'aviso' and respuesta = 'informado') or (tipo in ('general', 'sensible') and respuesta in ('si', 'no'))
  ),
  constraint chatwoot_consentimientos_huella check (texto_huella ~ '^[0-9a-f]{64}$')
);

comment on table public.chatwoot_consentimientos is
  'Prueba del aviso de datos y de las autorizaciones (general y sensible) del asistente publico: texto, version, huella, '
  'mensaje de aceptacion e id en Chatwoot. Inmutable (se puede borrar por supresion). Solo service_role.';

create index chatwoot_consentimientos_hilo on public.chatwoot_consentimientos (workspace_id, cuenta_id, conversacion_id, created_at);

alter table public.chatwoot_consentimientos enable row level security;
-- server-only: la escribe solo la función `chatwoot-agente` con la llave de servicio; es prueba legal, no la ve la app.
revoke all on public.chatwoot_consentimientos from anon, authenticated;
grant all on public.chatwoot_consentimientos to service_role;

create or replace function public.chatwoot_consentimientos_inmutable() returns trigger
language plpgsql
set search_path = public
as $fn$
begin
  raise exception 'chatwoot_consentimientos es inmutable: una autorizacion nueva es otra fila';
end;
$fn$;

revoke execute on function public.chatwoot_consentimientos_inmutable() from public, anon, authenticated;

create trigger chatwoot_consentimientos_inmutable
  before update on public.chatwoot_consentimientos
  for each row execute function public.chatwoot_consentimientos_inmutable();
