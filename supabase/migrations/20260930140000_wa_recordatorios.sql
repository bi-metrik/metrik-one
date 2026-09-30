-- ============================================================
-- 20260930140000 — Recordatorios programados por WhatsApp, con confirmación y registro
-- ------------------------------------------------------------
-- Hasta hoy ONE solo puede CONTESTAR por WhatsApp dentro de la ventana de 24 h: no hay
-- ningún envío que ARRANQUE una conversación a hora fija. `wa-alerts` dispara avisos de
-- estado una vez al día, pasa por el tope de 2 por persona (`wa-alerta.ts`) y desde el
-- 2026-09-27 solo sale en día hábil. Nada de eso sirve para un recordatorio que tiene que
-- salir varias veces al día, todos los días, y que pide una respuesta.
--
-- Lo que esta migración agrega es el LEDGER, que es el dato que hoy no existe en ninguna
-- parte: una fila por dosis programada, con la hora en que salió, la hora en que la
-- persona confirmó y la hora en que hubo que escalar. Sin él "¿se cumplió?" no tiene
-- dónde contestarse, y un recordatorio sin esa respuesta es una alarma peor que la del
-- teléfono (la del teléfono al menos no da falsa constancia).
--
-- ⚠️ CONTENIDO: lo único que viaja a Meta es `etiqueta`, texto corto y neutro que escribe
-- quien siembra la fila. Esta tabla NO es para datos sensibles: ni nombres de personas, ni
-- de medicamentos, ni diagnósticos, ni edades. Ese texto sale del servidor, entra al
-- cuerpo de una plantilla y queda en `wa_envios.preview`, en los logs de la función y en
-- los de Meta. Quien siembre una fila decide qué queda en esos tres sitios.
--
-- ⚠️ FESTIVOS: este tipo de mensaje NO pasa por la regla de día hábil del 2026-09-27
-- (avisos automáticos al cliente solo en día hábil del país del cliente). Corre los 365
-- días, domingo y festivo incluidos. No es un aviso comercial: es un recordatorio que la
-- persona pidió para sí misma, y saltarse un domingo es justo el fallo que vino a evitar.
-- Por eso el ejecutor NO usa `enviarAlerta` (que aplica día hábil y el tope diario) sino
-- `sendTemplate` directo. Está comentado también en `_shared/wa-recordatorios.ts` para que
-- nadie lo "arregle" después.
--
-- server-only: las dos tablas las escriben las Edge Functions con `service_role`. RLS
-- queda prendida SIN políticas (igual que `wa_envios`), así que `anon` y `authenticated`
-- no ven nada. Cuando haya pantalla de administración se abre con su propia política por
-- workspace, que es una decisión aparte de esta.
-- ============================================================

