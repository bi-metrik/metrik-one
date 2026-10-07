-- ============================================================
-- 20261007150000 — Términos que se modifican POR AVISO (cláusula 13.1) y la constancia de quién vio el aviso
--
-- Decisión de Mauricio (2026-10-07), dictamen de Emilio: el cambio de los Términos VALIDA · Plan CDA
-- de la v1.3 a la v1.4 (cláusulas 2.5 y 11: restricción de las consultas nuevas a los 5 días de mora)
-- se avisa POR LA PLATAFORMA y los CDA lo aceptan por el mismo medio.
--
-- ## La diferencia que esta migración le enseña a la base
--
-- Hasta hoy una versión de términos era siempre de ENTRADA: se acepta antes de usar el servicio
-- (cláusula 16.3) y, sin aceptación, el módulo no opera. Una modificación de la 13.1 es otra cosa:
-- METRIK la publica con 30 días de anticipación y RIGE desde entonces la acepte o no el Cliente. La
-- versión anterior aceptada sigue valiendo, y no aceptar la nueva NUNCA pausa ni restringe el
-- servicio. El Cliente que no está de acuerdo puede terminar sin penalidad antes de la vigencia.
--
-- Tres columnas nuevas en `documentos_contractuales_versiones` lo declaran:
--
--   · `rige_por_aviso`       — true = modificación de la 13.1. Su aceptación es voluntaria.
--   · `reemplaza_version_id` — la versión que modifica (la v1.3 de esa empresa). Quien la aceptó tiene
--                              la nueva «cubierta»: la puerta del módulo no se la pide (`terminos.ts`).
--   · `publicada_at`         — cuándo se publicó el aviso en la plataforma. Es el dato del que sale la
--                              vigencia: la guarda de abajo exige `vigente_desde` >= publicación + 30
--                              días calendario (hora de Bogotá), el plazo de la 13.1.
--
-- Una versión de entrada (lo de siempre) tiene `rige_por_aviso = false` y las otras dos en null: las 13
-- versiones registradas hoy quedan exactamente como estaban.
--
-- ## Qué más cambia
--
--   1. `aceptaciones_terminos_modulo()`: una versión por aviso ya PUBLICADA se puede aceptar antes de su
--      vigencia (la persona designada acepta la v1.4 desde el 7-oct aunque rija el 6-nov). Todo lo demás
--      del cuerpo de 20260929030000 queda igual, mensajes de error incluidos. Una versión de entrada
--      futura sigue sin poder aceptarse.
--   2. `mis_documentos_de_servicio()`: devuelve las tres columnas nuevas. Cambia su `returns table`, así
--      que va con DROP + CREATE y se repone la ACL (gotcha de `mis_servicios`, 20260924010000).
--   3. `documentos_versiones_inmutables()`: las tres columnas se suman a lo que no se reescribe. Quién
--      reemplaza a quién y cuándo se publicó el aviso son la prueba del preaviso.
--   4. Tabla `avisos_modificacion_vistos`: por versión y por usuario, la PRIMERA vez que el aviso se le
--      mostró en la plataforma (fecha, espacio, IP, navegador). Es la constancia del preaviso por CDA.
--      Solo se inserta (ni UPDATE ni DELETE): la primera vez no se reescribe.
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- Las cuatro v1.4 van aparte (`sql/valida-cda/2026-10-07_terminos-v1.4-por-aviso.sql`) para que las
-- aplique la sesión principal DESPUÉS del deploy: insertar la fila es publicar el aviso.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'documentos_contractuales_versiones'
--      and column_name in ('rige_por_aviso', 'reemplaza_version_id', 'publicada_at');   -> 3 filas
--   select count(*) from public.documentos_contractuales_versiones where rige_por_aviso;     -> 0
--   select relrowsecurity from pg_class where oid = 'public.avisos_modificacion_vistos'::regclass; -> true
--   select has_table_privilege('authenticated', 'public.avisos_modificacion_vistos', 'select'),
--          has_table_privilege('anon', 'public.avisos_modificacion_vistos', 'select');   -> false, false
--   select p.proname, p.prosecdef, p.proconfig, p.proacl from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public'
--      and p.proname in ('mis_documentos_de_servicio', 'aceptaciones_terminos_modulo',
--                        'documentos_versiones_inmutables', 'documentos_versiones_por_aviso',
--                        'avisos_modificacion_vistos_inmutable');
--     -> mis_documentos_de_servicio: prosecdef = true, authenticated=X y SIN anon ni =X/ (PUBLIC)
--     -> las otras cuatro: SIN anon, authenticated ni PUBLIC
--
-- ## Cómo revertir (mientras no haya filas por aviso)
--
--   drop table public.avisos_modificacion_vistos;
--   drop function public.avisos_modificacion_vistos_inmutable();
--   drop trigger trg_documentos_versiones_por_aviso on public.documentos_contractuales_versiones;
--   drop function public.documentos_versiones_por_aviso();
--   -- re-crear las tres funciones con los cuerpos de 20260929030000
--   alter table public.documentos_contractuales_versiones
--     drop constraint documentos_versiones_aviso_coherente,
--     drop column rige_por_aviso, drop column reemplaza_version_id, drop column publicada_at;
-- ============================================================


