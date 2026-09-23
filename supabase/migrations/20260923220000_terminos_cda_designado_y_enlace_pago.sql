-- ============================================================
-- 20260923220000 — Los CDA aceptan sus términos en ONE: quién firma y dónde vive el enlace de pago
--
-- Los 4 CDA (cda-caqueta, cda-elcarmen, cda-puertotest, maxitec) dejan de ser clientes de AFI y
-- pasan a contrato directo con METRIK IA S.A.S. (actas de terminación v3, 2026-09-23). Antes de
-- seguir usando Valida, la persona que la empresa designe acepta en la plataforma los Términos de
-- Suscripción VALIDA · Licencia CDA v1.1 (cláusula 16) y después ve su cuota con un botón de pago.
--
-- Se reutiliza lo que ya existe para 4D SOFT: un contrato por CDA en `servicios_contratados`, la
-- versión de sus términos en `documentos_contractuales_versiones`, la constancia en
-- `aceptaciones_terminos` (canal módulo) y las RPC cerradas de C2. Esta migración agrega solo lo
-- que ese modelo no traía.
--
-- ## Qué escribe: DDL y funciones. Ni una fila de datos.
--
-- Los contratos, las versiones de los términos, las personas designadas y los enlaces de Bold son
-- datos de producción y van aparte (`sql/valida-cda/`), para que los aplique la sesión principal.
-- Sin esos datos esta migración no cambia nada visible: ningún contrato tiene persona designada,
-- ninguna cuota tiene enlace y ningún CDA tiene contrato.
--
-- ## Las cuatro piezas
--
--   1. `servicios_contratados.aceptante_designado_id` — la persona que acepta los términos por la
--      empresa. En tres de los cuatro CDA el dueño del espacio es una cuenta genérica («Oficial de
--      Cumplimiento»), y la cláusula 16.1 exige al representante legal o a un apoderado: la regla
--      «acepta el owner» de 4D SOFT no sirve. NULL conserva esa regla (4D SOFT no cambia).
--   2. `cobros.enlace_pago_url` y `cobros.enlace_pago_expira` — el enlace de pago de una cuota,
--      en el COBRO PROGRAMADO de esa cuota (el de `plan_cobro_id` + `numero_cuota`). Es la fila
--      donde el ciclo de suscripciones ya anota el intento de la pasarela (`external_ref` = id del
--      link, `anotarIntentoEnCobro`), y donde el adaptador `bold-link` de la Fase 2 va a dejar su
--      `linkPago` y su `expira` (`ResultadoCargo` en `src/lib/suscripciones/pasarela/adapter.ts`).
--      Hoy Bold no cobra recurrente y Mauricio crea el enlace a mano en su panel (el 20, vence el
--      27); se carga en la misma fila. Así el botón «Pagar» del CDA lee UN solo lugar y no cambia
--      cuando el enlace pase de manual a automático.
--   3. `aceptaciones_terminos_modulo()` — la guarda de la base aprende la designación: si el
--      contrato designó a alguien, solo esa persona acepta, desde el espacio del cliente y sin ser
--      soporte de MeTRIK; si no, sigue la regla del dueño. El resto del cuerpo no cambia.
--   4. `mis_cuotas_de_servicio(uuid)` — la cuarta RPC cerrada: las cuotas del contrato
--      (`plan_cobro_cuotas`: monto, vencimiento, período) con el enlace de su cobro programado,
--      solo para el espacio que paga. Es la única vía por la que un CDA lee esas tablas, que viven
--      en el workspace metrik (§3.6 de la spec de servicios).
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select table_name, column_name from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'servicios_contratados' and column_name = 'aceptante_designado_id')
--        or (table_name = 'cobros' and column_name in ('enlace_pago_url', 'enlace_pago_expira')));
--     -> 3 filas
--   select p.proname, p.prosecdef, p.proconfig, p.proacl from pg_proc p
--     join pg_namespace n on n.oid = p.pronamespace
--    where n.nspname = 'public' and p.proname in ('mis_cuotas_de_servicio', 'aceptaciones_terminos_modulo');
--     -> mis_cuotas_de_servicio: prosecdef = true, authenticated=X y SIN anon ni =X/ (PUBLIC)
--     -> aceptaciones_terminos_modulo: SIN anon, authenticated ni PUBLIC
--   select count(*) from public.servicios_contratados where aceptante_designado_id is not null;  -> 0
--   select count(*) from public.cobros where enlace_pago_url is not null;                       -> 0
--
-- ## Cómo revertir (antes de cargar designaciones o enlaces)
--
--   drop function public.mis_cuotas_de_servicio(uuid);
--   alter table public.cobros drop column enlace_pago_url, drop column enlace_pago_expira;
--   -- re-crear aceptaciones_terminos_modulo() con el cuerpo de 20260917014500
--   alter table public.servicios_contratados drop column aceptante_designado_id;
-- ============================================================