create table if not exists public.wa_recordatorios (
  id uuid primary key default gen_random_uuid(),

  -- Nulo permitido: un recordatorio de infraestructura de MeTRIK no pertenece a ningún
  -- workspace de cliente. Misma decisión que `wa_envios.workspace_id`.
  workspace_id uuid references public.workspaces(id) on delete cascade,

  -- A quién le llega. Solo dígitos con indicativo, como todo lo que sale por la Graph API
  -- (`wa_envios.phone`). No hay FK a `staff`: el destinatario puede no tener usuario.
  destinatario_phone text not null check (destinatario_phone ~ '^[0-9]{10,15}$'),

  -- A quién se le avisa cuando no hubo confirmación. Nulo = no se escala a nadie más, solo
  -- se le reenvía al principal.
  escalamiento_phone text check (escalamiento_phone ~ '^[0-9]{10,15}$'),

  -- El ÚNICO texto que viaja a Meta. Corto porque entra como parámetro del cuerpo de la
  -- plantilla, y neutro porque queda en tres bitácoras que no controlamos. Ver la cabecera.
  etiqueta text not null check (length(btrim(etiqueta)) between 1 and 60),

  -- Las horas del día en que sale. `time` sin zona: se interpretan en `zona`, y la que
  -- manda es la de abajo, no la del servidor (Vercel y Deno corren en UTC).
  horarios time[] not null check (cardinality(horarios) between 1 and 12),

  -- Fija a propósito, y con CHECK: todo el cálculo de fecha/hora del ejecutor asume el
  -- desplazamiento constante de Colombia (UTC-5, sin horario de verano). Una zona con DST
  -- necesitaría otra aritmética, así que se prefiere que la fila no se pueda escribir
  -- antes que salir a la hora equivocada dos veces al año.
  zona text not null default 'America/Bogota' check (zona = 'America/Bogota'),

  -- Minutos sin confirmación después de los cuales se escala. Es la parte que da el valor.
  escalamiento_minutos int not null default 30 check (escalamiento_minutos between 5 and 720),

  activo boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.wa_recordatorios is
  'Recordatorios programados por WhatsApp. `etiqueta` es lo único que viaja a Meta: texto neutro, '
  'sin nombres de personas ni datos de salud. Se siembran por SQL; no hay UI en esta versión.';

-- Una fila por DOSIS programada. El ledger de adherencia.
create table if not exists public.wa_recordatorio_eventos (
  id uuid primary key default gen_random_uuid(),
  recordatorio_id uuid not null references public.wa_recordatorios(id) on delete cascade,

  -- El instante exacto en que tocaba, ya resuelto a UTC desde (día de Bogotá + horario).
  -- Es la llave de idempotencia: el cron materializa el evento con `on conflict do nothing`,
  -- así que dos corridas del mismo cuarto de hora no pueden crear dos dosis.
  programado_para timestamptz not null,

  -- Se estampa ANTES de llamar a Meta, con `where enviado_at is null ... returning`: el que
  -- se lleva la fila es el que envía. Leer-y-luego-escribir dejaría la ventana abierta para
  -- que dos corridas solapadas mandaran el mismo recordatorio dos veces.
  enviado_at timestamptz,

  confirmado_at timestamptz,
  -- Teléfono que tocó el botón. Puede ser el principal o el de escalamiento.
  confirmado_por text,

  escalado_at timestamptz,

  -- wamid que devolvió la Graph API (cruza con `wa_envios.wa_message_id`). SIN clave
  -- foránea a propósito, aunque esa columna sea única: `wa_envios` es telemetría que se
  -- traga sus propios errores (ver `_shared/wa-envios.ts`), y si una vez no logra escribir
  -- su fila, una FK haría fallar el estampado del envío y el recordatorio saldría de nuevo
  -- en la corrida siguiente. Un cruce sin garantía vale más que un envío duplicado.
  wa_envio_id text,

  created_at timestamptz not null default now(),

  unique (recordatorio_id, programado_para)
);

comment on table public.wa_recordatorio_eventos is
  'Una fila por dosis programada: cuándo tocaba, cuándo salió, cuándo se confirmó y cuándo se '
  'escaló. Es el ledger de adherencia y la razón de ser del módulo.';

-- Lo que el cron pregunta en cada corrida: qué salió y está sin confirmar. Índices
-- parciales porque las dos consultas calientes miran solo filas abiertas.
create index if not exists idx_wa_rec_eventos_sin_confirmar
  on public.wa_recordatorio_eventos (enviado_at)
  where enviado_at is not null and confirmado_at is null and escalado_at is null;

create index if not exists idx_wa_rec_eventos_por_recordatorio
  on public.wa_recordatorio_eventos (recordatorio_id, programado_para desc);

create index if not exists idx_wa_recordatorios_activos
  on public.wa_recordatorios (activo) where activo;

alter table public.wa_recordatorios enable row level security;
alter table public.wa_recordatorio_eventos enable row level security;

-- `service_role` no pasa por los grants; el revoke es para que ninguna de las dos quede
-- alcanzable desde el cliente por PostgREST mientras no exista pantalla.
revoke all on public.wa_recordatorios from anon, authenticated;
revoke all on public.wa_recordatorio_eventos from anon, authenticated;
