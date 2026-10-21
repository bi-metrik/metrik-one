-- ============================================================
-- 20261014203000 — Los Términos de Uso de Valida (autoservicio v2.0) se aceptan EN EL REGISTRO
--
-- Decisión de Mauricio (2026-10-14): «lo importante es que tengamos la posibilidad de que se puedan
-- realizar cobros automáticos». El cobro al cumplirse los 7 días de la prueba se quedaba en
-- `esperando_terminos`: la única guarda de `aceptaciones_terminos` para una aceptación hecha fuera de
-- WhatsApp (`aceptaciones_terminos_modulo()`) exige nombre, cédula y que acepte la persona designada
-- desde su espacio, y los Términos de autoservicio se aceptan antes de que exista contrato, con la
-- casilla del registro (Términos 16.2: «Los acepta, en nombre del Cliente, la persona que marca la
-- casilla del registro en Valida»; casilla v1.2 de Vera).
--
-- ## El canal nuevo: 'registro'
--
-- La evidencia de la aceptación (Términos 16.3: fecha y hora, usuario, correo verificado con código,
-- IP, versión, huella SHA-256 y referencia del medio de pago) YA vive en la fila del registro
-- (`valida_registros`): esta migración la completa con el TEXTO aceptado y la ata al contrato que nace
-- el día 7, sin pedirle a nadie un dato que no dio.
--
--   1. `valida_registros` guarda el texto exacto que la persona leyó y marcó (`aceptado_texto`:
--      Condiciones + aviso + casilla + Términos llenos con su Orden; su sha256 es la
--      `condiciones_sha256` que ya se guardaba) y, aparte, los Términos de su empresa
--      (`terminos_texto`, `terminos_sha256`, `terminos_version`). Una guarda comprueba las huellas al
--      escribir y, desde que hay Términos, deja esa evidencia inmutable.
--   2. `aceptaciones_terminos` admite `canal = 'registro'`, atado a la fila del registro
--      (`valida_registro_id`). Su guarda (`aceptaciones_terminos_registro()`) rechaza toda fila que:
--        a. no apunte a un registro `creado` con Términos aceptados, del MISMO espacio y la MISMA persona;
--        b. no corresponda exactamente a una versión registrada (espacio, título, versión y huellas),
--           de alcance 'cliente', cuyo texto sea EL MISMO que se aceptó en el registro
--           (`texto_sha256 = terminos_sha256`): el documento del día 7 no puede ser otro;
--        c. cuelgue de un negocio que no sea de un contrato de ESA empresa pagado por ese espacio, o cuyo
--           aceptante designado no sea la persona que se registró; o la firme el soporte de MeTRIK;
--        d. traiga una declaración que no sea la casilla que la persona marcó (tiene que estar, tal
--           cual, dentro de `aceptado_texto` como «Casilla: …»);
--        e. repita una aceptación ya registrada del mismo PDF sobre el mismo negocio.
--      Y la BASE pone, desde el registro y no desde el servidor: `respondido_at` (el momento en que se
--      marcó la casilla), la IP, quién acepta (el correo verificado), la razón social y el NIT
--      declarados, la calidad (`autorizado`: quien marca declara facultades, 16.2) y la huella de la
--      declaración.
--
-- No se crea otra tabla: `mis_documentos_de_servicio()`, la puerta de `/valida` y el enrolamiento del
-- cobro ya leen `aceptaciones_terminos` por negocio, así que la aceptación del registro los habilita sin
-- tocarlos.
--
-- ## Qué escribe: DDL y dos funciones. Ni una fila de datos.
--
-- Las filas de `valida_registros` que ya existen quedan con las columnas nuevas en null (la guarda no
-- se activa sobre ellas). Las de `aceptaciones_terminos` cumplen las restricciones nuevas como están
-- (ninguna es del canal 'registro').
--
-- ⚠️ Se aplica ANTES de desplegar el código que la usa (rama feat/valida-epayco-pruebas, #1110): el
-- registro con tarjeta escribe las columnas nuevas y el paso 7a del cron las lee. Sin ellas, el
-- registro con tarjeta de un preview falla y el paso 7a responde error.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'valida_registros'
--      and column_name in ('aceptado_texto', 'terminos_version', 'terminos_texto', 'terminos_sha256');  -> 4
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'aceptaciones_terminos' and column_name = 'valida_registro_id';  -> 1
--   select conname from pg_constraint where conrelid = 'public.aceptaciones_terminos'::regclass
--    and conname in ('aceptaciones_terminos_canal', 'aceptaciones_terminos_registro_completa',
--                    'aceptaciones_terminos_registro_solo_canal');  -> 3
--   select p.proname, p.proacl from pg_proc p
--    where p.pronamespace = 'public'::regnamespace
--      and p.proname in ('aceptaciones_terminos_registro', 'valida_registros_terminos_evidencia');
--     -> SIN anon, authenticated ni PUBLIC
--   select count(*) from public.aceptaciones_terminos where canal = 'registro';  -> 0
--
-- ## Cómo revertir (mientras no haya filas del canal 'registro' ni registros con Términos)
--
--   drop trigger trg_aceptaciones_terminos_registro on public.aceptaciones_terminos;
--   drop function public.aceptaciones_terminos_registro();
--   drop index public.uq_aceptaciones_terminos_registro;
--   alter table public.aceptaciones_terminos
--     drop constraint aceptaciones_terminos_registro_completa,
--     drop constraint aceptaciones_terminos_registro_solo_canal,
--     drop constraint aceptaciones_terminos_canal;
--   alter table public.aceptaciones_terminos
--     add constraint aceptaciones_terminos_canal check (canal in ('whatsapp', 'modulo')),
--     drop column valida_registro_id;
--   drop trigger trg_valida_registros_terminos_evidencia on public.valida_registros;
--   drop function public.valida_registros_terminos_evidencia();
--   alter table public.valida_registros
--     drop column aceptado_texto, drop column terminos_version, drop column terminos_texto, drop column terminos_sha256;
-- ============================================================


-- ── 1. El texto aceptado en el registro ─────────────────────────────────────────────────

alter table public.valida_registros
  add column aceptado_texto text,
  add column terminos_version text,
  add column terminos_texto text,
  add column terminos_sha256 text
    constraint valida_registros_terminos_sha256 check (terminos_sha256 is null or terminos_sha256 ~ '^[0-9a-f]{64}$');

comment on column public.valida_registros.aceptado_texto is
  'Todo lo que la persona leyó y marcó en el registro (Condiciones + aviso + casilla + Términos llenos). Su sha256 es condiciones_sha256. Solo en el registro con tarjeta y Términos.';
comment on column public.valida_registros.terminos_texto is
  'Los Términos de Uso de autoservicio de ESTA empresa (Orden + Términos), tal como se aceptaron. La activación del día 7 registra exactamente este texto.';
comment on column public.valida_registros.terminos_sha256 is
  'sha256 hex de terminos_texto. Es el texto_sha256 que tiene que tener el documento contra el que se registra la aceptación (canal registro).';

-- La guarda de la evidencia del registro. SIN security definer: no lee nada fuera de la fila.
create or replace function public.valida_registros_terminos_evidencia()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Desde que hay Términos aceptados, lo que prueba la aceptación no se reescribe. `workspace_id` no
  -- entra: su llave foránea lo pone en null si el espacio se borra.
  if tg_op = 'UPDATE' and old.terminos_sha256 is not null and (
       new.aceptado_texto      is distinct from old.aceptado_texto
    or new.terminos_version    is distinct from old.terminos_version
    or new.terminos_texto      is distinct from old.terminos_texto
    or new.terminos_sha256     is distinct from old.terminos_sha256
    or new.condiciones_version is distinct from old.condiciones_version
    or new.condiciones_sha256  is distinct from old.condiciones_sha256
    or new.aceptado_at         is distinct from old.aceptado_at
    or new.usuario_id          is distinct from old.usuario_id
    or new.correo              is distinct from old.correo
    or new.ip                  is distinct from old.ip
    or new.razon_social        is distinct from old.razon_social
    or new.identificacion      is distinct from old.identificacion
    or new.dv                  is distinct from old.dv
    or new.recomendado_afi     is distinct from old.recomendado_afi
  ) then
    raise exception 'valida_registros %: los Términos aceptados en el registro y su evidencia no se reescriben', old.id;
  end if;

  if new.aceptado_texto is null and new.terminos_version is null and new.terminos_texto is null and new.terminos_sha256 is null then
    return new;
  end if;

  -- Las cuatro juntas, en un registro creado, y con huellas que son las de sus textos.
  if new.aceptado_texto is null or new.terminos_version is null or new.terminos_texto is null or new.terminos_sha256 is null
     or new.estado <> 'creado' or new.condiciones_sha256 is null or new.aceptado_at is null then
    raise exception 'valida_registros %: los Términos del registro van completos (texto aceptado, versión, texto y huella) y solo en un registro creado', new.id;
  end if;
  if encode(sha256(convert_to(new.terminos_texto, 'UTF8')), 'hex') <> new.terminos_sha256 then
    raise exception 'valida_registros %: terminos_sha256 no es la huella de terminos_texto', new.id;
  end if;
  if encode(sha256(convert_to(new.aceptado_texto, 'UTF8')), 'hex') <> new.condiciones_sha256 then
    raise exception 'valida_registros %: condiciones_sha256 no es la huella de aceptado_texto', new.id;
  end if;
  if position(new.terminos_texto in new.aceptado_texto) = 0 then
    raise exception 'valida_registros %: los Términos no están dentro de lo que se aceptó', new.id;
  end if;
  return new;
end;
$$;

create trigger trg_valida_registros_terminos_evidencia
  before insert or update on public.valida_registros
  for each row execute function public.valida_registros_terminos_evidencia();

revoke execute on function public.valida_registros_terminos_evidencia() from public, anon, authenticated;


-- ── 2. El canal 'registro' en aceptaciones_terminos ────────────────────────────────────

alter table public.aceptaciones_terminos
  add column valida_registro_id uuid references public.valida_registros(id);

comment on column public.aceptaciones_terminos.valida_registro_id is
  'Canal registro: la fila de valida_registros donde se marcó la casilla. De ella salen la hora, la IP, el correo verificado y el texto aceptado.';

alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_canal;
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_canal check (canal in ('whatsapp', 'modulo', 'registro'));

comment on column public.aceptaciones_terminos.canal is
  'Por dónde se aceptó: whatsapp (wa-webhook), modulo (/valida-api, persona designada o dueño del espacio) o registro (casilla del registro autogestionado de Valida, valida_registro_id).';

-- Solo el canal registro apunta a un registro.
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_registro_solo_canal check (canal = 'registro' or valida_registro_id is null);

-- Una fila del registro nace aceptada, con toda su evidencia y sin nada de WhatsApp ni de cédula.
alter table public.aceptaciones_terminos
  add constraint aceptaciones_terminos_registro_completa check (
    canal <> 'registro'
    or (
      estado = 'aceptado'
      and calidad = 'autorizado'
      and negocio_id is not null
      and usuario_id is not null
      and workspace_cliente_id is not null
      and documento_version_id is not null
      and valida_registro_id is not null
      and texto_documento_sha256 is not null
      and texto_aceptacion_sha256 is not null
      and respondido_at is not null
      and nullif(btrim(empresa_nombre), '') is not null
      and nullif(btrim(empresa_nit), '') is not null
      and cedula_aceptante is null
      and telefono is null
      and prompt_wamid is null
      and reply_wamid is null
      and button_id is null
      and payload_respuesta is null
      and enviado_at is null
    )
  );

-- Dos corridas del cron a la vez: la segunda rebota aquí aunque las dos pasen la comprobación previa.
create unique index uq_aceptaciones_terminos_registro
  on public.aceptaciones_terminos (negocio_id, documento_sha256)
  where canal = 'registro' and estado = 'aceptado';


-- ── 3. La guarda del canal registro ─────────────────────────────────────────────────────

create or replace function public.aceptaciones_terminos_registro()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_reg record;
  v_doc record;
  v_designado uuid;
  v_admin boolean;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
begin
  if new.canal is distinct from 'registro' then
    return new;
  end if;

  -- (a) El registro: creado, con Términos aceptados, del mismo espacio y la misma persona.
  select r.id, r.estado, r.workspace_id, r.usuario_id, r.correo, r.ip, r.razon_social, r.identificacion,
         r.dv, r.aceptado_at, r.aceptado_texto, r.terminos_version, r.terminos_sha256
    into v_reg
    from public.valida_registros r
   where r.id = new.valida_registro_id;
  if not found or v_reg.estado <> 'creado' or v_reg.terminos_sha256 is null or v_reg.aceptado_texto is null then
    raise exception 'aceptaciones_terminos: el registro % no tiene Términos aceptados', new.valida_registro_id;
  end if;
  if v_reg.workspace_id is distinct from new.workspace_cliente_id or v_reg.usuario_id is distinct from new.usuario_id then
    raise exception 'aceptaciones_terminos: el registro % es de otro espacio o de otra persona', v_reg.id;
  end if;

  -- (b) La versión registrada, de ESTA empresa, y con el mismo texto que se aceptó en el registro.
  select d.id, d.workspace_id, d.alcance, d.empresa_id, d.titulo, d.version, d.texto_sha256, d.pdf_sha256, d.vigente_hasta
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
    raise exception 'aceptaciones_terminos: lo aceptado no coincide con la versión % (espacio, título, versión o huellas)', v_doc.id;
  end if;
  if v_doc.alcance <> 'cliente' then
    raise exception 'aceptaciones_terminos: la versión % no es de una empresa', v_doc.id;
  end if;
  if v_doc.texto_sha256 is distinct from v_reg.terminos_sha256 or v_doc.version is distinct from v_reg.terminos_version then
    raise exception 'aceptaciones_terminos: la versión % no es el texto que se aceptó en el registro %', v_doc.id, v_reg.id;
  end if;
  if v_doc.vigente_hasta is not null and v_doc.vigente_hasta < v_hoy then
    raise exception 'aceptaciones_terminos: la versión % no está vigente hoy', v_doc.id;
  end if;

  -- (c) El contrato de esa empresa, pagado por ese espacio, con la persona del registro como designada.
  select sc.aceptante_designado_id
    into v_designado
    from public.servicios_contratados sc
   where sc.negocio_id = new.negocio_id
     and sc.empresa_id = v_doc.empresa_id
     and sc.workspace_pagador_id = new.workspace_cliente_id
   order by (sc.estado = 'activo') desc, sc.vigente_desde desc
   limit 1;
  if not found then
    raise exception 'aceptaciones_terminos: el negocio % no es de un contrato de esta empresa pagado por el espacio %',
      new.negocio_id, new.workspace_cliente_id;
  end if;
  if v_designado is distinct from new.usuario_id then
    raise exception 'aceptaciones_terminos: estos términos los aceptó en el registro una persona que el contrato no designa';
  end if;
  select coalesce(p.platform_admin, false) into v_admin from public.profiles p where p.id = new.usuario_id;
  if coalesce(v_admin, false) then
    raise exception 'aceptaciones_terminos: el soporte de MeTRIK no acepta términos por un cliente';
  end if;

  -- (d) La declaración es la casilla que se marcó, tal cual quedó en lo aceptado.
  if new.texto_aceptacion is null or position(('Casilla: ' || new.texto_aceptacion) in v_reg.aceptado_texto) = 0 then
    raise exception 'aceptaciones_terminos: la declaración no es la casilla que se marcó en el registro %', v_reg.id;
  end if;

  -- (e) Lo ya aceptado sobre este contrato, por cualquier canal, no se vuelve a aceptar.
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

  -- La evidencia la pone la base, desde el registro.
  new.respondido_at := v_reg.aceptado_at;
  new.nombre_aceptante := v_reg.correo;
  new.empresa_nombre := v_reg.razon_social;
  new.empresa_nit := v_reg.identificacion || coalesce('-' || v_reg.dv, '');
  new.calidad := 'autorizado';
  begin
    new.ip := nullif(btrim(v_reg.ip), '')::inet;
  exception when others then
    new.ip := null;
  end;
  new.texto_aceptacion_sha256 := encode(sha256(convert_to(new.texto_aceptacion, 'UTF8')), 'hex');
  return new;
end;
$$;

create trigger trg_aceptaciones_terminos_registro
  before insert on public.aceptaciones_terminos
  for each row execute function public.aceptaciones_terminos_registro();

-- PostgreSQL no exige EXECUTE para disparar un trigger, solo para crearlo: el revoke no la apaga.
revoke execute on function public.aceptaciones_terminos_registro() from public, anon, authenticated;