-- ── 1. La persona que acepta por la empresa ─────────────────────────────────────────────

alter table public.servicios_contratados
  add column aceptante_designado_id uuid references public.profiles(id);

comment on column public.servicios_contratados.aceptante_designado_id is
  'Perfil que acepta los términos del contrato por la empresa (representante legal o apoderado, cláusula 16.1). NULL = los acepta el owner del espacio del cliente. Cambiarlo se anota en servicios_contratados_cambios.';


-- ── 2. El enlace de pago de cada cuota, en su cobro programado ──────────────────────────

-- `cobros` ya es de lectura del workspace metrik (RLS por workspace) y el cliente no la lee
-- directo: las columnas nuevas heredan las dos cosas. El CHECK exige https y un largo sensato; qué
-- dominio se acepta como pasarela lo decide la pantalla, que no pinta el botón con otro.
-- Agregar columnas nulas no reescribe la tabla ni toca las vistas que la leen (listas explícitas).
alter table public.cobros
  add column enlace_pago_url text
    constraint cobros_enlace_pago_https
      check (
        enlace_pago_url is null
        or (enlace_pago_url ~ '^https://[^[:space:]]+$' and char_length(enlace_pago_url) <= 500)
      ),
  add column enlace_pago_expira timestamptz;

comment on column public.cobros.enlace_pago_url is
  'Enlace de pago de la cuota de este cobro programado. Hoy lo carga MeTRIK a mano (Bold no cobra recurrente); con el adaptador bold-link lo escribe el ciclo de suscripciones con el linkPago de la pasarela. Lo ve el cliente pagador por mis_cuotas_de_servicio().';
comment on column public.cobros.enlace_pago_expira is
  'Hasta cuándo sirve el enlace de pago (el expira de la pasarela). Vencido, el cliente no ve el botón.';


-- ── 3. La guarda del canal módulo, con la designación ───────────────────────────────────
--
-- Cuerpo de 20260917014500 con UN cambio, en el paso (3). Los mensajes de error que ya existían
-- se conservan tal cual: las pruebas y el servidor los reconocen.

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

  -- (3) Lo acepta la persona que el contrato designó; si no designó a nadie, el dueño del espacio.
  --     En los dos casos desde el espacio del cliente, y nunca el soporte de MeTRIK.
  --
  --     El contrato se elige con el MISMO orden que usa el servidor para colgar la constancia
  --     (`versionContratada`): el activo primero y, entre iguales, el de vigencia más reciente.
  select sc.aceptante_designado_id
    into v_designado
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


-- ── 4. Las cuotas del contrato, para el espacio que paga ────────────────────────────────

create or replace function public.mis_cuotas_de_servicio(p_servicio_contratado_id uuid)
returns table (
  numero integer,
  tipo text,
  monto numeric,
  fecha_vencimiento date,
  concepto text,
  enlace_pago_url text,
  enlace_pago_expira timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    q.numero,
    q.tipo,
    q.monto,
    q.fecha_vencimiento,
    q.concepto_detalle,
    c.enlace_pago_url,
    c.enlace_pago_expira
  from public.servicios_contratados sc
  -- Los planes del negocio del contrato, en el workspace del cobrador. Encendidos o no: los de
  -- los CDA están apagados (el emisor no emite hasta la factura electrónica) y sus cuotas igual
  -- son lo que el cliente debe.
  join public.planes_cobro p
    on p.negocio_id = sc.negocio_id
   and p.workspace_id = sc.workspace_id
  join public.plan_cobro_cuotas q on q.plan_cobro_id = p.id
  -- El enlace vive en el cobro programado de ESA cuota (único por plan y número). Un cobro
  -- anulado no ofrece enlace: su cuota se volvió a pedir o ya no se debe.
  left join public.cobros c
    on c.plan_cobro_id = p.id
   and c.numero_cuota = q.numero
   and c.anulado_at is null
  where sc.id = p_servicio_contratado_id
    and public.current_user_workspace_id() is not null
    -- Solo el pagador, igual que `mis_cobros_de_servicio`: un beneficiario que no paga no ve la
    -- plata de otro.
    and sc.workspace_pagador_id = public.current_user_workspace_id()
  order by q.fecha_vencimiento, q.numero;
$$;

comment on function public.mis_cuotas_de_servicio(uuid) is
  'Cuotas del contrato (monto, vencimiento, período) con el enlace de pago de su cobro programado, con lista cerrada de campos y solo para el workspace que paga. Nunca salen las notas del plan, las del cobro ni negocios.metadata.';

-- ejecutable-por-cliente: la invoca el servidor con el cliente de SESIÓN (tarjeta de pago de
-- /valida) y el filtro por workspace vive dentro de la función, no en el guard del action.
revoke execute on function public.mis_cuotas_de_servicio(uuid) from public, anon;
grant  execute on function public.mis_cuotas_de_servicio(uuid) to authenticated;
