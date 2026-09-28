-- ============================================================
-- 20260928180000 — Módulo Radar SECOP (licencia propia; primer cliente: Fabri)
-- Spec: proyectos/metrik/one/2026-09-28_spec-radar-secop-en-one.md, bloques D y E.
--
-- Qué crea:
--   1. La llave de módulo `radar_secop` en las TRES listas que repiten el catálogo
--      (`workspace_modulos_modulo`, `catalogo_servicios_modulo` y `proyectar_modulos`).
--      `src/lib/modulos/catalogo.test.ts` lee este archivo y falla si se separan.
--   2. Cuatro tablas:
--        radar_procesos     — GLOBAL, sin workspace_id: el dato es público (SECOP II, dataset
--                             p6dx-8zbt de datos.gov.co) y compartido. Clave natural `notice_uid`.
--        radar_perfiles     — POR WORKSPACE: qué temas mira el cliente, con qué pesos y qué
--                             excluye. Es lo que hoy vive en `localStorage` y se pierde al
--                             cambiar de navegador.
--        radar_temas        — POR WORKSPACE: los temas PROPIOS de un perfil (la biblioteca de
--                             fábrica, 97 temas, vive en `src/lib/radar/biblioteca.json`).
--        radar_seguimiento  — POR WORKSPACE: los procesos que el cliente sigue u oculta.
--
-- ⚠️ DDL puro: ni una fila de datos, y NINGÚN workspace queda con el módulo encendido. A
-- diferencia de la migración del módulo Ferretería, aquí no hay activación: el workspace de Fabri
-- todavía no existe y su contrato depende del NIT de la empresa y del correo de Alex Contreras
-- (bloque F de la spec, el mismo prerrequisito que apareció con los cuatro CDA el 2026-09-15).
-- Encender el módulo es una migración aparte, cuando la empresa exista.
--
-- Por qué `radar_procesos` es legible por `authenticated` sin acotar por workspace: es la copia
-- de un dataset abierto del Estado. Acotarla por workspace obligaría a una copia del barrido por
-- cliente (1.908 filas × clientes) para no ocultar nada, y no hay nada que ocultar. Lo que SÍ es
-- por workspace, y por eso tiene RLS, es lo que el cliente decidió mirar y seguir.
--
-- Verificación después de aplicar (solo lectura):
--   select relname, relrowsecurity from pg_class
--    where relnamespace = 'public'::regnamespace and relname like 'radar\_%';
--     -> 4 filas, todas con relrowsecurity = true
--   select t.relname,
--          has_table_privilege('anon', t.oid, 'select')          as anon_sel,
--          has_table_privilege('authenticated', t.oid, 'select') as auth_sel,
--          has_table_privilege('authenticated', t.oid, 'update') as auth_upd
--     from pg_class t
--    where t.relnamespace = 'public'::regnamespace and t.relname like 'radar\_%';
--     -> anon_sel false en las 4; auth_sel true en las 4;
--        auth_upd true en radar_perfiles/radar_temas/radar_seguimiento y FALSE en radar_procesos
--   select count(*) from public.radar_procesos;                            -> 0
--   select count(*) from public.workspace_modulos where modulo = 'radar_secop';  -> 0
--   select count(*) from public.workspaces where coalesce(modules->'radar_secop' = 'true'::jsonb, false); -> 0
--
-- Cómo revertir (nada la usa todavía):
--   drop table public.radar_seguimiento, public.radar_temas, public.radar_perfiles, public.radar_procesos;
--   -- y devolver las tres listas de llaves al cuerpo de 20260924235500_modulo_ferreteria.sql
-- ============================================================


-- ── 1. La llave de módulo nueva en las tres listas ───────────────────────────

