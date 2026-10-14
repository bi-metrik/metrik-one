-- ============================================================
-- 20261012100000 — Activar el plan de una cuenta autogestionada de Valida, en una transacción
--
-- Spec: `proyectos/metrik/valida/docs/crecimiento-mrr/18-recorrido-baja-friccion.md` §2.2 y §4 (PR 6).
-- Patrón: el bloque de cada CDA de `sql/valida-cda/2026-09-23_contratos-y-terminos-cdas.sql`, que
-- hacía esto mismo a mano: empresa y negocio en el espacio que cobra (metrik), los términos de ESA
-- empresa, el contrato con su persona designada y su plazo, y el módulo apuntando al contrato.
--
-- ## Qué escribe: DDL de UNA función. Ni una fila de datos.
--
-- La función la llama solo el servidor (`activacion-servidor.ts`, con service_role) cuando la persona
-- dueña de un espacio nacido en `/valida/empezar` oprime «Activar plan». Sin ese clic no corre.
--
-- ## Las reglas que vuelve a comprobar con las filas bloqueadas
--
--   1. El espacio nació en el registro autogestionado: tiene su fila `creado` en `valida_registros`
--      (de ahí salen la razón social, el NIT y el correo; nada del cuerpo los decide).
--   2. Quien activa es un perfil de ESE espacio.
--   3. El espacio no tiene ya un contrato vivo de Valida: si lo tiene, responde `ya_activo` sin
--      escribir (el segundo clic, o dos pestañas).
--   4. La ficha del catálogo existe, está activa, es de `valida_consulta` y se cobra por ciclo.
--   5. Si el NIT ya es de una empresa del cobrador con un contrato vivo de Valida (un cliente de
--      hoy, p. ej. uno de los 4 CDA, que se registró a probar), NO se le cuelga otro contrato:
--      responde `nit_con_contrato` y lo resuelve una persona (§5, «suplantación»).
--   6. La huella del texto de los términos es la de su texto (`sha256`), y el PDF trae la suya.
--
-- ## Lo que deja
--
--   empresa (la del NIT si ya existía sin contrato vivo; si no, una nueva con el RUT si se leyó),
--   negocio en la línea Valida, documento de términos alcance 'cliente' (de ESA empresa: un
--   'plantilla' de valida_consulta lo verían los 4 CDA, ver `20260929030000`), contrato `activo` con
--   la persona como designada y el plazo para aceptar, beneficiario, bitácora de alta y la activación
--   del módulo apuntando al contrato. La aceptación de los términos NO: la da la persona en la
--   entrada de `/valida`, con la constancia de siempre (`aceptaciones_terminos_modulo`).
--
-- ## Reversa
--   drop function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb);
-- ============================================================

