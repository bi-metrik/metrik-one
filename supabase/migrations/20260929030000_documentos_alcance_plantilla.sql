-- ============================================================
-- 20260929030000 — Un documento genérico se ve por el MÓDULO contratado, no por la empresa
--
-- Spec: proyectos/metrik/one/2026-09-28_spec-radar-secop.md (bloque B) y la publicación de
-- `terminos-uso-radar@1.0` (sql/radar/2026-09-28_terminos-uso-radar-v1.0.sql).
--
-- ## El defecto
--
-- `documentos_contractuales_versiones` admite dos alcances desde C2 (`20260916180000`):
-- 'cliente' (el texto lleva los datos de una empresa, `empresa_id` obligatorio) y 'plantilla'
-- (texto genérico, sin empresa). En producción las 10 versiones registradas son 'cliente' y el
-- camino 'plantilla' NUNCA se ejercitó: tres puntos unen documento y cliente SOLO por
-- `empresa_id`, así que un 'plantilla' queda invisible y no se puede aceptar.
--
--   1. `mis_documentos_de_servicio()` (20260916213000): `join mios m on m.empresa_id = d.empresa_id`
--      es un join interno; con `empresa_id` nulo el documento nunca sale.
--   2. `aceptaciones_terminos_modulo()` (20260923220000, pasos 2 y 3): exigen un contrato con
--      `sc.empresa_id = v_doc.empresa_id`; con nulo el paso 2 levanta excepción.
--   3. `versionContratada()` (src/lib/valida-api/terminos-servidor.ts): `if (!v?.empresa_id) return null`
--      — va en el mismo PR, no aquí.
--
-- Los términos del Radar SECOP son genéricos por decisión del CLO (no llevan datos de ningún
-- cliente), y registrarlos como 'cliente' por empresa no es alternativa: `pdf_sha256` es UNIQUE
-- global y el PDF es byte a byte el mismo para todos, así que el segundo cliente del Radar no
-- podría registrarse.
--
-- ## ⚠️ La decisión: aflojar el join NO significa «que lo vea cualquiera»
--
-- Hoy el join por empresa es lo ÚNICO que decide quién ve qué documento. Si un 'plantilla' saliera
-- por ser genérico, saldría para TODO espacio con cualquier contrato: un CDA vería los términos del
-- Radar en su pestaña Documentos y, peor, su entrada de módulo se lo pediría aceptar para entrar a
-- Valida (`estadoTerminos` exige aceptados TODOS los documentos vigentes visibles).
--
-- Por eso un 'plantilla' declara a qué MÓDULO pertenece (columna `modulo`, nueva) y se ve solo si el
-- espacio tiene contratado un servicio de ESE módulo, leyendo el módulo del catálogo
-- (`catalogo_servicios.modulo`). Ni el documento se cuelga de una empresa, ni la visibilidad queda
-- suelta: la ata el servicio contratado, que es lo que ya decide todo lo demás en este mecanismo.
--
-- Un espacio SIN contrato de ese módulo no ve el documento, y uno sin ningún contrato tampoco
-- (`mios` sale vacía). Probado EJECUTADO en PGlite, no razonado:
-- `src/lib/valida-api/aceptacion-modulo-sql.test.ts`, bloque «un documento genérico se ve por el
-- módulo contratado» (las dos direcciones, más la constancia de otro contrato que no cuenta).
--
-- ## Qué escribe: DDL y tres funciones. Ni una fila de datos.
--
-- La fila de los términos del Radar es dato de producción y va aparte
-- (`sql/radar/2026-09-28_terminos-uso-radar-v1.0.sql`). Sin esa fila esta migración no cambia nada
-- visible: las 10 versiones registradas son 'cliente' y para ellas las dos RPC deciden EXACTAMENTE
-- lo mismo que antes (el `modulo` de un 'cliente' es null y su rama no lo mira).
--
-- ## Lo que no cambia
--
-- Firmas, columnas de salida, `stable`, `security definer`, `search_path` y ACL de las funciones.
-- Los mensajes de error de la guarda se conservan palabra por palabra: las pruebas y el servidor los
-- reconocen. El del paso 2 dice «de esta empresa» también cuando el documento es 'plantilla' y lo
-- que falló fue el módulo; cambiarlo es romper esos reconocedores por una frase.
--
-- ## Límites conocidos
--
--   · Ni la visibilidad ni la guarda miran `servicios_contratados.estado` ni su vigencia, igual que
--     antes para los 'cliente': un contrato terminado sigue mostrando sus documentos, que es lo
--     correcto para una constancia (lo aceptado no se desaceptó).
--   · El join a `catalogo_servicios` es interno y no puede perder contratos: `servicio_slug` es NOT
--     NULL y su FK compuesta llega a `catalogo_servicios_versiones`, cuyo `slug` referencia al
--     catálogo.
--   · La inmutabilidad de la tabla suma `alcance` y `modulo`, que es lo que esta migración vuelve
--     load-bearing (un UPDATE podría convertir el documento de una empresa en el de todo un
--     módulo). `titulo` y `linea_id` siguen siendo modificables, como desde C2: es un hueco previo y
--     ajeno a este cambio.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select column_name, is_nullable from information_schema.columns
--    where table_schema='public' and table_name='documentos_contractuales_versiones'
--      and column_name='modulo';                                   -> 1 fila, YES
--   select conname from pg_constraint
--    where conrelid='public.documentos_contractuales_versiones'::regclass
--      and conname in ('documentos_versiones_modulo','documentos_versiones_modulo_coherente'); -> 2
--   select count(*) from public.documentos_contractuales_versiones where alcance='plantilla'; -> 0
--   select count(*) from public.documentos_contractuales_versiones where modulo is not null;  -> 0
--   select p.proname, p.prosecdef, p.proconfig, p.proacl from pg_proc p
--     join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public'
--      and p.proname in ('mis_documentos_de_servicio','aceptaciones_terminos_modulo',
--                        'documentos_versiones_inmutables');
--     -> mis_documentos_de_servicio: prosecdef=true, proconfig={"search_path=public, pg_temp"},
--        authenticated=X y SIN anon ni =X/ (PUBLIC)
--     -> aceptaciones_terminos_modulo y documentos_versiones_inmutables: SIN anon,
--        authenticated ni PUBLIC
--
-- ## Cómo revertir (mientras no haya filas 'plantilla')
--
--   -- re-crear las funciones con los cuerpos de 20260916213000, 20260923220000 y 20260916180000
--   alter table public.documentos_contractuales_versiones
--     drop constraint documentos_versiones_modulo_coherente,
--     drop constraint documentos_versiones_modulo,
--     drop column modulo;
-- ============================================================