alter table public.workspace_modulos drop constraint workspace_modulos_modulo;
alter table public.workspace_modulos add constraint workspace_modulos_modulo check (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop'));

alter table public.catalogo_servicios drop constraint catalogo_servicios_modulo;
alter table public.catalogo_servicios add constraint catalogo_servicios_modulo check (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop'));

-- Mismo cuerpo que `20260924235500_modulo_ferreteria.sql`; solo cambia el arreglo de llaves.
-- Sigue siendo `stable` (solo ensayo): encenderla es otra migración.
create or replace function public.proyectar_modulos(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_claves_modulo constant text[] :=
    array['business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop'];
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

  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    into v_proyectado
    from jsonb_each(v_hoy) e
   where e.key <> all (v_claves_modulo);

  v_proyectado := v_proyectado
    || coalesce((select jsonb_object_agg(m, true) from unnest(v_vigentes) m), '{}'::jsonb);

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


-- ── 2. Los procesos: una sola copia para todos ───────────────────────────────

-- La escribe SOLO el cron `/api/crons/radar-secop-sync` con service_role (por eso no hay grant de
-- escritura). La lee cualquier sesión: es un dataset abierto del Estado, ver la cabecera.
create table public.radar_procesos (
  -- `id_del_proceso` del dataset. Es la clave natural y la de idempotencia del upsert: el
  -- dataset repite la MISMA fila por cada fase del proceso (2.075 filas → 1.908 procesos el
  -- 2026-09-28), y sin esto los conteos se inflan.
  notice_uid text primary key
    constraint radar_procesos_uid_no_vacio check (notice_uid = btrim(notice_uid) and length(notice_uid) > 0),

  -- La referencia que publica la entidad. NO es única y NO sirve como clave: viene con la fase
  -- pegada ('SDP-LP-003-2026 (Presentación de oferta)') y cambia sola de un barrido al otro.
  referencia text not null default '',
  entidad text not null default '',
  departamento text not null default 'No especificado',
  ciudad text,
  modalidad text not null default '',
  tipo_contrato text not null default 'No especificado',

  -- El objeto, recortado a 600: es lo que el puntaje lee y lo que la pantalla muestra.
  objeto text not null default ''
    constraint radar_procesos_objeto_largo check (length(objeto) <= 600),

  -- Precio base. 0 = sin presupuesto publicado, que es un sondeo (un RFI), no un dato faltante.
  valor numeric(18, 2) not null default 0
    constraint radar_procesos_valor_no_negativo check (valor >= 0),

  fecha_publicacion date,
  -- Cierre de recepción de ofertas. Es el reloj del Radar: la pantalla ordena por «vence en».
  fecha_cierre date,
  duracion text,
  url text,

  -- Derivadas de la modalidad y del tipo de contrato al barrer, con las listas de la biblioteca
  -- (`sin_rup`, `tipos_compra`). Se guardan para poder filtrar por índice sin repetir la lista
  -- de modalidades en cada consulta.
  sin_rup boolean not null default false,
  es_compra boolean not null default false,

  -- Cuándo lo vio el barrido por primera y por última vez. `visto_at` es lo que permite saber
  -- que un proceso desapareció del dataset sin tener que borrarlo.
  creado_at timestamptz not null default now(),
  visto_at timestamptz not null default now()
);

comment on table public.radar_procesos is
  'Procesos de SECOP II con recepción de ofertas abierta. GLOBAL (dato público, dataset p6dx-8zbt). La escribe solo el cron radar-secop-sync.';
comment on column public.radar_procesos.notice_uid is
  'id_del_proceso del dataset. Clave de idempotencia del upsert: el dataset repite la fila por fase.';

-- La pantalla ordena por «vence en» y filtra por región y por tipo de contrato.
create index idx_radar_procesos_cierre on public.radar_procesos (fecha_cierre);
create index idx_radar_procesos_departamento on public.radar_procesos (departamento);


-- ── 3. Perfiles: lo que cada cliente decidió mirar ──────────────────────────

-- Un mapa { id_de_tema: peso } con TODOS los valores numéricos. Es una función y no una expresión
-- dentro del CHECK porque **PostgreSQL no admite subconsultas en un CHECK**: la primera versión de
-- esta migración llevaba un `not exists (select 1 from jsonb_each(pesos) …)` y la base la rechazó
-- con «cannot use subquery in check constraint». Lo encontró la prueba de PGlite, no la lectura
-- del SQL — igual que `comision_coherente` en A2, que es el patrón que esto sigue.
--
-- ⚠️ Cada comparación va envuelta en `coalesce(..., false)`, y no es adorno: **un CHECK solo
-- rechaza cuando la expresión da FALSE; si da NULL, DEJA PASAR.** Con `{"acrilico": null}` el
-- `jsonb_typeof` de ese valor es la cadena 'null' (no SQL NULL), pero el `bool_and` de un mapa
-- vacío es NULL, y sin el coalesce exterior el CHECK aceptaría cualquier cosa en cuanto la
-- comparación se volviera indefinida. Misma familia que «un valor ausente nunca autoriza».
create or replace function public.radar_pesos_coherentes(p jsonb)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    case
      when p is null then false
      when jsonb_typeof(p) <> 'object' then false
      -- Un mapa vacío es válido: el perfil no ajustó ningún peso.
      when p = '{}'::jsonb then true
      else coalesce(
        (select bool_and(coalesce(jsonb_typeof(e.value) = 'number', false)) from jsonb_each(p) e),
        false
      )
    end,
    false
  );
$$;

revoke execute on function public.radar_pesos_coherentes(jsonb) from public, anon, authenticated;

comment on function public.radar_pesos_coherentes(jsonb) is
  'Espeja el tipo de radar_perfiles.pesos en src/lib/radar/biblioteca.ts: { id_de_tema: numero }. Un peso no numérico haría que puntuar() sumara NaN.';

create table public.radar_perfiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  nombre text not null
    constraint radar_perfiles_nombre_no_vacio check (length(btrim(nombre)) > 0),

  -- De qué perfil de fábrica nació (`metrik`, `fabri`, `mobiliario`, …, `vacio`). Se guarda para
  -- poder decir «este perfil salió de X» y para recalibrar cuando la biblioteca cambie. NO se
  -- valida contra una lista aquí: los presets viven en `src/lib/radar/biblioteca.json` y un CHECK
  -- con la lista copiada se desincronizaría en el primer preset nuevo.
  preset text not null default 'vacio',

  -- Los ids de tema seleccionados. Un id que no exista (ni en la biblioteca ni en radar_temas) se
  -- ignora al puntuar: `temasActivos` filtra por existencia.
  temas_sel text[] not null default '{}',

  -- Peso que pisa el de fábrica, por id de tema: { "acrilico": 10, "audiovisual": -8 }.
  -- Lo valida `radar_pesos_coherentes`; ver su cabecera para el porqué de la función.
  pesos jsonb not null default '{}'::jsonb
    constraint radar_perfiles_pesos check (public.radar_pesos_coherentes(pesos)),

  -- Exclusiones del PERFIL, no del sistema: lo que para MeTRIK es ruido (OBRA, ASEO, VIAL) para
  -- una constructora es su negocio. Lista plana de texto; `exclusionesDeLista` la vuelve a partir
  -- en stems (substring) y palabras (palabra completa) al aplicarla.
  exclusiones text[] not null default '{}',

  -- El perfil que la pantalla abre. Uno por workspace, y lo hace cumplir el índice de abajo.
  activo boolean not null default false,

  creado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radar_perfiles_nombre_unico unique (workspace_id, nombre)
);

comment on table public.radar_perfiles is
  'Qué temas mira un workspace en el Radar, con qué pesos y qué excluye. Reemplaza el localStorage del dashboard empaquetado.';

-- Dos perfiles activos dejarían a la pantalla eligiendo uno por orden de llegada, que es un
-- puntaje distinto cada vez que se recarga.
create unique index uq_radar_perfiles_activo
  on public.radar_perfiles (workspace_id) where activo;


-- ── 4. Temas propios del cliente ────────────────────────────────────────────

create table public.radar_temas (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  perfil_id uuid not null references public.radar_perfiles(id) on delete cascade,

  -- El id con el que el tema entra al puntaje. Si coincide con uno de la biblioteca, LO PISA:
  -- así un cliente recalibra los términos de un tema de fábrica sin que nadie edite el JSON.
  tema_id text not null
    constraint radar_temas_id_kebab check (tema_id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  nombre text not null
    constraint radar_temas_nombre_no_vacio check (length(btrim(nombre)) > 0),
  -- Grupo del catálogo. `compra` es el único cuyo castigo se topa con señal fuerte, así que
  -- ponerlo o no cambia el puntaje: es una decisión, no una etiqueta.
  grupo text not null default 'propio',
  peso integer not null
    constraint radar_temas_peso_rango check (peso between -20 and 20),

  -- Los sinónimos. Un tema suma UNA sola vez aunque el objeto repita varios de ellos.
  --
  -- ⚠️ El `coalesce` NO es adorno: `array_length('{}', 1)` es **NULL**, no 0, así que
  -- `array_length(terminos, 1) >= 1` da NULL con el arreglo vacío y el CHECK LO DEJA PASAR. Un
  -- tema sin términos no cruza nunca con nada: sería un tema que el cliente ve seleccionado y que
  -- no suma jamás. Lo encontró la prueba de PGlite con el arreglo vacío, no la lectura del SQL.
  terminos text[] not null
    constraint radar_temas_terminos_no_vacio check (coalesce(array_length(terminos, 1), 0) >= 1),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint radar_temas_unico_por_perfil unique (perfil_id, tema_id)
);

comment on table public.radar_temas is
  'Temas PROPIOS de un perfil. La biblioteca de fábrica (97 temas) vive en src/lib/radar/biblioteca.json, no aquí.';


-- ── 5. Seguimiento: lo que el cliente sigue u oculta ────────────────────────

create table public.radar_seguimiento (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  perfil_id uuid not null references public.radar_perfiles(id) on delete cascade,

  -- Sin FK a `radar_procesos`: un proceso que el cliente sigue puede salir del dataset (cerró) y
  -- la marca tiene que sobrevivir a eso. Borrarla al desaparecer el proceso le borraría al cliente
  -- la razón por la que lo estaba mirando.
  notice_uid text not null
    constraint radar_seguimiento_uid_no_vacio check (length(btrim(notice_uid)) > 0),

  estado text not null
    constraint radar_seguimiento_estado check (estado in ('sigue', 'oculto')),
  nota text,

  marcado_por uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Un proceso está seguido u oculto, no las dos cosas: el upsert cambia el estado de la fila.
  constraint radar_seguimiento_unico unique (perfil_id, notice_uid)
);

comment on table public.radar_seguimiento is
  'Procesos que un perfil sigue u oculta. Sin FK a radar_procesos: la marca sobrevive a que el proceso salga del dataset.';

create index idx_radar_seguimiento_perfil on public.radar_seguimiento (perfil_id, estado);


-- ── 6. RLS y grants ─────────────────────────────────────────────────────────

alter table public.radar_procesos enable row level security;
alter table public.radar_perfiles enable row level security;
alter table public.radar_temas enable row level security;
alter table public.radar_seguimiento enable row level security;

-- publico-deliberado: `radar_procesos` es la copia de un dataset abierto del Estado (SECOP II,
-- p6dx-8zbt). Cualquier sesión de ONE lo lee; quién ENTRA al Radar lo decide el módulo
-- `radar_secop` en el menú y en el middleware, no el RLS de esta tabla. Nada de `anon`: para eso
-- está el dataset original. Y nadie escribe con `authenticated`: la escribe el cron.
create policy radar_procesos_lectura on public.radar_procesos
  for select using (true);

-- Lo que el cliente decidió mirar y seguir SÍ es suyo: lectura y escritura acotadas a su
-- workspace, porque estas tres las escribe la pantalla con el cliente `authenticated`.
create policy radar_perfiles_lectura on public.radar_perfiles
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy radar_perfiles_inserta on public.radar_perfiles
  for insert with check (workspace_id = (select public.current_user_workspace_id()));
create policy radar_perfiles_actualiza on public.radar_perfiles
  for update using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
create policy radar_perfiles_borra on public.radar_perfiles
  for delete using (workspace_id = (select public.current_user_workspace_id()));

create policy radar_temas_lectura on public.radar_temas
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy radar_temas_inserta on public.radar_temas
  for insert with check (workspace_id = (select public.current_user_workspace_id()));
create policy radar_temas_actualiza on public.radar_temas
  for update using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
create policy radar_temas_borra on public.radar_temas
  for delete using (workspace_id = (select public.current_user_workspace_id()));

create policy radar_seguimiento_lectura on public.radar_seguimiento
  for select using (workspace_id = (select public.current_user_workspace_id()));
create policy radar_seguimiento_inserta on public.radar_seguimiento
  for insert with check (workspace_id = (select public.current_user_workspace_id()));
create policy radar_seguimiento_actualiza on public.radar_seguimiento
  for update using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
create policy radar_seguimiento_borra on public.radar_seguimiento
  for delete using (workspace_id = (select public.current_user_workspace_id()));

revoke all on table public.radar_procesos from public, anon, authenticated;
revoke all on table public.radar_perfiles from public, anon, authenticated;
revoke all on table public.radar_temas from public, anon, authenticated;
revoke all on table public.radar_seguimiento from public, anon, authenticated;

-- El barrido se lee, nunca se escribe desde el navegador.
grant select on public.radar_procesos to authenticated;

grant select, insert, update, delete on public.radar_perfiles to authenticated;
grant select, insert, update, delete on public.radar_temas to authenticated;
grant select, insert, update, delete on public.radar_seguimiento to authenticated;