-- ── 1. Las columnas de una modificación por aviso ───────────────────────────────────────

alter table public.documentos_contractuales_versiones
  add column rige_por_aviso boolean not null default false,
  add column reemplaza_version_id uuid references public.documentos_contractuales_versiones(id),
  add column publicada_at timestamptz;

-- En las DOS direcciones: una versión por aviso sin la que modifica o sin fecha de publicación no
-- prueba ningún preaviso, y una de entrada con esas columnas se contradice.
alter table public.documentos_contractuales_versiones
  add constraint documentos_versiones_aviso_coherente check (
    (rige_por_aviso and reemplaza_version_id is not null and publicada_at is not null and reemplaza_version_id <> id)
    or (not rige_por_aviso and reemplaza_version_id is null and publicada_at is null)
  );

comment on column public.documentos_contractuales_versiones.rige_por_aviso is
  'true = modificación de la cláusula 13.1: rige desde vigente_desde la acepte o no el cliente, y no aceptarla nunca pausa ni restringe el servicio. false = términos de entrada (se aceptan para usar el servicio).';
comment on column public.documentos_contractuales_versiones.reemplaza_version_id is
  'Solo por aviso: la versión que esta modifica. Quien aceptó aquella tiene esta cubierta.';
comment on column public.documentos_contractuales_versiones.publicada_at is
  'Solo por aviso: cuándo se publicó el aviso en la plataforma. vigente_desde >= esta fecha (Bogotá) + 30 días (cláusula 13.1).';


-- ── 2. La guarda de una versión por aviso, al registrarla ───────────────────────────────
-- La modifica de la MISMA serie (mismo cobrador, slug, alcance, empresa y módulo), no está publicada
-- en el futuro y rige al menos 30 días calendario después de publicada.

create or replace function public.documentos_versiones_por_aviso()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_previa record;
begin
  if not new.rige_por_aviso then
    return new;
  end if;

  select d.workspace_id, d.slug, d.alcance, d.empresa_id, d.modulo
    into v_previa
    from public.documentos_contractuales_versiones d
   where d.id = new.reemplaza_version_id;
  if not found then
    raise exception 'documentos_contractuales_versiones: la versión que se modifica (%) no existe', new.reemplaza_version_id;
  end if;
  if v_previa.workspace_id is distinct from new.workspace_id
     or v_previa.slug is distinct from new.slug
     or v_previa.alcance is distinct from new.alcance
     or v_previa.empresa_id is distinct from new.empresa_id
     or v_previa.modulo is distinct from new.modulo then
    raise exception 'documentos_contractuales_versiones: una modificación por aviso es de la misma serie que la versión que modifica (cobrador, slug, alcance, empresa y módulo)';
  end if;

  if new.publicada_at > now() then
    raise exception 'documentos_contractuales_versiones: el aviso no se publica en el futuro (%): se registra al publicarlo', new.publicada_at;
  end if;
  if new.vigente_desde < ((new.publicada_at at time zone 'America/Bogota')::date + 30) then
    raise exception 'documentos_contractuales_versiones: una modificación por aviso rige al menos 30 días calendario después de publicada (cláusula 13.1): publicada el %, vigente desde %',
      (new.publicada_at at time zone 'America/Bogota')::date, new.vigente_desde;
  end if;
  return new;
