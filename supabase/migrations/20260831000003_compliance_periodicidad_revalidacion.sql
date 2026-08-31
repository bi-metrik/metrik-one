-- Compliance — periodicidad de revalidación por nivel de riesgo (R2)
--
-- Qué pidió la oficial de cumplimiento (reunión 2026-08-18): que cada consulta
-- sepa cuándo hay que repetirla, y que la frecuencia dependa de lo que la
-- consulta encontró. Su cuadro: sin reporte 12 meses, riesgo medio 6, riesgo
-- alto 3, PEP 6.
--
-- ── Por qué es configurable y no una constante en código ──────────────────
--
-- Dictamen de Lucía (2026-08-24): **el cuadro 12/6/3 no tiene fuente normativa
-- verificada**. Es criterio del oficial, no obligación citable, y ya se comprobó
-- que coincide con el default del preset de segmentación. Concepto de Emilio
-- (2026-08-31, §1.2): el efecto de cada categoría sobre el flujo interno es
-- **parámetro del obligado**, no afirmación de MéTRIK. Lo que MéTRIK afirma es
-- qué ES la fuente (el tier); cuánto dura la vigencia lo decide ALMA.
--
-- Cablearlo en código sería MéTRIK fijando la política de riesgo del cliente. Por
-- eso vive en una tabla por workspace, con un default sugerido y editable.
--
-- ── Por qué la llave es el tier y no un "nivel de riesgo" inventado ───────
--
-- El tier ya es un vocabulario cerrado, con sustento publicado por fuente y
-- versionado (`compliance_tier_fuentes`, 2026-08-25). Inventar un segundo eje
-- de "bajo / medio / alto" obligaría a mantener dos traducciones y a que alguien
-- decidiera, sin sustento, cuál tier es "medio". El cuadro de Yessica se expresa
-- sembrando meses sobre los tiers que ya existen.
--
-- ── Lo que esta migración NO hace ─────────────────────────────────────────
--
-- No frena ninguna contratación. Acortar la frecuencia con que el obligado
-- revisa a una contraparte suya no es una recomendación adversa: es
-- intensificación de su propia diligencia, y por eso el concepto de Emilio la
-- puso en el bloque A y no en el B.

create table if not exists compliance_periodicidad_config (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  -- Vocabulario cerrado. `sin_hallazgo` no es un tier: es la consulta que no
  -- trajo nada, y es justo la fila que Yessica llamó "sin reporte".
  nivel text not null check (nivel in
    ('sin_hallazgo', 'tier_1', 'tier_2', 'tier_3', 'tier_4', 'medios', 'sin_clasificar')),

  -- Meses hasta la siguiente revalidación. El tope de 60 no es normativo: es un
  -- freno a un cero o un número absurdo tecleado por error, que en un lado
  -- convierte el motor en un gasto infinito y en el otro apaga la vigilancia.
  meses integer not null check (meses >= 1 and meses <= 60),

  actualizado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un solo valor por nivel y workspace. Dos filas para el mismo nivel es no
  -- saber cuál vigencia se aplicó.
  unique (workspace_id, nivel)
);

comment on table compliance_periodicidad_config is
  'R2: cada cuántos meses se revalida una contraparte, por nivel. Politica del obligado, no de MeTRIK: el cuadro 12/6/3 es criterio del oficial y no tiene fuente normativa verificada (dictamen Lucia 2026-08-24).';

comment on column compliance_periodicidad_config.nivel is
  'Tier del catalogo, mas sin_hallazgo. No se inventa un segundo eje de riesgo: el tier ya es vocabulario cerrado y versionado.';

create index if not exists idx_periodicidad_workspace
  on compliance_periodicidad_config(workspace_id);

-- `updated_at` con trigger y no solo con default. El 2026-08-22 se midió que
-- `riesgos_controles.updated_at` tenía default y NO trigger: los 18 controles
-- llevaban meses con `updated_at = created_at`, y cualquier indicador que
-- comparara contra esa columna habría dicho "todo al dia" para siempre. Una
-- pantalla sana que miente es peor que una rota, porque no se ve.
create or replace function tg_periodicidad_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_periodicidad_touch on compliance_periodicidad_config;
create trigger trg_periodicidad_touch
  before update on compliance_periodicidad_config
  for each row execute function tg_periodicidad_touch();

-- RLS: server-only, mismo criterio que el resto de tablas de compliance. Se leen
-- y escriben por server actions con el service client, que valida el rol del
-- oficial de cumplimiento antes de tocar nada.
alter table compliance_periodicidad_config enable row level security;

revoke all on compliance_periodicidad_config from anon, authenticated;

-- ── La vigencia de cada consulta ──────────────────────────────────────────
--
-- Se guarda calculada en la fila y no se deriva al leer: la config puede cambiar
-- mañana, y una consulta tiene que poder decir bajo qué política se le fijó su
-- vigencia. Derivarla al vuelo reescribiría el pasado cada vez que el oficial
-- ajusta un número.
alter table consultas_listas_dual
  add column if not exists vigente_hasta date,
  add column if not exists vigencia_meses integer,
  add column if not exists vigencia_nivel text;

comment on column consultas_listas_dual.vigente_hasta is
  'Fecha civil hasta la que esta consulta cubre. Se calcula al guardar con la config vigente ese dia; no se deriva al leer.';
comment on column consultas_listas_dual.vigencia_nivel is
  'Nivel con el que se calculo la vigencia. Es el MAS exigente presente, no el tier maximo.';

create index if not exists idx_consultas_dual_vigencia
  on consultas_listas_dual(workspace_id, vigente_hasta)
  where vigente_hasta is not null;
