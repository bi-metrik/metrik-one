-- ============================================================
-- 20260917014500: la aceptación de los términos también se hace dentro de /valida-api
--
-- Hasta hoy los términos de un cliente de API directa solo se aceptaban por WhatsApp
-- (`aceptaciones_terminos`, 20260915040000) y el módulo Valida API los MOSTRABA en la pestaña
-- Documentos sin exigirlos: un cliente sin términos aceptados podía crear llaves, contra la
-- cláusula 3.1 de sus propios términos ("las credenciales se entregan únicamente después de la
-- aceptación").
--
-- Esta migración deja que el dueño del espacio del cliente acepte la versión vigente desde el
-- módulo, en la MISMA tabla. No se crea otra: `mis_documentos_de_servicio()` ya lee
-- `aceptaciones_terminos`, ya deriva el canal (`prompt_wamid` nulo = 'modulo') y ya ata la
-- constancia al negocio del contrato (20260916213000). Una tabla aparte obligaba a esa función a
-- unir dos fuentes y a decidir cuál gana si las dos dicen algo distinto.
--
-- ## Qué escribe: DDL y una función. Ni una fila de datos.
--
-- Las dos filas que hay hoy (def579c7 de 4D SOFT y 41233b25, la prueba interna) quedan con
-- `canal = 'whatsapp'` por el default y cumplen las restricciones nuevas tal como están. La de
-- 4D SOFT sigue siendo la constancia de su v1.0: con ella, el módulo NO le vuelve a pedir los
-- términos a Juan Guillermo.
--
-- ## Lo que cambia en la tabla
--
--   · `canal` ('whatsapp' | 'modulo'), con 'whatsapp' por defecto para lo que ya existe.
--   · `telefono` y `documento_url` dejan de ser NOT NULL, pero SIGUEN siendo obligatorios en el
--     canal whatsapp (la restricción se mueve, no se afloja). En el módulo no hay teléfono, y el
--     PDF no se entrega por una URL: se identifica por su versión y su huella.
--   · `aceptaciones_terminos_respuesta_completa` se reescribe para aplicar SOLO al canal
--     whatsapp: exige wamid, botón y payload de Meta, que en el módulo no existen.
--   · Columnas de la evidencia del módulo: quién (`usuario_id`, perfil real de la sesión, no el
--     impersonado), desde qué espacio (`workspace_cliente_id`), qué versión exacta
--     (`documento_version_id` + `texto_documento_sha256`), su cédula (`cedula_aceptante`), la
--     huella de la declaración (`texto_aceptacion_sha256`) y el origen de la petición (`ip`,
--     `user_agent`, igual que la aceptación de la Política).
--
-- ## Lo que decide la base, no el servidor
--
-- `aceptaciones_terminos_modulo()` (BEFORE INSERT) rechaza toda fila del canal módulo que:
--   1. no corresponda EXACTAMENTE a una versión registrada (workspace, título, versión y las dos
--      huellas) o cuya versión no esté vigente hoy en Bogotá;
--   2. cuelgue de un negocio que no sea de un contrato de ESA empresa que cubra al espacio del
--      cliente, como pagador o como beneficiario (el mismo criterio de
--      `mis_documentos_de_servicio`, para que lo que se acepta y lo que se muestra no difieran);
--   3. la firme alguien que no es owner de ese espacio, o que es platform_admin: el soporte de
--      MeTRIK no acepta términos por un cliente, ni suplantándolo;
--   4. repita una aceptación ya registrada del mismo PDF sobre el mismo negocio, por cualquier
--      canal (si 4D SOFT ya aceptó por WhatsApp, el módulo no crea una segunda constancia);
--   5. tenga una declaración que no nombre a la persona, su cédula y la huella del PDF.
-- Y pone ella misma `respondido_at` (su reloj, no el del navegador) y `texto_aceptacion_sha256`
-- (la huella se calcula sobre el texto guardado: no puede no coincidir).
--
-- El servidor hace las mismas comprobaciones antes, para poder decir en pantalla qué falta. Esta
-- función es la que las hace ciertas aunque el servidor tenga un defecto: la fila es evidencia.
--
-- Una fila del canal módulo nace `aceptado` y la guarda de 20260915060000 ya la vuelve inmutable
-- (solo admite `contrato_fin`). El índice único parcial cierra la carrera de dos pestañas.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select canal, count(*) from public.aceptaciones_terminos group by canal;
--     -> whatsapp | 2
--   select conname from pg_constraint
--    where conrelid = 'public.aceptaciones_terminos'::regclass and conname like 'aceptaciones_terminos_%'
--    order by 1;
--     -> incluye canal, telefono_por_canal, url_por_canal, respuesta_completa, modulo_completa
--   select has_function_privilege('anon', 'public.aceptaciones_terminos_modulo()', 'execute'),
--          has_function_privilege('authenticated', 'public.aceptaciones_terminos_modulo()', 'execute');
--     -> false, false
--   select has_table_privilege('authenticated', 'public.aceptaciones_terminos', 'select');
--     -> false (sigue siendo server-only)
--
-- ## Cómo revertir (antes de que exista una fila del canal módulo)
--
--   drop trigger trg_aceptaciones_terminos_modulo on public.aceptaciones_terminos;
--   drop function public.aceptaciones_terminos_modulo();
--   drop index public.uq_aceptaciones_terminos_modulo;
--   alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_modulo_completa,
--     drop constraint aceptaciones_terminos_telefono_por_canal,
--     drop constraint aceptaciones_terminos_url_por_canal,
--     drop constraint aceptaciones_terminos_respuesta_completa;
--   -- y re-crear respuesta_completa con el cuerpo de 20260915040000, los NOT NULL de telefono y
--   -- documento_url, y soltar las columnas nuevas.
-- ============================================================


-- ── 1. Columnas ─────────────────────────────────────────────────────────────────────────

alter table public.aceptaciones_terminos
  add column canal text not null default 'whatsapp'
    constraint aceptaciones_terminos_canal check (canal in ('whatsapp', 'modulo')),
  -- Perfil REAL de quien aceptó en el módulo (la sesión, no "Ver como").
  add column usuario_id uuid references public.profiles(id),
  -- El espacio del cliente desde el que se aceptó. `workspace_id` sigue siendo el del cobrador.
  add column workspace_cliente_id uuid references public.workspaces(id),
  -- La versión exacta aceptada. La huella del PDF ya estaba en `documento_sha256`.
  add column documento_version_id uuid references public.documentos_contractuales_versiones(id),
  add column cedula_aceptante text
    constraint aceptaciones_terminos_cedula check (cedula_aceptante is null or cedula_aceptante ~ '^[0-9]{5,12}$'),
  -- Huella del texto web de la versión que se mostró para leer.
  add column texto_documento_sha256 text
    constraint aceptaciones_terminos_texto_documento_sha
      check (texto_documento_sha256 is null or texto_documento_sha256 ~ '^[0-9a-f]{64}$'),
  -- Huella del texto EXACTO de la declaración (`texto_aceptacion`). La calcula el trigger.
  add column texto_aceptacion_sha256 text
    constraint aceptaciones_terminos_texto_aceptacion_sha
      check (texto_aceptacion_sha256 is null or texto_aceptacion_sha256 ~ '^[0-9a-f]{64}$'),
  add column ip inet,
  add column user_agent text;

comment on column public.aceptaciones_terminos.canal is
  'Por dónde se aceptó: whatsapp (wa-webhook) o modulo (/valida-api, dueño del espacio del cliente).';
comment on column public.aceptaciones_terminos.usuario_id is
  'Canal modulo: perfil real de la sesión que aceptó (nunca el impersonado).';
comment on column public.aceptaciones_terminos.workspace_cliente_id is
  'Canal modulo: espacio del cliente desde el que se aceptó. workspace_id es el del cobrador (metrik).';
comment on column public.aceptaciones_terminos.texto_aceptacion_sha256 is
  'sha256 hex de texto_aceptacion. En el canal modulo la calcula aceptaciones_terminos_modulo().';


-- ── 2. Lo obligatorio pasa a depender del canal ─────────────────────────────────────────
-- Las columnas dejan de ser NOT NULL y la exigencia se re-declara por canal EN LA MISMA
-- migración: el canal whatsapp no pierde ninguna garantía.

alter table public.aceptaciones_terminos
  alter column telefono drop not null,
  alter column documento_url drop not null;

alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_telefono_por_canal
    check (canal <> 'whatsapp' or telefono is not null),
  add constraint aceptaciones_terminos_url_por_canal
    check (canal <> 'whatsapp' or documento_url is not null);

-- La respuesta de WhatsApp trae wamid, botón y payload de Meta; la del módulo no. Cuerpo idéntico
-- al de 20260915040000, acotado al canal whatsapp.
alter table public.aceptaciones_terminos
  drop constraint aceptaciones_terminos_respuesta_completa;
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_respuesta_completa check (
    canal <> 'whatsapp'
    or (
      (estado in ('aceptado', 'rechazado'))
      = (respondido_at is not null and reply_wamid is not null
         and button_id is not null and payload_respuesta is not null)
    )
  );

-- Una fila del módulo nace aceptada y con toda su evidencia, y sin nada de WhatsApp.
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_modulo_completa check (
    canal <> 'modulo'
    or (
      estado = 'aceptado'
      and calidad in ('representante_legal', 'apoderado')
      and negocio_id is not null
      and usuario_id is not null
      and workspace_cliente_id is not null
      and documento_version_id is not null
      and cedula_aceptante is not null
      and texto_documento_sha256 is not null
      and texto_aceptacion_sha256 is not null
      and respondido_at is not null
      and nullif(btrim(empresa_nombre), '') is not null
      and nullif(btrim(empresa_nit), '') is not null
      and telefono is null
      and prompt_wamid is null
      and reply_wamid is null
      and button_id is null
      and payload_respuesta is null
      and enviado_at is null
    )
  );

-- Dos pestañas aceptando a la vez: la segunda rebota aquí aunque las dos pasen la comprobación
-- previa del trigger. Solo el canal módulo: el flujo de WhatsApp tiene sus propias reglas.
create unique index uq_aceptaciones_terminos_modulo
  on public.aceptaciones_terminos (negocio_id, documento_sha256)
  where canal = 'modulo' and estado = 'aceptado';


-- ── 3. La guarda del canal módulo ───────────────────────────────────────────────────────

create or replace function public.aceptaciones_terminos_modulo()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_doc record;
  v_perfil record;
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
  select d.id, d.workspace_id, d.empresa_id, d.titulo, d.version, d.texto_sha256, d.pdf_sha256,
         d.vigente_desde, d.vigente_hasta
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

  -- (2) El negocio es de un contrato de esa empresa que cubre al espacio del cliente.
  if new.workspace_cliente_id is null or not exists (
    select 1
      from public.servicios_contratados sc
     where sc.negocio_id = new.negocio_id
       and sc.empresa_id = v_doc.empresa_id
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

  -- (3) Lo acepta el dueño del espacio del cliente, y no el soporte de MeTRIK.
  select p.role, p.workspace_id, coalesce(p.platform_admin, false) as platform_admin
    into v_perfil
    from public.profiles p
   where p.id = new.usuario_id;
  if not found
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

-- PostgreSQL no exige EXECUTE para disparar un trigger, solo para crearlo: el revoke no lo apaga.
revoke execute on function public.aceptaciones_terminos_modulo() from public, anon, authenticated;

-- Corre DESPUÉS de trg_aceptaciones_terminos_guardas (orden alfabético), que ya comprueba que el
-- negocio es del mismo espacio que `workspace_id`.
create trigger trg_aceptaciones_terminos_modulo
  before insert or update on public.aceptaciones_terminos
  for each row execute function public.aceptaciones_terminos_modulo();