-- ── 1. El módulo que gobierna un documento genérico ─────────────────────────────────────

alter table public.documentos_contractuales_versiones
  add column modulo text;

-- Cuarta copia de la lista de llaves de módulo (las otras tres: `workspace_modulos`,
-- `catalogo_servicios` y `proyectar_modulos`). `src/lib/modulos/catalogo.test.ts` lee este archivo y
-- falla si se separan. Sin CHECK, un 'radar-secop' con guion dejaría el documento invisible en
-- silencio, que es justo el defecto que esta migración vino a cerrar.
alter table public.documentos_contractuales_versiones
  add constraint documentos_versiones_modulo check
    (modulo in ('business', 'valida_consulta', 'valida_api', 'compliance', 'calidad_llamadas', 'cert_qr', 'ferreteria', 'radar_secop'));

-- El mismo rigor que `documentos_versiones_empresa_coherente`, en las DOS direcciones: un
-- 'plantilla' sin módulo no se puede mostrar a nadie, y un 'cliente' con módulo se contradice
-- (ese se ve por su empresa).
alter table public.documentos_contractuales_versiones
  add constraint documentos_versiones_modulo_coherente
    check ((alcance = 'plantilla') = (modulo is not null));

comment on column public.documentos_contractuales_versiones.modulo is
  'Solo en alcance plantilla: el módulo (llave de workspaces.modules) cuyos clientes ven y aceptan este documento genérico. Lo hace visible tener contratado un servicio de catalogo_servicios con ese módulo, no ser genérico.';


-- ── 2. Inmutabilidad: alcance y módulo deciden quién lo ve ──────────────────────────────
-- Cuerpo de 20260916180000 con dos columnas más en la lista. Sin esto, un UPDATE podría convertir
-- el documento de una empresa en el documento de todo un módulo sin dejar rastro.

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
     or new.vigente_desde is distinct from old.vigente_desde then
    raise exception 'documentos_contractuales_versiones es inmutable salvo vigente_hasta: suba una versión nueva';
  end if;
  return new;
end;
$$;

revoke execute on function public.documentos_versiones_inmutables() from public, anon, authenticated;


-- ── 3. Los documentos del cliente: por empresa o por módulo contratado ──────────────────
-- Cuerpo de 20260916213000 con `mios` trayendo también el módulo de cada contrato, y el documento
-- eligiéndose con `exists` en vez de un join: un espacio con dos servicios de la misma empresa daba
-- dos filas de `mios` y habría duplicado cada documento 'cliente'.

create or replace function public.mis_documentos_de_servicio()
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
  aceptado_canal text
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
    case when a.prompt_wamid is not null then 'whatsapp' else 'modulo' end
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
  'Documentos contractuales que el cliente ve: los de su empresa (alcance cliente) y los genéricos del módulo que tiene contratado (alcance plantilla), con la constancia de su aceptación solo si es de un negocio de sus contratos. Nunca salen el teléfono, el wamid ni el payload de Meta: se quedan en ONE como evidencia.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (pestaña Documentos
-- de /valida-api, /valida y /radar) y el filtro por workspace vive dentro de la función, no en el
-- guard.
revoke execute on function public.mis_documentos_de_servicio() from public, anon;
grant  execute on function public.mis_documentos_de_servicio() to authenticated;


-- ── 4. La guarda del canal módulo, con el alcance ───────────────────────────────────────
-- Cuerpo de 20260923220000 con UN cambio, repetido en los pasos (2) y (3): el contrato que respalda
-- la constancia se busca por la EMPRESA del documento si es 'cliente' y por su MÓDULO si es
-- 'plantilla'. Todo lo demás —y cada mensaje de error— queda igual.

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

  -- (1) Exactamente una versión registrada, y vigente hoy.
  select d.id, d.workspace_id, d.alcance, d.empresa_id, d.modulo, d.titulo, d.version,
         d.texto_sha256, d.pdf_sha256, d.vigente_desde, d.vigente_hasta
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

  if v_doc.vigente_desde > v_hoy or (v_doc.vigente_hasta is not null and v_doc.vigente_hasta < v_hoy) then
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
