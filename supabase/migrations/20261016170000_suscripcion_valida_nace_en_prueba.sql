-- ============================================================
-- 20261016170000 — La suscripción de Valida nace EN PRUEBA al registrarse; la activación la pasa a activa
--
-- Mauricio (2026-10-16, probando como cliente nuevo en `cda-pruebas-futuras`): la sección Suscripción
-- tiene que verse desde el registro (plan en prueba, consultas, fecha y valor del primer cobro, tarjeta,
-- cancelar), y no solo desde que hay contrato.
--
-- Desde esta migración el registro autogestionado crea la fila de `suscripciones_producto` con
-- `estado = 'prueba'` (lo hace `asegurarSuscripcionEnPrueba`, con service_role; el estado ya lo admitía
-- el CHECK de 20261016100000, no hay DDL). Lo que cambia es `valida_activar_autogestion` (de
-- 20261016100100), que antes la INSERTABA siempre como 'activa' y ahora:
--
--   1. si el espacio tiene su suscripción EN PRUEBA, la bloquea y la pasa a 'activa' con lo de hoy
--      (RUT, tarjeta, plan, origen, fecha de activación): los tres caminos (consulta 11, «Activar plan»,
--      día 7) dejan UNA sola fila, la misma que nació en el registro;
--   2. si no la tiene (un registro anterior a esto), la inserta como antes;
--   3. la regla «un NIT con suscripción viva de Valida no recibe otra» ya no cuenta la de ESTE espacio
--      (sin esto, la fila en prueba haría responder `nit_con_contrato` a su propia activación).
-- El resto del cuerpo es el de 20261016100100, sin un cambio.
--
-- Sin esta migración y con el código nuevo desplegado, la activación de un registro con fila en
-- prueba responde `nit_con_contrato` y NO activa: aplicar ANTES del merge.
--
-- Reversa: volver a correr la definición de `valida_activar_autogestion` de 20261016100100 (sección 3
-- de ese archivo; `sql/suscripciones-producto/reversa-20261016-170000.sql` la trae lista). Las filas
-- 'prueba' que ya existan quedan: con la reversa su activación respondería `nit_con_contrato`, así que
-- antes se cancelan (`update … set estado = 'cancelada', cancelada_at = now(), cancelacion_motivo =
-- 'reversa 20261016170000' where estado = 'prueba'`).
-- ============================================================

