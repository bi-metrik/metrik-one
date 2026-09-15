-- ============================================================
-- 20260915210000 — Activación de módulos por workspace, con historia (entrega A1)
-- Spec: proyectos/metrik/one/2026-09-15_spec-modulos-servicios-cobro.md, §2.2
--
-- Qué hay hoy (medido en producción el 2026-09-15, solo lectura): `workspaces.modules` es un
-- jsonb de interruptores que escriben a mano los scripts `setup-*.ts` y el SQL de las
-- sesiones. No dice por qué un workspace tiene un módulo, desde cuándo ni quién lo encendió.
-- 17 workspaces, 7 de ellos con módulos encendidos sin ningún contrato que los cubra.
--
-- Qué agrega esto — solo DDL, ninguna fila se inserta ni se reescribe:
--   1. `workspace_modulos`: una fila por activación de un módulo en un workspace, con su
--      origen, su motivo y su vigencia. Es la fuente que en adelante decide qué módulos
--      tiene cada workspace.
--   2. `proyectar_modulos(workspace_id)`: calcula cómo quedaría `workspaces.modules` si se
--      recalculara desde esa tabla, y lo compara con lo que hay hoy. EN ESTA ENTREGA SOLO
--      CALCULA: es `stable`, y Postgres no deja escribir a una función `stable`
--      ("UPDATE is not allowed in a non-volatile function"). Que la proyección no esté
--      encendida lo garantiza la base, no la disciplina de quien la llame.
--
-- Qué NO hace, a propósito:
--   - no carga filas: la carga inicial desde los flags de hoy vive en
--     `sql/modulos/carga-inicial-workspace-modulos.sql` y es escritura de datos en producción
--     (necesita autorización de Mauricio);
--   - no toca `workspaces.modules`, que sigue siendo lo que leen el gate por ruta, el menú y
--     cada pantalla;
--   - no crea `servicios_contratados` (entrega A2), así que `servicio_contratado_id` nace sin
--     llave foránea y sin exigirse (ver el CHECK de abajo).
--
-- Encender la proyección es otra migración: reemplaza la función por una que escribe, y solo
-- se hace cuando el ensayo del paso 0 de la carga inicial da 0 cambios en los 17 workspaces.
--
-- Verificación después de aplicar (solo lectura):
--   select relrowsecurity, relacl from pg_class where oid = 'public.workspace_modulos'::regclass;
--     -> relrowsecurity = true y relacl SIN entradas para anon ni authenticated
--   select has_table_privilege('anon', 'public.workspace_modulos', 'select'),
--          has_table_privilege('authenticated', 'public.workspace_modulos', 'select');
--     -> false, false
--   select proname, provolatile,
--          has_function_privilege('anon', p.oid, 'execute'),
--          has_function_privilege('authenticated', p.oid, 'execute'),
--          has_function_privilege('service_role', p.oid, 'execute')
--     from pg_proc p
--    where pronamespace = 'public'::regnamespace
--      and proname in ('proyectar_modulos', 'workspace_modulos_guardas');
--     -> proyectar_modulos con provolatile = 's'; anon y authenticated false en las dos
--   select count(*) from public.workspace_modulos;   -> 0
-- ============================================================

-- ── 1. workspace_modulos ─────────────────────────────────────────────────────