end;
$$;

revoke execute on function public.documentos_versiones_por_aviso() from public, anon, authenticated;

create trigger trg_documentos_versiones_por_aviso
  before insert on public.documentos_contractuales_versiones
  for each row execute function public.documentos_versiones_por_aviso();


-- ── 3. Inmutabilidad: lo del aviso tampoco se reescribe ─────────────────────────────────
-- Cuerpo de 20260929030000 con tres columnas más en la lista.

create or replace function public.documentos_versiones_inmutables()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'documentos_contractuales_versiones es inmutable: una versión aceptada no se borra';
  end if;
  if new.id is distinct from old.id
     or new.workspace_id is distinct from old.workspace_id
     or new.slug is distinct from old.slug
     or new.version is distinct from old.version
     or new.alcance is distinct from old.alcance
     or new.empresa_id is distinct from old.empresa_id
     or new.modulo is distinct from old.modulo
     or new.texto_md is distinct from old.texto_md
     or new.texto_sha256 is distinct from old.texto_sha256
     or new.pdf_bucket is distinct from old.pdf_bucket
     or new.pdf_path is distinct from old.pdf_path
     or new.pdf_sha256 is distinct from old.pdf_sha256
     or new.vigente_desde is distinct from old.vigente_desde
     or new.rige_por_aviso is distinct from old.rige_por_aviso
     or new.reemplaza_version_id is distinct from old.reemplaza_version_id
     or new.publicada_at is distinct from old.publicada_at then
    raise exception 'documentos_contractuales_versiones es inmutable salvo vigente_hasta: suba una versión nueva';
  end if;
  return new;
end;
$$;

revoke execute on function public.documentos_versiones_inmutables() from public, anon, authenticated;


-- ── 4. Los documentos del cliente, con lo del aviso ─────────────────────────────────────
-- Cuerpo de 20260929030000 con tres columnas más al final de la salida. Cambia el `returns table`:
-- DROP + CREATE, y la ACL se repone abajo.

drop function public.mis_documentos_de_servicio();