create or replace function public.valida_activar_autogestion(
  p_workspace_cliente uuid,
  p_usuario uuid,
  p_cobrador uuid,
  p_linea uuid,
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
  v_nit_dv text;
  v_hoy date := (now() at time zone 'America/Bogota')::date;
  v_empresa uuid;
  v_empresa_nueva boolean := false;
  v_negocio uuid;
  v_doc uuid;
  v_sc uuid;
  v_vivo uuid;
  v_texto text := p_documento ->> 'texto_md';
  v_cambios jsonb;
  v_rut_ok boolean := coalesce(p_rut ->> 'veredicto', '') = 'coincide';
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

  -- 5. La empresa del NIT en el cobrador. El NIT se compara por dígitos, con o sin DV: así lo
  --    guardaron las cargas de los CDA ('900156521-0').
  v_nit_dv := v_reg.identificacion || coalesce('-' || v_reg.dv, '');
  select e.id into v_empresa
    from public.empresas e
   where e.workspace_id = p_cobrador
     and regexp_replace(coalesce(e.numero_documento, ''), '[^0-9]', '', 'g')
         in (v_reg.identificacion, v_reg.identificacion || coalesce(v_reg.dv, ''))
   order by e.created_at nulls last
   limit 1;
  if found then
    if exists (
      select 1 from public.servicios_contratados sc
        join public.catalogo_servicios cs on cs.slug = sc.servicio_slug
       where sc.empresa_id = v_empresa and cs.modulo = 'valida_consulta'
         and sc.estado not in ('cancelado', 'terminado')
    ) then
      return jsonb_build_object('ok', false, 'error', 'nit_con_contrato');
    end if;
  else
    insert into public.empresas (
      workspace_id, nombre, razon_social, tipo_documento, numero_documento, email_fiscal,
      rut_documento_url, rut_fecha_carga, rut_confianza_ocr, rut_verificado, custom_data
    ) values (
      p_cobrador, v_reg.razon_social, v_reg.razon_social, 'NIT', v_nit_dv, v_reg.correo,
      p_rut ->> 'documento_path',
      case when p_rut is null then null else now() end,
      nullif(p_rut ->> 'confianza', '')::numeric,
      v_rut_ok,
      jsonb_build_object(
        'fuente', 'registro autogestionado de Valida',
        'workspace_one', v_ws.slug,
        'rut_veredicto', coalesce(p_rut ->> 'veredicto', 'sin_rut')
      )
    )
    returning id into v_empresa;
    v_empresa_nueva := true;
  end if;

  -- El negocio: un negocio por contrato; cada renovación es un cobro de este negocio.
  insert into public.negocios (workspace_id, empresa_id, nombre, linea_id, etapa_actual_id, estado, precio_estimado, metadata)
  values (
    p_cobrador, v_empresa, 'Valida — ' || v_reg.razon_social, p_linea, p_etapa, 'abierto',
    nullif(p_parametros ->> 'precio_mensual', '')::numeric,
    jsonb_build_object(
      'origen', 'valida_autogestion',
      'workspace_one', v_ws.slug,
      'origen_comercial', v_reg.origen,
      'origen_fuente', v_reg.origen_fuente,
      'rut_veredicto', coalesce(p_rut ->> 'veredicto', 'sin_rut')
    )
  )
  returning id into v_negocio;

  -- Los términos de ESA empresa. Un reintento con el mismo PDF reusa la fila.
  select d.id into v_doc from public.documentos_contractuales_versiones d where d.pdf_sha256 = p_documento ->> 'pdf_sha256';
  if not found then
    insert into public.documentos_contractuales_versiones (
      workspace_id, linea_id, slug, alcance, empresa_id, titulo, version, texto_md, texto_sha256,
      pdf_path, pdf_sha256, vigente_desde, registrado_por
    ) values (
      p_cobrador, p_linea, p_documento ->> 'slug', 'cliente', v_empresa, p_documento ->> 'titulo',
      p_documento ->> 'version', v_texto, p_documento ->> 'texto_sha256',
      p_documento ->> 'pdf_path', p_documento ->> 'pdf_sha256', v_hoy, p_usuario
    )
    returning id into v_doc;
  end if;

  -- El contrato.
  insert into public.servicios_contratados (
    workspace_id, empresa_id, negocio_id, servicio_slug, servicio_version, parametros,
    workspace_pagador_id, correo_facturacion, estado, vigente_desde, vigente_hasta,
    comision, autorizacion_sin_poder_permitida, actualizado_por, aceptante_designado_id, terminos_plazo_hasta
  ) values (
    p_cobrador, v_empresa, v_negocio, v_ficha.slug, v_ficha.version_vigente,
    p_parametros || jsonb_build_object('origen', v_reg.origen, 'origen_fuente', v_reg.origen_fuente),
    p_workspace_cliente, v_reg.correo, 'activo', v_hoy, null,
    -- La comisión de AFI en autoservicio espera la decisión de Carmen y Mauricio (§3.2 y §3.4). El
    -- origen queda en los parámetros para escribirla cuando se decida.
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
      'empresa_nueva', v_empresa_nueva,
      'origen', v_reg.origen,
      'rut_veredicto', coalesce(p_rut ->> 'veredicto', 'sin_rut')
    ),
    'Activación autogestionada del plan de Valida desde la prueba gratis (espacio ' || v_ws.slug || '): '
      || v_reg.razon_social || ', NIT ' || v_nit_dv || '.',
    p_usuario
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
    'contrato_id', v_sc, 'negocio_id', v_negocio, 'empresa_id', v_empresa, 'documento_id', v_doc,
    'empresa_nueva', v_empresa_nueva
  );
end;
$$;

-- server-only: la llama `src/lib/valida-registro/activacion-servidor.ts` con service_role.
revoke execute on function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb)
  to service_role;

comment on function public.valida_activar_autogestion(uuid, uuid, uuid, uuid, uuid, text, jsonb, date, jsonb, jsonb) is
  'Activa el plan de una cuenta autogestionada de Valida: empresa, negocio, términos de la empresa, contrato con designada y plazo, y módulo. Idempotente (ya_activo). No acepta los términos: eso es de la persona en /valida.';
