-- ============================================================
-- 20260929100000 — Paso de entendimiento de la bandeja de WhatsApp
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-28-solicitud-configurable.md (PR 2).
-- Diseño: motor-solicitud-viaje.md §3 (paso 2, entendimiento) y §4 (historia, requerimientos, huecos).
--
-- Qué agrega:
--   1. `wa_bandeja_entendimientos`: lo que el modelo entendió de una entrega, APARTE del crudo.
--      Si el modelo falla, la entrega y sus mensajes (`wa_bandeja_*`) quedan intactos y el paso
--      se reintenta. Una fila por entrega (`entrega_id` único): el INSERT es el reclamo, así
--      dos corridas del cron no procesan la misma.
--   2. Un papel nuevo en `wa_bandeja_mensajes`: `respuesta_contacto`, la respuesta del
--      comercial a «¿cuál de estos contactos es?». Se guarda como todo lo demás de la bandeja.
--
-- Sin datos que migrar: la bandeja nació apagada (`modules.bandeja_solicitudes_wa`) y la
-- tabla nueva nace vacía. Nada se ejecuta en un workspace sin esa llave.
--
-- ORDEN: esta migración ANTES del deploy de `wa-alerts` y `wa-webhook` con el paso de
-- entendimiento (el código lee y escribe la tabla nueva). El cron va aparte, en
-- 20260929100100, DESPUÉS del deploy.
-- ============================================================

create table public.wa_bandeja_entendimientos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  entrega_id uuid not null references public.wa_bandeja_entregas(id) on delete cascade,
  -- Copia del remitente de la entrega: la respuesta a «¿cuál contacto?» se busca por él.
  remitente_phone text not null,
  remitente_staff_id uuid references public.staff(id) on delete set null,

  --   procesando          → lo tomó una corrida del cron
  --   error               → falló (modelo, config, escritura); se reintenta hasta 3 veces
  --                         mientras no exista contacto ni negocio
  --   esperando_contacto  → se le preguntó al comercial cuál contacto es (0 o varios candidatos)
  --   negocio_creado      → el negocio existe con los valores sugeridos
  --   descartada          → la entrega no tenía texto que entender
  estado text not null default 'procesando'
    constraint wa_bandeja_entendimientos_estado check
      (estado in ('procesando', 'error', 'esperando_contacto', 'negocio_creado', 'descartada')),
  intentos integer not null default 0,
  error text,

  linea_id uuid references public.lineas_negocio(id) on delete set null,
  -- Salida del modelo, ya filtrada contra la config y contra el mensaje:
  historia text,
  -- { slug: { valor, frase } } — solo lo que trae una frase del mensaje que lo sostiene
  sugeridos jsonb,
  -- [{ slug, motivo }] — lo que el modelo dijo y no pasó el filtro (sin frase, fuera de opciones…)
  descartados jsonb,
  -- { minimo: {completos, total, faltan[]}, deseable: {…}, errores[] } — `calcularNiveles`
  huecos jsonb,
  -- { nombre, telefono } del cliente si los mensajes los dicen
  cliente jsonb,
  modelo text,
  -- Motivo de terminación del modelo. Solo 'STOP' se acepta (§3 del diseño).
  finish_reason text,

  -- Contacto: se une solo si hay UNO exacto (teléfono o nombre idéntico); si no, se pregunta.
  contacto_nombre text,
  contacto_opciones jsonb,
  pregunta_contacto_at timestamptz,
  respuesta_contacto text,
  respuesta_at timestamptz,
  contacto_id uuid references public.contactos(id) on delete set null,

  negocio_id uuid references public.negocios(id) on delete set null,
  respuesta_enviada_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wa_bandeja_entendimientos_entrega unique (entrega_id)
);

create index wa_bandeja_entendimientos_pendientes
  on public.wa_bandeja_entendimientos (estado, updated_at)
  where estado in ('error', 'esperando_contacto');

create index wa_bandeja_entendimientos_remitente
  on public.wa_bandeja_entendimientos (workspace_id, remitente_phone)
  where estado = 'esperando_contacto';

-- Escribe SOLO el servidor (cron y webhook, con service_role). El equipo del workspace puede
-- LEER lo suyo, igual que las tablas de la bandeja. Nada para anon.
alter table public.wa_bandeja_entendimientos enable row level security;
revoke all on public.wa_bandeja_entendimientos from anon, authenticated;
grant select on public.wa_bandeja_entendimientos to authenticated;
grant all on public.wa_bandeja_entendimientos to service_role;

create policy wa_bandeja_entendimientos_lectura on public.wa_bandeja_entendimientos
  for select to authenticated
  using (workspace_id = (select public.current_user_workspace_id()));

-- ── Papel nuevo en los mensajes ──────────────────────────────────────────────
alter table public.wa_bandeja_mensajes drop constraint wa_bandeja_mensajes_papel;
alter table public.wa_bandeja_mensajes add constraint wa_bandeja_mensajes_papel
  check (papel in ('contenido', 'cierre', 'respuesta_cliente', 'respuesta_contacto'));