create function public.mis_documentos_de_servicio()
returns table (
  documento_id uuid,
  slug text,
  titulo text,
  version text,
  alcance text,
  texto_md text,
  pdf_bucket text,
  pdf_path text,
  pdf_sha256 text,
  vigente_desde date,
  vigente_hasta date,
  aceptado_at timestamptz,
  aceptado_por text,
  aceptado_calidad text,
  aceptado_canal text,
  rige_por_aviso boolean,
  reemplaza_version_id uuid,
  publicada_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with mios as (
    -- Un par (empresa, módulo) por contrato que cubre al espacio de la sesión, como pagador o como
    -- beneficiario. `distinct` porque dos contratos pueden coincidir en el par.
    select distinct sc.empresa_id, cs.modulo
    from public.servicios_contratados sc
    join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
    where public.current_user_workspace_id() is not null
      and (
        sc.workspace_pagador_id = public.current_user_workspace_id()
        or exists (
          select 1 from public.servicio_contratado_beneficiarios b
          where b.servicio_contratado_id = sc.id
            and b.workspace_id = public.current_user_workspace_id()
        )
      )
  )
  select
    d.id,
    d.slug,
    d.titulo,
    d.version,
    d.alcance,
    d.texto_md,
    d.pdf_bucket,
    d.pdf_path,
    d.pdf_sha256,
    d.vigente_desde,
    d.vigente_hasta,
    a.created_at,
    a.nombre_aceptante,
    a.calidad,
    -- El canal se nombra porque cambia lo que la constancia demuestra: por WhatsApp la
    -- v1.0 descansa en un webhook cuya firma no se verifica (§8, riesgo preexistente).
    case when a.prompt_wamid is not null then 'whatsapp' else 'modulo' end,
    d.rige_por_aviso,
    d.reemplaza_version_id,
    d.publicada_at
  from public.documentos_contractuales_versiones d
  left join public.aceptaciones_terminos a
    on a.documento_sha256 = d.pdf_sha256
   and a.estado = 'aceptado'
   -- La huella dice QUÉ se aceptó, no en qué contrato. Sin esta condición, una prueba
   -- interna con el mismo PDF (sin negocio) salía como una segunda constancia del
   -- documento. Visto con 4D SOFT el 2026-09-16.
   and a.negocio_id in (
     select sc.negocio_id
     from public.servicios_contratados sc
     join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
     where (
         (d.alcance = 'cliente' and sc.empresa_id = d.empresa_id)
         or (d.alcance = 'plantilla' and cs.modulo = d.modulo)
       )
       and (
         sc.workspace_pagador_id = public.current_user_workspace_id()
         or exists (
           select 1 from public.servicio_contratado_beneficiarios b
           where b.servicio_contratado_id = sc.id
             and b.workspace_id = public.current_user_workspace_id()
         )
       )
   )
  -- Un 'cliente' se ve por su empresa (como desde C2). Un 'plantilla' se ve por su módulo: hay que
  -- tener contratado un servicio de ESE módulo. Ser genérico no lo hace visible para todos.
  where exists (
    select 1 from mios m
    where (d.alcance = 'cliente' and m.empresa_id = d.empresa_id)
       or (d.alcance = 'plantilla' and m.modulo = d.modulo)
  )
  order by d.slug, d.vigente_desde desc;
$$;

comment on function public.mis_documentos_de_servicio() is
  'Documentos contractuales que el cliente ve: los de su empresa (alcance cliente) y los genéricos del módulo que tiene contratado (alcance plantilla), con la constancia de su aceptación solo si es de un negocio de sus contratos, y si la versión es una modificación por aviso (cláusula 13.1), cuál reemplaza y cuándo se publicó. Nunca salen el teléfono, el wamid ni el payload de Meta.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (pestaña Documentos
-- de /valida-api, /valida y /radar) y el filtro por workspace vive dentro de la función, no en el
-- guard.
revoke execute on function public.mis_documentos_de_servicio() from public, anon;
grant  execute on function public.mis_documentos_de_servicio() to authenticated;


-- ── 5. La guarda del canal módulo: una modificación publicada se acepta antes de regir ──
-- Cuerpo de 20260929030000 con UN cambio, en el paso (1): la condición de vigencia admite una versión
-- por aviso ya publicada aunque todavía no rija. Todo lo demás —y cada mensaje de error— queda igual.

