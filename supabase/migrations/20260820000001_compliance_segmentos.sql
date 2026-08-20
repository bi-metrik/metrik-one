-- Compliance — catálogo de segmentos de consulta (R1)
--
-- Problema: `consultas_listas_dual` registra QUÉ se consultó pero no A QUÉ POBLACIÓN
-- pertenece la contraparte. Sin eso no se puede re-consultar en masa "todos los
-- empleados una vez al año", que es el uso que pidió la oficial de cumplimiento.
--
-- Diseño: catálogo por workspace donde cada segmento declara a qué UNIVERSO
-- pertenece. El universo es el mismo eje que ya usa la segmentación SARLAFT
-- (`valida_segmentacion_config.pesos_contrapartes` / `pesos_empleados`,
-- `valida_score_negocio.universo`, `src/lib/valida/segmentacion-presets.ts`).
-- El universo es el eje estable; el segmento es la etiqueta operativa.
--
-- Un cliente que necesite "Proveedor", "Accionista" o "Aliado" los agrega como
-- filas del catálogo con universo='contraparte' — sin tocar código y sin que la
-- segmentación SARLAFT tenga que cambiar sus pesos ni sus umbrales.
--
-- NOTA sobre `consultas_listas_dual`: esa tabla se creó fuera de este directorio
-- de migraciones (existe en producción, no en el historial del repo). Este archivo
-- solo la ALTERA; el `add column if not exists` falla ruidoso si la tabla no existe,
-- que es el comportamiento correcto: no queremos que un entorno sin la tabla base
-- aplique esta migración a medias.

-- =============================================================================
-- 1. Catálogo de segmentos por workspace
-- =============================================================================

create table if not exists compliance_segmentos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  nombre text not null,
  universo text not null check (universo in ('contraparte', 'empleado')),
  activo boolean not null default true,
  orden int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint compliance_segmentos_nombre_no_vacio check (btrim(nombre) <> ''),
  constraint compliance_segmentos_workspace_nombre_key unique (workspace_id, nombre)
);

create index if not exists idx_compliance_segmentos_workspace
  on compliance_segmentos(workspace_id, activo, orden);

comment on table compliance_segmentos is
  'Catálogo de segmentos de consulta por workspace. Cada segmento se ancla a un universo (contraparte|empleado), que es el mismo eje de la segmentación SARLAFT.';
comment on column compliance_segmentos.universo is
  'contraparte | empleado. Debe coincidir con los universos de valida_segmentacion_config y de src/lib/valida/segmentacion-presets.ts.';
comment on column compliance_segmentos.activo is
  'false = no se ofrece para consultas nuevas, pero las consultas históricas conservan la referencia.';
comment on column compliance_segmentos.orden is
  'Orden de presentación en los selectores. Menor primero.';

-- server-only: todo acceso al catálogo pasa por server actions con
-- `createServiceClient()` (compliance-segmentos.ts y compliance-dual.ts). El
-- cliente nunca lo consulta directo, así que no se otorga nada a `authenticated`.
-- Las policies de abajo NO sobran: son la red por si mañana un consumidor lo
-- lee con el cliente autenticado — sin ellas ese día se leería cross-tenant.
alter table compliance_segmentos enable row level security;

drop policy if exists compliance_segmentos_select on compliance_segmentos;
create policy compliance_segmentos_select on compliance_segmentos
  for select using (workspace_id = current_user_workspace_id());

drop policy if exists compliance_segmentos_modify on compliance_segmentos;
create policy compliance_segmentos_modify on compliance_segmentos
  for all using (workspace_id = current_user_workspace_id())
  with check (workspace_id = current_user_workspace_id());

-- updated_at
create or replace function set_updated_at_compliance_segmentos()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Toda función nace ejecutable por PUBLIC y `anon` la alcanza por ahí; el default
-- de la base no lo puede evitar, así que el revoke explícito es el único mecanismo.
-- Disparar un trigger NO exige EXECUTE, solo crearlo.
revoke execute on function public.set_updated_at_compliance_segmentos() from public, anon;

drop trigger if exists trg_compliance_segmentos_updated_at on compliance_segmentos;
create trigger trg_compliance_segmentos_updated_at
  before update on compliance_segmentos
  for each row
  execute function set_updated_at_compliance_segmentos();

-- =============================================================================
-- 2. Segmento en la consulta
-- =============================================================================

-- NULLABLE a propósito: hay consultas históricas anteriores al catálogo y tienen
-- que seguir listándose. La aplicación exige el segmento para consultas NUEVAS
-- (`consultaDualPersistente` rechaza el input sin segmento antes de llamar a la
-- fuente); el esquema solo garantiza integridad referencial.
--
-- `on delete restrict`: borrar un segmento con consultas colgando destruiría la
-- trazabilidad de por qué se consultó a esa contraparte. El ABM ofrece desactivar
-- (activo=false), que es reversible.
alter table consultas_listas_dual
  add column if not exists segmento_id uuid references compliance_segmentos(id) on delete restrict;

comment on column consultas_listas_dual.segmento_id is
  'Segmento del catálogo compliance_segmentos al que pertenece la contraparte consultada. NULL solo en consultas anteriores a R1 (se muestran como "sin segmento").';

-- Índice del barrido que motiva R1: "todos los del segmento X en el periodo Y".
create index if not exists idx_consultas_listas_dual_segmento
  on consultas_listas_dual(workspace_id, segmento_id, created_at desc);