-- server-only: la escriben la carga inicial (SQL de operación) y, desde A2, el servidor con
-- service_role al registrar un servicio contratado. Ningún usuario la lee de frente: el cliente
-- verá sus módulos por la RPC `mis_servicios()` de A3, con campos cerrados.
create table public.workspace_modulos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),

  -- Llave de módulo de `workspaces.modules` (no el id del catálogo): es exactamente la llave
  -- que la proyección escribe, así que la base no necesita un mapa. La lista sale de
  -- `CLAVES_DE_MODULO` en `src/lib/modulos/catalogo.ts`, y `catalogo.test.ts` lee ESTE
  -- archivo y falla si se separan. Las llaves de función (`conciliacion`, `fab_*`, …) no
  -- entran: esas no se activan por contrato, se configuran.
  modulo text not null
    constraint workspace_modulos_modulo check
      (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr')),

  origen text not null
    constraint workspace_modulos_origen check
      (origen in ('servicio', 'incluido_en_proyecto', 'cortesia', 'interno', 'demo')),

  -- El servicio contratado que lo cubre. La spec pide que `servicio` e `incluido_en_proyecto`
  -- lo traigan siempre, pero `servicios_contratados` no existe hasta A2 y sus filas hasta A3:
  -- exigirlo hoy haría imposible la carga inicial. Queda la mitad que sí se puede cumplir ya
  -- (una fila de cortesía, interna o demo nunca apunta a un servicio). A3 llena la columna en
  -- las filas de la carga, le pone la llave foránea y completa el CHECK en las dos direcciones.
  servicio_contratado_id uuid,

  activo_desde timestamptz not null,
  activo_hasta timestamptz,
  -- Por qué, en palabras. "Contrato A1 26 3", "demo de la reunión propymes", no un código.
  motivo text not null
    constraint workspace_modulos_motivo_no_vacio check (length(btrim(motivo)) > 0),
  registrado_por uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),

  constraint workspace_modulos_vigencia check (activo_hasta is null or activo_hasta > activo_desde),
  constraint workspace_modulos_servicio_solo_si_contratado check
    (servicio_contratado_id is null or origen in ('servicio', 'incluido_en_proyecto'))
);

alter table public.workspace_modulos enable row level security;

-- Sin políticas: con RLS activo y sin grants, solo service_role la alcanza. El default de la base
-- ya no concede nada a una tabla nueva (20260810120200); el revoke se escribe igual, con nombre,
-- para que la intención quede en el archivo y no dependa del default.
revoke all on table public.workspace_modulos from public, anon, authenticated;

create index idx_workspace_modulos_workspace on public.workspace_modulos (workspace_id);

comment on table public.workspace_modulos is
  'Activación de un módulo en un workspace, con origen, motivo y vigencia. La historia no se reescribe: una activación se cierra con activo_hasta y un cambio es otra fila.';

-- ── Guardas de historia ──────────────────────────────────────────────────────
-- "Con historia" quiere decir que lo que se registró no se reescribe, incluido un UPDATE a mano:
--   (a) una fila no se borra: una activación que terminó se cierra con `activo_hasta`;
--   (b) de una fila solo cambian dos cosas, y una sola vez cada una: `activo_hasta` (de null a
--       una fecha, para cerrarla) y `servicio_contratado_id` (de null a un id, el relleno de A3).
--       Todo lo demás —módulo, workspace, origen, motivo, desde cuándo, quién— queda como se
--       escribió. Corregir un error es cerrar la fila y abrir otra.
create or replace function public.workspace_modulos_guardas()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'workspace_modulos %: la historia de activaciones no se borra; ciérrala con activo_hasta',
      old.id;
  end if;

  if new.id                  is distinct from old.id
  or new.workspace_id        is distinct from old.workspace_id
  or new.modulo              is distinct from old.modulo
  or new.origen              is distinct from old.origen
  or new.activo_desde        is distinct from old.activo_desde
  or new.motivo              is distinct from old.motivo
  or new.registrado_por      is distinct from old.registrado_por
  or new.created_at          is distinct from old.created_at then
    raise exception 'workspace_modulos %: una activación registrada no se reescribe; ciérrala y crea otra fila',
      old.id;
  end if;

  if old.activo_hasta is not null and new.activo_hasta is distinct from old.activo_hasta then
    raise exception 'workspace_modulos %: ya está cerrada desde %; reabrir es crear otra fila',
      old.id, old.activo_hasta;
  end if;

  if old.servicio_contratado_id is not null
     and new.servicio_contratado_id is distinct from old.servicio_contratado_id then
    raise exception 'workspace_modulos %: ya apunta al servicio contratado %; no se cambia',
      old.id, old.servicio_contratado_id;
  end if;

  return new;