create or replace function public.aceptaciones_terminos_modulo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_doc record;
  v_perfil record;
  v_hay_perfil boolean;
  v_designado uuid;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if tg_op = 'UPDATE' then
    -- Una aceptación no cambia de canal: sería reescribir cómo se obtuvo la evidencia.
    if new.canal is distinct from old.canal then
      raise exception 'aceptaciones_terminos %: el canal no cambia', old.id;
    end if;
    return new;
  end if;

  if new.canal is distinct from 'modulo' then
    return new;
  end if;

  -- (1) Exactamente una versión registrada, y vigente hoy (o, si es una modificación por aviso,
  --     ya publicada: se acepta desde el aviso aunque rija después).
  select d.id, d.workspace_id, d.alcance, d.empresa_id, d.modulo, d.titulo, d.version,
         d.texto_sha256, d.pdf_sha256, d.vigente_desde, d.vigente_hasta,
         d.rige_por_aviso, d.publicada_at
    into v_doc
    from public.documentos_contractuales_versiones d
   where d.id = new.documento_version_id;
  if not found then
    raise exception 'aceptaciones_terminos: la versión % no existe', new.documento_version_id;
  end if;

  if new.workspace_id is distinct from v_doc.workspace_id
     or new.documento_sha256 is distinct from v_doc.pdf_sha256
     or new.texto_documento_sha256 is distinct from v_doc.texto_sha256
     or new.documento_titulo is distinct from v_doc.titulo
     or new.documento_version is distinct from v_doc.version then
    raise exception 'aceptaciones_terminos: lo aceptado no coincide con la versión % (espacio, título, versión o huellas)',
      v_doc.id;
  end if;

  if (v_doc.vigente_desde > v_hoy and not (v_doc.rige_por_aviso and v_doc.publicada_at <= now()))
     or (v_doc.vigente_hasta is not null and v_doc.vigente_hasta < v_hoy) then
    raise exception 'aceptaciones_terminos: la versión % no está vigente hoy', v_doc.id;
  end if;

  -- (2) El negocio es de un contrato que cubre al espacio del cliente y que corresponde al
  --     documento: de ESA empresa si el documento es 'cliente', o de un servicio de ESE módulo si
  --     es 'plantilla' (un genérico no tiene empresa a la que unirse).
  if new.workspace_cliente_id is null or not exists (
    select 1
      from public.servicios_contratados sc
      join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
     where sc.negocio_id = new.negocio_id
       and (
         (v_doc.alcance = 'cliente' and sc.empresa_id = v_doc.empresa_id)
         or (v_doc.alcance = 'plantilla' and cs.modulo = v_doc.modulo)
       )
       and (
         sc.workspace_pagador_id = new.workspace_cliente_id
         or exists (
           select 1 from public.servicio_contratado_beneficiarios b
            where b.servicio_contratado_id = sc.id
              and b.workspace_id = new.workspace_cliente_id
         )
       )
  ) then
    raise exception 'aceptaciones_terminos: el negocio % no es de un contrato de esta empresa que cubra al espacio %',
      new.negocio_id, new.workspace_cliente_id;
  end if;

  -- (3) Lo acepta la persona que el contrato designó; si no designó a nadie, el dueño del espacio.
  --     En los dos casos desde el espacio del cliente, y nunca el soporte de MeTRIK.
  --
  --     El contrato se elige con el MISMO orden que usa el servidor para colgar la constancia
  --     (`versionContratada`): el activo primero y, entre iguales, el de vigencia más reciente.
  select sc.aceptante_designado_id
    into v_designado
    from public.servicios_contratados sc
    join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
   where sc.negocio_id = new.negocio_id
     and (
       (v_doc.alcance = 'cliente' and sc.empresa_id = v_doc.empresa_id)
       or (v_doc.alcance = 'plantilla' and cs.modulo = v_doc.modulo)
     )
     and (
       sc.workspace_pagador_id = new.workspace_cliente_id
       or exists (
         select 1 from public.servicio_contratado_beneficiarios b
          where b.servicio_contratado_id = sc.id
            and b.workspace_id = new.workspace_cliente_id
       )
     )
   order by (sc.estado = 'activo') desc, sc.vigente_desde desc
   limit 1;

  select p.role, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil
    from public.profiles p
   where p.id = new.usuario_id;
  v_hay_perfil := found;

  if v_designado is not null then
    if new.usuario_id is distinct from v_designado
       or not v_hay_perfil
       or v_perfil.workspace_id is distinct from new.workspace_cliente_id then
      raise exception 'aceptaciones_terminos: estos términos los acepta la persona que la empresa designó, desde el espacio del cliente';
    end if;
  elsif not v_hay_perfil
     or v_perfil.workspace_id is distinct from new.workspace_cliente_id
     or v_perfil.role is distinct from 'owner' then
    raise exception 'aceptaciones_terminos: solo el dueño del espacio acepta los términos de su contrato';
  end if;
  if v_perfil.platform_admin then
    raise exception 'aceptaciones_terminos: el soporte de MeTRIK no acepta términos por un cliente';
  end if;

  -- (4) Lo ya aceptado sobre este contrato, por cualquier canal, no se vuelve a aceptar.
  if exists (
    select 1 from public.aceptaciones_terminos a
     where a.estado = 'aceptado'
       and a.documento_sha256 = new.documento_sha256
       and a.negocio_id = new.negocio_id
  ) then
    raise exception using
      errcode = 'unique_violation',
      message = format('aceptaciones_terminos: la versión %s ya tiene aceptación registrada en este contrato', v_doc.id);
  end if;

  -- (5) La base pone la hora y la huella de la declaración; y la declaración identifica.
  new.respondido_at := now();
  new.texto_aceptacion_sha256 := encode(sha256(convert_to(new.texto_aceptacion, 'UTF8')), 'hex');

  if position(btrim(new.nombre_aceptante) in new.texto_aceptacion) = 0
     or position(new.cedula_aceptante in new.texto_aceptacion) = 0
     or position(new.documento_sha256 in new.texto_aceptacion) = 0 then
    raise exception 'aceptaciones_terminos: la declaración tiene que nombrar a quien acepta, su cédula y la huella del PDF';
  end if;

  return new;
