-- Notificaciones de equipo: le llega a todos, la resuelve cualquiera
--
-- Hasta ahora una notificacion era 1 hecho -> 1 persona. Faltaba el caso en que
-- un hecho le toca a un EQUIPO y basta con que uno lo atienda:
--
--   · Solicitud de conciliacion de pago -> le llega a toda el area financiera
--     (en SOENA: Diana y Leidy). Si una de las dos lo resuelve, el aviso
--     desaparece de la campana de la otra. Sin esto, la que no lo atendio
--     arrastra un pendiente ya resuelto — ruido puro.
--   · Etiquetas de equipo en un comentario (@comercial, @operaciones,
--     @financiera): mismo mecanismo.
--
-- Modelo: las N filas del mismo hecho comparten `grupo_clave`. Resolver una
-- resuelve todas, y queda registrado QUIEN lo hizo (`resuelta_por`), que es lo
-- que permite despues decir "Diana ya lo concilio" en vez de solo borrarlo.

-- ── Columnas ────────────────────────────────────────────────────────────────

alter table public.notificaciones
  add column if not exists grupo_clave text,
  add column if not exists resuelta_por uuid references public.profiles(id) on delete set null;

comment on column public.notificaciones.grupo_clave is
  'Identidad del HECHO que origino el aviso (ej. conciliacion:REF123). Las filas que la comparten son el mismo pendiente visto por varias personas: al resolver una, se resuelven todas.';

comment on column public.notificaciones.resuelta_por is
  'Quien resolvio el pendiente del equipo. NULL en notificaciones personales.';

create index if not exists notificaciones_grupo_clave_idx
  on public.notificaciones (workspace_id, grupo_clave)
  where grupo_clave is not null and estado = 'pendiente';

-- Tipos nuevos que el CHECK debe admitir
alter table public.notificaciones drop constraint if exists notificaciones_tipo_check;
alter table public.notificaciones add constraint notificaciones_tipo_check check (
  tipo = any (array[
    'inactividad_oportunidad', 'handoff', 'asignacion_responsable',
    'asignacion_colaborador', 'mencion', 'streak_roto', 'inactividad_proyecto',
    'proyecto_entregado', 'proyecto_cerrado', 'cobro_vencido', 'cobro_proximo',
    'plan_terminado', 'cuenta_cobro_pendiente_aprobacion', 'cuenta_cobro_enviada',
    'cuenta_cobro_envio_fallo', 'responsable_faltante_area',
    'negocio_cancelado', 'negocio_reabierto', 'negocio_reactivado',
    'conciliacion_solicitada',  -- el comercial propuso un reparto -> lo ve el area financiera
    'mencion_equipo'            -- alguien etiqueto a un area en un comentario
  ])
);

-- ── Crear un aviso para todo un equipo ──────────────────────────────────────

-- Inserta una notificacion por cada miembro del area (sin importar su rol: en
-- SOENA financiera = Diana admin + Leidy supervisor), todas con la misma
-- `grupo_clave`. Excluye al autor: quien pide algo no necesita que se lo avisen.
create or replace function public.crear_notificacion_equipo(
  p_workspace_id uuid,
  p_area text,
  p_tipo text,
  p_contenido text,
  p_grupo_clave text,
  p_entidad_tipo text default null,
  p_entidad_id uuid default null,
  p_deep_link text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_excluir_profile_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer := 0;
begin
  -- Idempotente: si el equipo ya tiene el pendiente abierto, no lo duplica.
  if exists (
    select 1 from notificaciones
    where workspace_id = p_workspace_id
      and grupo_clave = p_grupo_clave
      and estado = 'pendiente'
  ) then
    return 0;
  end if;

  insert into notificaciones (
    workspace_id, destinatario_id, tipo, estado, contenido,
    entidad_tipo, entidad_id, deep_link, metadata, grupo_clave
  )
  select
    p_workspace_id, s.profile_id, p_tipo, 'pendiente', p_contenido,
    p_entidad_tipo, p_entidad_id, p_deep_link, p_metadata, p_grupo_clave
  from staff s
  join staff_areas sa on sa.staff_id = s.id
  where s.workspace_id = p_workspace_id
    and sa.area = p_area
    and s.profile_id is not null
    and (p_excluir_profile_id is null or s.profile_id <> p_excluir_profile_id);

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.crear_notificacion_equipo(uuid, text, text, text, text, text, uuid, text, jsonb, uuid) from anon;

-- ── Resolver el pendiente para TODO el equipo ───────────────────────────────

-- Se llama cuando el hecho deja de estar pendiente (alguien concilio, alguien
-- atendio la etiqueta). Marca completadas todas las filas del grupo y estampa
-- quien lo resolvio.
create or replace function public.resolver_grupo_notificaciones(
  p_workspace_id uuid,
  p_grupo_clave text,
  p_resuelta_por uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_n integer := 0;
begin
  update notificaciones
  set estado = 'completada',
      resuelta_por = coalesce(p_resuelta_por, resuelta_por),
      updated_at = now()
  where workspace_id = p_workspace_id
    and grupo_clave = p_grupo_clave
    and estado = 'pendiente';

  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

revoke execute on function public.resolver_grupo_notificaciones(uuid, text, uuid) from anon;
grant execute on function public.resolver_grupo_notificaciones(uuid, text, uuid) to authenticated;

comment on function public.resolver_grupo_notificaciones(uuid, text, uuid) is
  'Cierra un pendiente de equipo para TODOS sus destinatarios. La atiende uno, desaparece de la campana de los demas.';