end;
$$;

create trigger trg_workspace_modulos_guardas
  before update or delete on public.workspace_modulos
  for each row execute function public.workspace_modulos_guardas();

-- PostgreSQL no exige EXECUTE para DISPARAR un trigger, solo para crearlo: el revoke no la apaga.
revoke execute on function public.workspace_modulos_guardas() from public, anon, authenticated;

-- ── 2. proyectar_modulos (solo ensayo) ───────────────────────────────────────
-- Recalcula las llaves de MÓDULO de `workspaces.modules` desde las filas vigentes de
-- `workspace_modulos` y conserva tal cual las llaves de FUNCIÓN. Devuelve:
--   { workspace_id, hoy, proyectado, cambios: [{ modulo, hoy, proyectado }] }
-- donde `cambios` lista solo las llaves de módulo cuyo valor EFECTIVO cambiaría (encendida o
-- apagada). Una llave de módulo guardada en `false` que la proyección quitara no es un cambio:
-- para la app ausente y `false` son lo mismo.
--
-- Uso del ensayo (solo lectura), sobre todos los workspaces:
--   select w.slug, p.r->'cambios'
--     from public.workspaces w
--     cross join lateral (select public.proyectar_modulos(w.id) as r) p
--    where jsonb_array_length(p.r->'cambios') > 0;
--   -> 0 filas es la condición para encender la proyección.
--
-- La lista de llaves de módulo es la misma del CHECK de arriba; `catalogo.test.ts` compara las
-- dos contra el catálogo.
create or replace function public.proyectar_modulos(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claves_modulo constant text[] :=
    array['business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr'];
  v_hoy jsonb;
  v_vigentes text[];
  v_proyectado jsonb;
  v_cambios jsonb;
begin
  select coalesce(w.modules, '{}'::jsonb)
    into v_hoy
    from public.workspaces w
   where w.id = p_workspace_id;

  if not found then
    raise exception 'proyectar_modulos: el workspace % no existe', p_workspace_id;
  end if;

  select coalesce(array_agg(distinct wm.modulo), '{}')
    into v_vigentes
    from public.workspace_modulos wm
   where wm.workspace_id = p_workspace_id
     and wm.activo_desde <= now()
     and (wm.activo_hasta is null or wm.activo_hasta > now());

  -- Llaves de función: tal cual. Llaves de módulo: solo las vigentes, en `true`.
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_proyectado
    from jsonb_each(v_hoy) e
   where e.key <> all (v_claves_modulo);

  v_proyectado := v_proyectado
    || coalesce((select jsonb_object_agg(m, true) from unnest(v_vigentes) m), '{}'::jsonb);

  -- `= 'true'::jsonb` y no un cast a boolean: un valor raro en la llave (una cadena) no puede
  -- tumbar el ensayo, y la app solo trata como encendido el booleano `true`.
  select coalesce(jsonb_agg(jsonb_build_object(
           'modulo', c,
           'hoy', coalesce(v_hoy -> c = 'true'::jsonb, false),
           'proyectado', c = any (v_vigentes)
         ) order by c), '[]'::jsonb)
    into v_cambios
    from unnest(v_claves_modulo) c
   where coalesce(v_hoy -> c = 'true'::jsonb, false) is distinct from (c = any (v_vigentes));

  return jsonb_build_object(
    'workspace_id', p_workspace_id,
    'hoy', v_hoy,
    'proyectado', v_proyectado,
    'cambios', v_cambios
  );
end;
$$;

-- server-only: la corren el ensayo de operación y, al encenderla, el cron con service_role.
revoke execute on function public.proyectar_modulos(uuid) from public, anon, authenticated;