end;
$$;

-- `create or replace` conserva la ACL; se repite para que este archivo diga por sí solo que nadie
-- la ejecuta. PostgreSQL no exige EXECUTE para disparar un trigger.
revoke execute on function public.aceptaciones_terminos_modulo() from public, anon, authenticated;


-- ── 6. La constancia del preaviso: quién vio el aviso y cuándo, por primera vez ─────────

-- server-only: la escribe el servidor (cliente de servicio) al pintar el aviso en /valida, y se lee
-- solo por SQL como prueba del preaviso. El cliente nunca la consulta: sin grant ni policy.
create table public.avisos_modificacion_vistos (
  id uuid primary key default gen_random_uuid(),
  -- La versión por aviso cuyo aviso se mostró (la v1.4 de ESA empresa).
  documento_version_id uuid not null references public.documentos_contractuales_versiones(id),
  -- El espacio del cliente donde se mostró (el CDA).
  workspace_id uuid not null references public.workspaces(id),
  -- La persona REAL de la sesión, nunca la de «Ver como» (el soporte no cuenta como cliente).
  usuario_id uuid not null references public.profiles(id),
  visto_at timestamptz not null default now(),
  ip text,
  user_agent text,
  constraint avisos_modificacion_vistos_una_vez unique (documento_version_id, usuario_id)
);

alter table public.avisos_modificacion_vistos enable row level security;
revoke all on table public.avisos_modificacion_vistos from public, anon, authenticated;

create index idx_avisos_modificacion_vistos_espacio
  on public.avisos_modificacion_vistos (workspace_id, documento_version_id);

comment on table public.avisos_modificacion_vistos is
  'Constancia del preaviso de una modificación por aviso (cláusula 13.1): por versión y usuario, la PRIMERA vez que el aviso se mostró en la plataforma. Solo se inserta; ni UPDATE ni DELETE.';

-- La primera vez es la prueba: no se mueve ni se borra.
create or replace function public.avisos_modificacion_vistos_inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'avisos_modificacion_vistos es una constancia: no se modifica ni se borra';
end;
$$;

revoke execute on function public.avisos_modificacion_vistos_inmutable() from public, anon, authenticated;

create trigger trg_avisos_modificacion_vistos_inmutable
  before update or delete on public.avisos_modificacion_vistos
  for each row execute function public.avisos_modificacion_vistos_inmutable();