create or replace function public.valida_activar_autogestion(
  p_workspace_cliente uuid,
  p_usuario uuid,
  p_cobrador uuid,
  p_linea uuid,
  -- Ya no se usa: el contrato no tiene negocio ni etapa. Se queda en la firma para no cambiar la llamada.
  p_etapa uuid,
  p_servicio_slug text,
  p_parametros jsonb,
  p_terminos_plazo_hasta date,
  -- { slug, titulo, version, texto_md, texto_sha256, pdf_path, pdf_sha256 }
  p_documento jsonb,
  -- null, o { veredicto: coincide|no_coincide|ilegible, documento_path, confianza }
  p_rut jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_reg record;
  v_ws record;
  v_ficha record;
  v_nit text;
  v_nit_dv text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_suscripcion uuid;
  v_doc uuid;
  v_sc uuid;
  v_vivo uuid;
  v_texto text := p_documento ->> 'texto_md';
  v_cambios jsonb;
  v_rut_ok boolean := coalesce(p_rut ->> 'veredicto', '') = 'coincide';
  v_rut_veredicto text := coalesce(nullif(p_rut ->> 'veredicto', ''), 'sin_rut');
  v_con_tarjeta boolean;
begin
  -- 1. El registro del espacio, bloqueado: dos clics a la vez se ordenan aquí.
  select r.* into v_reg
    from public.valida_registros r
   where r.workspace_id = p_workspace_cliente and r.estado = 'creado'
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'sin_registro');
  end if;

  select w.id, w.slug into v_ws from public.workspaces w where w.id = p_workspace_cliente;

  -- 2. Quien activa es del espacio.
  if not exists (select 1 from public.profiles p where p.id = p_usuario and p.workspace_id = p_workspace_cliente) then
    return jsonb_build_object('ok', false, 'error', 'usuario_ajeno');
  end if;

  -- 3. Ya activo: idempotente.
  select sc.id into v_vivo
    from public.servicios_contratados sc
    join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
   where sc.workspace_pagador_id = p_workspace_cliente
     and cs.modulo = 'valida_consulta'
     and sc.estado not in ('cancelado', 'terminado')
   limit 1;
  if found then
    return jsonb_build_object('ok', true, 'resultado', 'ya_activo', 'contrato_id', v_vivo);
  end if;

  -- 4. La ficha.
  select cs.slug, cs.version_vigente, cs.modulo, cs.disparador_cobro into v_ficha
    from public.catalogo_servicios cs
   where cs.slug = p_servicio_slug and cs.activo;
  if not found or v_ficha.modulo <> 'valida_consulta' or v_ficha.disparador_cobro <> 'ciclo' then
    return jsonb_build_object('ok', false, 'error', 'ficha_invalida');
  end if;

  -- 6. Las huellas.
  if v_texto is null or length(btrim(v_texto)) = 0
     or encode(sha256(convert_to(v_texto, 'UTF8')), 'hex') <> (p_documento ->> 'texto_sha256')
     or coalesce(p_documento ->> 'pdf_sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(btrim(p_documento ->> 'pdf_path'), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'documento_invalido');
  end if;
  if jsonb_typeof(p_parametros) <> 'object' then
    return jsonb_build_object('ok', false, 'error', 'parametros_invalidos');
  end if;

  -- 5. El NIT: ¿ya es de un cliente con contrato vivo de Valida? Por dígitos, con o sin DV (así lo
  --    guardaron las cargas de los CDA: '900156521-0').
  v_nit := regexp_replace(coalesce(v_reg.identificacion, ''), '[^0-9]', '', 'g');
  v_nit_dv := v_nit || coalesce('-' || v_reg.dv, '');
  if exists (
    select 1
      from public.empresas e
      join public.servicios_contratados sc on sc.empresa_id = e.id
      join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
     where e.workspace_id = p_cobrador
       and regexp_replace(coalesce(e.numero_documento, ''), '[^0-9]', '', 'g') in (v_nit, v_nit || coalesce(v_reg.dv, ''))
       and cs.modulo = 'valida_consulta'
       and sc.estado not in ('cancelado', 'terminado')
  ) or exists (
    select 1
      from public.suscripciones_producto s
     where s.workspace_id = p_cobrador
       and s.producto = 'valida'
       and s.numero_documento = v_nit
       and s.estado <> 'cancelada'
       -- 20261016170000: la suscripción EN PRUEBA de este mismo espacio es la que se activa, no otra.
       and s.workspace_cliente_id <> p_workspace_cliente
  ) then
    return jsonb_build_object('ok', false, 'error', 'nit_con_contrato');
  end if;

  -- La suscripción: la empresa declarada vive aquí, no en el directorio del cobrador.
  v_con_tarjeta := v_reg.metodo_pago_estado = 'registrado' and coalesce(v_reg.metodo_pago_ref, '') like 'epayco:%';
  -- 20261016170000: la suscripción nace EN PRUEBA al registrarse (`asegurarSuscripcionEnPrueba`). Si
  -- está, se ACTIVA esa misma fila (bloqueada: dos caminos a la vez se ordenan aquí) con lo de hoy; si
  -- no (un registro anterior al 16-oct sin la fila), se crea como antes.
  select s.id into v_suscripcion
    from public.suscripciones_producto s
   where s.workspace_id = p_cobrador
     and s.producto = 'valida'
     and s.workspace_cliente_id = p_workspace_cliente
     and s.estado = 'prueba'
   for update;
  if found then
    update public.suscripciones_producto s set
      nombre = 'Valida — ' || v_reg.razon_social,
      razon_social = v_reg.razon_social,
      tipo_documento = 'NIT',
      numero_documento = v_nit,
      dv = v_reg.dv,
      correo_facturacion = v_reg.correo,
      rut_veredicto = v_rut_veredicto,
      empresa_verificada = v_rut_ok,
      rut_documento_path = p_rut ->> 'documento_path',
      rut_confianza = nullif(p_rut ->> 'confianza', '')::numeric,
      plan_slug = v_ficha.slug,
      estado = 'activa',
      prueba_desde = coalesce(s.prueba_desde, v_reg.aceptado_at),
      prueba_hasta = coalesce(s.prueba_hasta, v_reg.prueba_vence_en),
      activada_at = now(),
      origen_comercial = v_reg.origen,
      origen_fuente = v_reg.origen_fuente,
      valida_registro_id = v_reg.id,
      metodo_pago_pasarela = case when v_con_tarjeta then 'epayco' end,
      metodo_pago_ref = case when v_con_tarjeta then v_reg.metodo_pago_ref end,
      metadata = s.metadata || jsonb_build_object('origen', 'valida_autogestion', 'workspace_one', v_ws.slug, 'fuente', 'registro autogestionado de Valida')
     where s.id = v_suscripcion;
  else
    insert into public.suscripciones_producto (
      workspace_id, producto, workspace_cliente_id, nombre, razon_social, tipo_documento, numero_documento, dv,
      correo_facturacion, rut_veredicto, empresa_verificada, rut_documento_path, rut_confianza,
      plan_slug, estado, prueba_desde, prueba_hasta, activada_at,
      origen_comercial, origen_fuente, valida_registro_id,
      metodo_pago_pasarela, metodo_pago_ref, metadata, creado_por
    ) values (
      p_cobrador, 'valida', p_workspace_cliente, 'Valida — ' || v_reg.razon_social, v_reg.razon_social, 'NIT', v_nit, v_reg.dv,
      v_reg.correo, v_rut_veredicto, v_rut_ok, p_rut ->> 'documento_path', nullif(p_rut ->> 'confianza', '')::numeric,
      v_ficha.slug, 'activa', v_reg.aceptado_at, v_reg.prueba_vence_en, now(),
      v_reg.origen, v_reg.origen_fuente, v_reg.id,
      case when v_con_tarjeta then 'epayco' end, case when v_con_tarjeta then v_reg.metodo_pago_ref end,
      -- `origen` es la marca que decide la factura electrónica automática (`ORIGENES_AUTOMATICOS` de
      -- facturacion-electronica): la misma que llevaba el negocio de esta activación hasta 20261016.
      jsonb_build_object('origen', 'valida_autogestion', 'workspace_one', v_ws.slug, 'fuente', 'registro autogestionado de Valida'),
      p_usuario
    )
    returning id into v_suscripcion;
  end if;

  -- Los Términos de ESA suscripción. La huella del PDF es única: si ya está registrada, es de otro
  -- cliente (o de una suscripción anterior de este, ya cancelada) y no se cuelga aquí. Lo resuelve una
  -- persona; la transacción entera se deshace.
  if exists (select 1 from public.documentos_contractuales_versiones d where d.pdf_sha256 = p_documento ->> 'pdf_sha256') then
    raise exception 'valida_activar_autogestion %: el PDF de los Términos ya está registrado en otro contrato', v_ws.slug;
  end if;
  insert into public.documentos_contractuales_versiones (
    workspace_id, linea_id, slug, alcance, empresa_id, suscripcion_id, titulo, version, texto_md, texto_sha256,
    pdf_path, pdf_sha256, vigente_desde, registrado_por
  ) values (
    p_cobrador, p_linea, p_documento ->> 'slug', 'cliente', null, v_suscripcion, p_documento ->> 'titulo',
    p_documento ->> 'version', v_texto, p_documento ->> 'texto_sha256',
    p_documento ->> 'pdf_path', p_documento ->> 'pdf_sha256', v_hoy, p_usuario
  )
  returning id into v_doc;

  update public.suscripciones_producto
     set terminos_documento_id = v_doc,
         terminos_version = p_documento ->> 'version',
         terminos_sha256 = p_documento ->> 'texto_sha256'
   where id = v_suscripcion;

  -- El contrato, colgado de la suscripción: sin negocio y sin empresa del directorio.
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, suscripcion_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    p_cobrador, null, null, v_suscripcion, v_ficha.slug, v_ficha.version_vigente,
    p_parametros || jsonb_build_object('origen', v_reg.origen, 'origen_fuente', v_reg.origen_fuente),
    p_workspace_cliente, v_reg.correo, 'activo', v_hoy, null,
    -- La comisión de AFI en autoservicio espera la decisión de Carmen y Mauricio (§3.2 y §3.4). El
    -- origen queda en la suscripción y en los parámetros para escribirla cuando se decida.
    null,
    false, p_usuario, p_usuario, p_terminos_plazo_hasta
  )
  returning id into v_sc;

  insert into public.servicio_contratado_beneficiarios (servicio_contratado_id, workspace_id)
  values (v_sc, p_workspace_cliente);

  insert into public.servicios_contratados_cambios (servicio_contratado_id, campo, valor_anterior, valor_nuevo, motivo, registrado_por)
  values (
    v_sc, 'alta', null,
    jsonb_build_object(
      'parametros', p_parametros,
      'workspace_pagador_id', p_workspace_cliente,
      'aceptante_designado_id', p_usuario,
      'terminos_plazo_hasta', p_terminos_plazo_hasta,
      'terminos_documento_id', v_doc,
      'suscripcion_id', v_suscripcion,
      'origen', v_reg.origen,
      'rut_veredicto', v_rut_veredicto
    ),
    'Activación autogestionada del plan de Valida desde la prueba gratis (espacio ' || v_ws.slug || '): '
      || v_reg.razon_social || ', NIT ' || v_nit_dv || '.',
    p_usuario
  );

  insert into public.suscripciones_producto_eventos (suscripcion_id, workspace_id, tipo, detalle, datos, origen, autor_id)
  values (
    v_suscripcion, p_cobrador, 'alta',
    'Plan de Valida activado desde la prueba gratis (espacio ' || v_ws.slug || '): ' || v_reg.razon_social || ', NIT ' || v_nit_dv || '.',
    jsonb_build_object('contrato_id', v_sc, 'documento_id', v_doc, 'rut_veredicto', v_rut_veredicto, 'con_tarjeta', v_con_tarjeta),
    'valida_activar_autogestion', p_usuario
  );

  -- El módulo: la activación apunta al contrato. El espacio de la prueba ya tenía la llave de módulo
  -- en `workspaces.modules` sin fila aquí; con esta fila la proyección no cambia nada.
  insert into public.workspace_modulos (workspace_id, modulo, origen, servicio_contratado_id, activo_desde, motivo, registrado_por)
  values (
    p_workspace_cliente, 'valida_consulta', 'servicio', v_sc, now(),
    'Plan de Valida activado por la persona desde la prueba gratis (registro autogestionado).', p_usuario
  );

  v_cambios := public.proyectar_modulos(p_workspace_cliente) -> 'cambios';
  if jsonb_array_length(v_cambios) > 0 then
    raise exception 'valida_activar_autogestion %: la proyección de módulos cambiaría el espacio: %', v_ws.slug, v_cambios;
  end if;

  return jsonb_build_object(
    'ok', true, 'resultado', 'activado',
    'contrato_id', v_sc, 'suscripcion_id', v_suscripcion, 'documento_id', v_doc
  );
end;
$$;

-- server-only: la llama `src/lib/valida-registro/activacion-servidor.ts` con service_role.
revoke execute on function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb)
  to service_role;

comment on function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb) is
  'Activa el plan de una cuenta autogestionada de Valida como SUSCRIPCIÓN (suscripciones_producto; la fila EN PRUEBA del registro pasa a activa, o se crea si no existe): Términos de la suscripción, contrato colgado de ella con designada y plazo, y módulo. Sin empresa en el directorio ni negocio del CRM. Idempotente (ya_activo). No acepta los términos.';
