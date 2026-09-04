-- Compliance — base de sujetos de debida diligencia
--
-- Cierra la deuda que dejó anotada la migración de liberaciones (R4):
-- "ONE todavía no tiene entidad contraparte. No se inventa aquí: se denormaliza
-- la identidad y queda anotado que la entidad propia es el paso natural cuando
-- llegue el monitoreo recurrente (R3)". R3 ya está, y sin esta tabla el módulo
-- solo sabe de una contraparte lo que quedó escrito el día que alguien la
-- consultó. Nadie puede abrir una lista y ver a quién tiene vinculado.
--
-- ── Empleados y terceros en la misma tabla, y por qué ─────────────────────
--
-- Para la debida diligencia el empleado ES un sujeto: se consulta igual, se
-- decide igual y se revalida igual. Separarlos en dos tablas obligaría a
-- duplicar la consulta, la liberación y la periodicidad. Lo que cambia es el
-- `tipo`, no el tratamiento.
--
-- Los empleados NO se digitan: `staff_id` los amarra a la ficha que ya existe.
-- Si se tecleara aparte, la misma persona quedaría dos veces con dos estados
-- distintos y ninguno de los dos sería el bueno.
--
-- ── El estado de cumplimiento NO es una columna ───────────────────────────
--
-- Habilitado / en seguimiento / vencido / inhabilitado se DERIVAN de la
-- liberación vigente (`coberturaDeContraparte`) más la periodicidad adoptada.
-- Si fueran un campo que alguien marca a mano habría dos verdades, y la que se
-- desactualiza siempre es la de la pantalla: un vencido seguiría exhibiéndose
-- como habilitado hasta que alguien se acordara de tocarlo. Justo el caso que
-- este módulo existe para cazar.
--
-- ── Dos ejes que no comparten botón ───────────────────────────────────────
--
-- "Ya no trabaja con nosotros" es un hecho operativo y lo sabe el ejecutor.
-- "Está inhabilitado" es una decisión de cumplimiento y es del oficial.
--
-- Por eso el cierre de relación vive acá (`relacion_hasta` + motivo obligatorio)
-- y la inhabilitación sigue viviendo en `compliance_liberaciones`, donde solo
-- escribe el oficial. Sin esa separación, el ejecutor al que le salió un
-- hallazgo incómodo lo saca del tablero y nadie se entera.
--
-- Cerrar NO borra ni oculta: la fila queda, el historial queda, y el evento
-- dice quién lo cerró y por qué. En auditoría hay que poder responder qué
-- estado tenía ese proveedor el día que se le firmó.

-- =============================================================================
-- 1. Los sujetos
-- =============================================================================

create table if not exists compliance_sujetos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,

  tipo text not null check (tipo in (
    'empleado', 'proveedor', 'contratista', 'cliente', 'socio', 'otro')),

  -- Identidad canónica. El trigger de abajo la normaliza ANTES de que el unique
  -- la mire, para que "900.123.456-7" y "9001234567" no sean dos sujetos.
  documento_tipo text not null,
  documento_numero text not null,
  nombre text not null,

  -- Empleados: la ficha de personal manda. `set null` y no `cascade` porque
  -- borrar a alguien de la nómina no puede borrar la evidencia de que se le
  -- hizo debida diligencia mientras estuvo.
  staff_id uuid references staff(id) on delete set null,

  -- Con qué segmento se consulta. De él cuelga la periodicidad de revalidación.
  segmento_id uuid references compliance_segmentos(id) on delete set null,

  -- Quién lo gestiona en el día a día. Es el ejecutor, no el oficial.
  responsable_profile_id uuid references profiles(id) on delete set null,

  -- ── Relación (eje operativo) ──
  relacion_desde date not null default current_date,
  -- NULL = la relación está viva. Con fecha = cerrada, hacia adelante.
  relacion_hasta date,
  motivo_cierre text,
  cerrado_por uuid references profiles(id) on delete set null,
  cerrado_at timestamptz,

  notas text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint compliance_sujetos_documento_no_vacio
    check (btrim(documento_tipo) <> '' and btrim(documento_numero) <> ''),

  constraint compliance_sujetos_nombre_util
    check (length(btrim(nombre)) between 2 and 200),

  constraint compliance_sujetos_relacion_ordenada
    check (relacion_hasta is null or relacion_hasta >= relacion_desde),

  -- Cerrar sin decir por qué deja el tablero limpio y la auditoría ciega.
  -- El motivo es texto libre a propósito: "terminó contrato", "no se le volvió
  -- a comprar", "renunció" no son un catálogo que podamos cerrar desde acá.
  constraint compliance_sujetos_cierre_motivado
    check (
      (relacion_hasta is null and motivo_cierre is null)
      or (relacion_hasta is not null and btrim(coalesce(motivo_cierre, '')) <> '')
    ),

  -- La identidad es única por workspace. Es lo que permite que la liberación,
  -- la consulta y el sujeto hablen de la misma persona.
  unique (workspace_id, documento_tipo, documento_numero)
);

