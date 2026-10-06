-- Piloto de red (soena, 2026-10-06): eventos de conexión por persona, consultables a diario.
--
-- Brief: proyectos/soena/ve/2026-10-06_brief-max-piloto-red-documentos.md (agregado «medir por
-- persona»). Hasta hoy lo escribe `POST /api/red/eventos` solo en los logs de Vercel
-- (`[red-piloto]`), que duran 30 días, se leen a mano y repiten filas. Esta tabla guarda lo mismo
-- para consultarlo con SQL.
--
-- Quién escribe: `/api/red/eventos` con service_role (después de responder). Quién lee: SQL desde
-- la torre (MCP) y la vista de abajo. Nadie desde el navegador.
--
-- Persona: `persona_staff_id` SOLO para la lista explícita del piloto (`PERSONAS_MEDIDAS` en
-- src/lib/red/piloto.ts); el resto queda en null. Sin IP: el operador llega resuelto (ASN).
--
-- Volumen esperado con 100 personas: ~11.000 filas/día (un `pulso` cada 5 min por pestaña visible
-- + cortes y fallas). Se purgan a los 90 días (`/api/crons/purgar-red-eventos`).
--
-- epoca: no-rompe solo crea objetos nuevos

create table public.red_eventos (
  -- id del evento que genera el navegador: el reenvío de la bandeja no duplica.
  id text primary key check (id ~ '^[A-Za-z0-9-]{1,40}$'),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  persona_staff_id uuid references public.staff (id) on delete set null,
  tipo text not null check (tipo in ('pulso', 'corte', 'falla')),
  superficie text check (superficie in ('carga', 'navegacion', 'accion', 'subida', 'descarga', 'lectura')),
  ocurrido_at timestamptz not null,
  dur_ms integer check (dur_ms is null or dur_ms >= 0),
  operador text,
  asn integer,
  ciudad text,
  region text,
  dispositivo text,
  sw boolean,
  detalle jsonb not null default '{}'::jsonb,
  recibido_at timestamptz not null default now()
);

-- server-only: la escribe /api/red/eventos con service_role y se lee por SQL; sin grant ni policy.
alter table public.red_eventos enable row level security;

create index red_eventos_ws_fecha on public.red_eventos (workspace_id, ocurrido_at);
create index red_eventos_persona_fecha on public.red_eventos (persona_staff_id, ocurrido_at)
  where persona_staff_id is not null;

comment on table public.red_eventos is
  'Piloto de red: pulso, cortes y fallas por superficie (ver src/lib/red/). Server-only. Purga a 90 días.';

-- Resumen diario por persona y operador (fecha de Bogotá). Lo pidió Mauricio el 2026-10-06:
-- cortes, duración, superficie, operador y antes/después del service worker (`sw_pct`).
--   select * from public.v_red_resumen_diario where workspace = 'soena' order by fecha desc;
create view public.v_red_resumen_diario with (security_invoker = on) as
select
  (e.ocurrido_at at time zone 'America/Bogota')::date as fecha,
  w.slug as workspace,
  e.persona_staff_id,
  s.full_name as persona,
  coalesce(e.operador, '(operador?)') as operador,
  round(sum(case when e.tipo = 'pulso' then (e.detalle ->> 'visible_ms')::numeric else 0 end) / 60000) as minutos_medidos,
  round(100 * sum(case when e.tipo = 'pulso' and e.sw then (e.detalle ->> 'visible_ms')::numeric else 0 end)
    / nullif(sum(case when e.tipo = 'pulso' then (e.detalle ->> 'visible_ms')::numeric else 0 end), 0)) as sw_pct,
  sum(case when e.tipo = 'pulso' then (e.detalle -> 'vercel' ->> 'n')::int else 0 end) as sondas_vercel,
  sum(case when e.tipo = 'pulso' then (e.detalle -> 'vercel' ->> 'perdidas')::int else 0 end) as perdidas_vercel,
  sum(case when e.tipo = 'pulso' then (e.detalle -> 'control' ->> 'n')::int else 0 end) as sondas_control,
  sum(case when e.tipo = 'pulso' then (e.detalle -> 'control' ->> 'perdidas')::int else 0 end) as perdidas_control,
  count(*) filter (where e.tipo = 'corte') as cortes,
  count(*) filter (where e.tipo = 'corte' and (e.detalle ->> 'vercel')::boolean and (e.detalle ->> 'control')::boolean) as cortes_internet,
  count(*) filter (where e.tipo = 'corte' and (e.detalle ->> 'vercel')::boolean and not (e.detalle ->> 'control')::boolean) as cortes_solo_vercel,
  round(coalesce(sum(e.dur_ms) filter (where e.tipo = 'corte'), 0) / 1000.0) as segundos_corte,
  round(coalesce(max(e.dur_ms) filter (where e.tipo = 'corte'), 0) / 1000.0) as corte_mas_largo_s,
  count(*) filter (where e.tipo = 'falla' and e.superficie = 'carga') as fallas_carga,
  count(*) filter (where e.tipo = 'falla' and e.superficie = 'carga' and (e.detalle ->> 'recuperado')::boolean) as cargas_salvadas,
  count(*) filter (where e.tipo = 'falla' and e.superficie = 'navegacion') as fallas_navegacion,
  count(*) filter (where e.tipo = 'falla' and e.superficie = 'accion') as fallas_accion,
  count(*) filter (where e.tipo = 'falla' and e.superficie = 'subida') as fallas_subida,
  count(*) filter (where e.tipo = 'falla' and e.superficie = 'lectura') as fallas_lectura
from public.red_eventos e
join public.workspaces w on w.id = e.workspace_id
left join public.staff s on s.id = e.persona_staff_id
group by 1, 2, 3, 4, 5;

comment on view public.v_red_resumen_diario is
  'Piloto de red: resumen diario por persona y operador. Server-only (sin grant): se lee por SQL.';