-- Un empleado, un sujeto. Parcial porque la enorme mayoría de sujetos no es
-- personal propio y `staff_id` queda null en todos ellos.
create unique index if not exists idx_compliance_sujetos_staff
  on compliance_sujetos(workspace_id, staff_id)
  where staff_id is not null;

-- La pantalla: los sujetos del workspace, los vivos primero.
create index if not exists idx_compliance_sujetos_workspace
  on compliance_sujetos(workspace_id, relacion_hasta, nombre);

-- El cruce contra la bitácora de liberaciones y contra las consultas.
create index if not exists idx_compliance_sujetos_documento
  on compliance_sujetos(workspace_id, documento_tipo, documento_numero);

comment on table compliance_sujetos is
  'Base de sujetos de debida diligencia: empleados y terceros, misma tabla porque el tratamiento es el mismo. El estado de cumplimiento NO vive acá — se deriva de compliance_liberaciones (ver estadoSujeto en src/lib/compliance/sujetos.ts).';
comment on column compliance_sujetos.relacion_hasta is
  'Cierre de la RELACIÓN, no inhabilitación. Lo registra el ejecutor con motivo obligatorio y no borra nada. Inhabilitar es decisión del oficial y vive en compliance_liberaciones.';
comment on column compliance_sujetos.staff_id is
  'Empleados: amarre a la ficha de personal. Existe para que la misma persona no quede dos veces con dos estados distintos.';
comment on column compliance_sujetos.documento_numero is
  'Normalizado por trigger (sin puntos, guiones ni espacios, en mayúsculas) para que coincida con claveContraparte de src/lib/compliance/liberaciones.ts.';

-- =============================================================================
-- 2. Identidad normalizada en la base, no solo en la aplicación
-- =============================================================================

-- Misma regla que `partesContraparte` en TypeScript. Vive también acá porque el
-- unique de arriba compara lo que hay en la fila: si la normalización dependiera
-- de que quien inserta se acordó de llamarla, un script o un import dejarían
-- duplicados que ninguna liberación cubre, en silencio.
create or replace function tg_compliance_sujetos_normalizar()
returns trigger language plpgsql as $$
begin
  new.documento_tipo := upper(btrim(new.documento_tipo));
  new.documento_numero := upper(regexp_replace(new.documento_numero, '[[:space:]._-]', '', 'g'));
  new.nombre := btrim(new.nombre);
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.tg_compliance_sujetos_normalizar() from public, anon, authenticated;

drop trigger if exists trg_compliance_sujetos_normalizar on compliance_sujetos;
create trigger trg_compliance_sujetos_normalizar
  before insert or update on compliance_sujetos
  for each row
  execute function tg_compliance_sujetos_normalizar();

-- =============================================================================
-- 3. Bitácora de eventos del sujeto
-- =============================================================================

-- Qué le pasó a esta ficha y quién lo hizo. Append-only por la misma razón que
-- las liberaciones: si se puede reescribir, no prueba nada.
create table if not exists compliance_sujeto_eventos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  sujeto_id uuid not null references compliance_sujetos(id) on delete cascade,

  evento text not null check (evento in (
    'alta', 'cierre_relacion', 'reapertura', 'cambio_tipo',
    'cambio_responsable', 'cambio_segmento', 'cambio_datos')),

  -- Qué cambió, en texto legible por un auditor que no conoce el esquema.
  detalle text,
  -- Por qué. Obligatorio en los eventos que cambian el alcance de la relación.
  motivo text,

  actor uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),

  constraint compliance_sujeto_eventos_cierre_motivado
    check (evento <> 'cierre_relacion' or btrim(coalesce(motivo, '')) <> '')
);

create index if not exists idx_compliance_sujeto_eventos_sujeto
  on compliance_sujeto_eventos(sujeto_id, created_at desc);

comment on table compliance_sujeto_eventos is
  'Bitácora APPEND-ONLY de la ficha del sujeto: alta, cierre de relación, reapertura y cambios. Responde "quién sacó a este proveedor del tablero y por qué".';

create or replace function compliance_sujeto_eventos_append_only()
returns trigger language plpgsql as $$
begin
  raise exception
    'compliance_sujeto_eventos es append-only: % no está permitido.', tg_op
    using errcode = 'restrict_violation';
end;
$$;

revoke execute on function public.compliance_sujeto_eventos_append_only() from public, anon, authenticated;

drop trigger if exists trg_compliance_sujeto_eventos_append_only on compliance_sujeto_eventos;
create trigger trg_compliance_sujeto_eventos_append_only
  before update or delete on compliance_sujeto_eventos
  for each row
  execute function compliance_sujeto_eventos_append_only();

-- =============================================================================
-- 4. "Aprobado en seguimiento" — una liberación condicionada
-- =============================================================================

-- El cuadro que pidió Mauricio tiene tres casillas y una de ellas no es ni sí ni
-- no: "aprobado, pero mirándolo". Hoy la bitácora solo sabe liberar o rechazar.
--
-- Es una columna de la DECISIÓN y no del sujeto: el mismo proveedor puede estar
-- liberado limpio hoy y liberado bajo seguimiento en la próxima revalidación, y
-- lo que hay que poder reconstruir es bajo qué condición se le contrató ESE día.
alter table compliance_liberaciones
  add column if not exists seguimiento boolean not null default false;

comment on column compliance_liberaciones.seguimiento is
  'Liberación condicionada: habilita, pero el sujeto queda bajo observación. Es "aprobado en seguimiento" del tablero. Un rechazo nunca la trae.';

-- Un rechazo no se sigue: se rechaza. Sin este check, "rechazada + seguimiento"
-- sería una fila que el tablero no sabría pintar.
alter table compliance_liberaciones
  drop constraint if exists compliance_liberaciones_seguimiento_solo_liberada;
alter table compliance_liberaciones
  add constraint compliance_liberaciones_seguimiento_solo_liberada
  check (decision = 'liberada' or seguimiento = false);

-- =============================================================================
-- 5. Acceso
-- =============================================================================

-- server-only: la lista de sujetos nombra personas con su documento de
-- identidad, y el ejecutor la ve filtrada y sin fundamento de hallazgo. Esa
-- diferencia la impone la server action (compliance-sujetos.ts), no el
-- navegador. Si el cliente autenticado pudiera leer la tabla, el recorte sería
-- decorativo. Mismo criterio que compliance_liberaciones.
alter table compliance_sujetos enable row level security;
alter table compliance_sujeto_eventos enable row level security;

-- Red por si mañana alguien la lee con el cliente de sesión: sin esta policy,
-- ese día se leería cross-tenant. No hay policy de escritura a propósito.
drop policy if exists compliance_sujetos_select on compliance_sujetos;
create policy compliance_sujetos_select on compliance_sujetos
  for select using (workspace_id = current_user_workspace_id());

drop policy if exists compliance_sujeto_eventos_select on compliance_sujeto_eventos;
create policy compliance_sujeto_eventos_select on compliance_sujeto_eventos
  for select using (workspace_id = current_user_workspace_id());

-- =============================================================================
-- 6. Alta atómica del sujeto con su evento
-- =============================================================================

-- Crear el sujeto y registrar el alta son dos escrituras de un solo hecho. Si se
-- hicieran por separado y fallara la segunda, quedaría una ficha sin origen: en
-- auditoría, un sujeto que nadie dio de alta.
create or replace function compliance_registrar_evento_sujeto(
  p_workspace_id uuid,
  p_sujeto_id uuid,
  p_evento text,
  p_detalle text,
  p_motivo text,
  p_actor uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_evento_id uuid;
begin
  -- El sujeto tiene que ser de ESTE workspace. Sin esta verificación, un
  -- workspace podría escribir eventos sobre la ficha de otro pasando un id.
  if not exists (
    select 1 from compliance_sujetos
    where id = p_sujeto_id and workspace_id = p_workspace_id
  ) then
    raise exception 'sujeto_no_pertenece_al_workspace'
      using errcode = 'raise_exception';
  end if;

  insert into compliance_sujeto_eventos
    (workspace_id, sujeto_id, evento, detalle, motivo, actor)
  values
    (p_workspace_id, p_sujeto_id, p_evento, p_detalle, p_motivo, p_actor)
  returning id into v_evento_id;

  return v_evento_id;
end;
$$;

revoke execute on function public.compliance_registrar_evento_sujeto(uuid, uuid, text, text, text, uuid)
  from public, anon, authenticated;

-- Cierre de relación: la fecha, el motivo y el evento son un solo hecho.
-- Separarlos permitiría una ficha cerrada sin rastro de quién la cerró, que es
-- exactamente el agujero que esta tabla vino a tapar.
create or replace function compliance_cerrar_relacion_sujeto(
  p_workspace_id uuid,
  p_sujeto_id uuid,
  p_fecha date,
  p_motivo text,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_relacion_desde date;
  v_relacion_hasta date;
begin
  select relacion_desde, relacion_hasta
    into v_relacion_desde, v_relacion_hasta
  from compliance_sujetos
  where id = p_sujeto_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'sujeto_no_pertenece_al_workspace' using errcode = 'raise_exception';
  end if;

  if v_relacion_hasta is not null then
    raise exception 'relacion_ya_cerrada' using errcode = 'raise_exception';
  end if;

  if p_fecha < v_relacion_desde then
    raise exception 'cierre_anterior_al_inicio_de_la_relacion' using errcode = 'raise_exception';
  end if;

  if btrim(coalesce(p_motivo, '')) = '' then
    raise exception 'motivo_de_cierre_obligatorio' using errcode = 'raise_exception';
  end if;

  update compliance_sujetos
     set relacion_hasta = p_fecha,
         motivo_cierre = btrim(p_motivo),
         cerrado_por = p_actor,
         cerrado_at = now()
   where id = p_sujeto_id;

  insert into compliance_sujeto_eventos
    (workspace_id, sujeto_id, evento, detalle, motivo, actor)
  values
    (p_workspace_id, p_sujeto_id, 'cierre_relacion',
     'Relación cerrada el ' || to_char(p_fecha, 'YYYY-MM-DD'), btrim(p_motivo), p_actor);
end;
$$;

revoke execute on function public.compliance_cerrar_relacion_sujeto(uuid, uuid, date, text, uuid)
  from public, anon, authenticated;

-- Reapertura: el proveedor con el que se vuelve a trabajar. NO se crea una ficha
-- nueva (perdería la historia) ni se borra el cierre anterior: se abre otra vez
-- y el evento deja constancia de las dos cosas.
create or replace function compliance_reabrir_relacion_sujeto(
  p_workspace_id uuid,
  p_sujeto_id uuid,
  p_fecha date,
  p_motivo text,
  p_actor uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cerrada date;
begin
  select relacion_hasta into v_cerrada
  from compliance_sujetos
  where id = p_sujeto_id and workspace_id = p_workspace_id
  for update;

  if not found then
    raise exception 'sujeto_no_pertenece_al_workspace' using errcode = 'raise_exception';
  end if;

  if v_cerrada is null then
    raise exception 'relacion_ya_abierta' using errcode = 'raise_exception';
  end if;

  update compliance_sujetos
     set relacion_desde = p_fecha,
         relacion_hasta = null,
         motivo_cierre = null,
         cerrado_por = null,
         cerrado_at = null
   where id = p_sujeto_id;

  insert into compliance_sujeto_eventos
    (workspace_id, sujeto_id, evento, detalle, motivo, actor)
  values
    (p_workspace_id, p_sujeto_id, 'reapertura',
     'Relación reabierta el ' || to_char(p_fecha, 'YYYY-MM-DD')
       || ' (el cierre anterior fue el ' || to_char(v_cerrada, 'YYYY-MM-DD') || ')',
     nullif(btrim(coalesce(p_motivo, '')), ''), p_actor);
end;
$$;

revoke execute on function public.compliance_reabrir_relacion_sujeto(uuid, uuid, date, text, uuid)
  from public, anon, authenticated;
