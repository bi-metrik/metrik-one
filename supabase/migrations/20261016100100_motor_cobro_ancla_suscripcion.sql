-- ============================================================
-- 20261016100100 — El motor de cobro y los Términos leen el ancla del contrato (negocio O suscripción),
-- y la activación autogestionada de Valida crea una SUSCRIPCIÓN en vez de un negocio en `metrik`
--
-- Va después de 20261016100000 (las columnas `suscripcion_id`). Spec:
-- `docs/specs/2026-10-16_suscripciones-multiproducto.md`.
--
-- ## Qué escribe: DDL de funciones y triggers. Ni una fila.
--
--   1. `suscripcion_del_mismo_cobrador()`: un trigger en las 6 tablas con `suscripcion_id` que exige que
--      la suscripción sea del MISMO espacio cobrador que la fila (el `workspace_id`). Es lo que la guarda
--      de `aceptaciones_terminos_guardas` hace para el negocio.
--   2. Once funciones vivas, cada una con reemplazos de texto sobre su definición EN PRODUCCIÓN
--      (`pg_get_functiondef`, patrón de 20261008223000), no con la copia del repo: si la definición viva
--      ya no trae un patrón exactamente las veces esperadas, la migración entera aborta y no deja nada.
--      Cada reemplazo cambia `x.negocio_id = y.negocio_id` por la comparación del ancla (negocio O
--      suscripción) y suma `suscripcion_id` donde se elige el documento de la empresa. Para un contrato
--      de negocio el resultado es EL MISMO de hoy: la rama nueva solo emparejan filas con suscripción.
--        mis_servicios, mis_cuotas_de_servicio, mis_cobros_de_servicio, mis_documentos_de_servicio,
--        aceptaciones_terminos_modulo, aceptaciones_terminos_registro, documentos_versiones_inmutables,
--        documentos_versiones_por_aviso, enrolar_cobro_por_ciclo, registrar_compra_licencia,
--        registrar_retiro_licencia.
--      `create or replace` (lo que devuelve pg_get_functiondef) conserva dueño, SECURITY DEFINER,
--      search_path y grants. Idempotente: una función que ya menciona `suscripcion_id` se salta.
--   3. `valida_activar_autogestion` (de esta pila, 20261012100000) se reescribe entera: ya no crea
--      empresa en el directorio de `metrik` ni negocio (ni carpeta, ni tablero, ni gate de carpeta);
--      crea la suscripción, los Términos de ESA suscripción y el contrato colgado de ella. Misma firma
--      (el servidor no cambia de llamada); `p_etapa` ya no se usa y `p_linea` queda solo como la línea
--      del documento. La exención de 20261015180000 queda como red de seguridad: ningún camino crea ya
--      ese negocio.
--
-- ## Antes de aplicar
--
--   Correr el bloque `do` en una transacción con ROLLBACK (memoria `dry-run-sql-mcp-do-raise`): si una
--   función viva difiere del repo, aborta con el nombre de la función y el patrón. Nada que pisar a
--   ciegas.
--
-- ## Reversa
--
--   `sql/suscripciones-producto/reversa-20261016.sql`: los mismos reemplazos al revés
--   sobre la definición viva, el trigger fuera y `valida_activar_autogestion` con el cuerpo de
--   20261012100000. Primero la reversa de esta migración, después la de 20261016100000.
-- ============================================================


-- ── 1. La suscripción es del mismo cobrador que la fila ─────────────────────────────────

create or replace function public.suscripcion_del_mismo_cobrador()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.suscripcion_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.suscripcion_id is not distinct from old.suscripcion_id
     and new.workspace_id is not distinct from old.workspace_id then
    return new;
  end if;
  if not exists (
    select 1 from public.suscripciones_producto s
     where s.id = new.suscripcion_id and s.workspace_id = new.workspace_id
  ) then
    raise exception '%: la suscripción % no es del espacio cobrador %', tg_table_name, new.suscripcion_id, new.workspace_id;
  end if;
  return new;
end;
$$;
-- PostgreSQL no exige EXECUTE para disparar un trigger.
revoke execute on function public.suscripcion_del_mismo_cobrador() from public, anon, authenticated;

create trigger trg_suscripcion_del_mismo_cobrador before insert or update of suscripcion_id, workspace_id
  on public.servicios_contratados for each row execute function public.suscripcion_del_mismo_cobrador();
create trigger trg_suscripcion_del_mismo_cobrador before insert or update of suscripcion_id, workspace_id
  on public.planes_cobro for each row execute function public.suscripcion_del_mismo_cobrador();
create trigger trg_suscripcion_del_mismo_cobrador before insert or update of suscripcion_id, workspace_id
  on public.cobros for each row execute function public.suscripcion_del_mismo_cobrador();
create trigger trg_suscripcion_del_mismo_cobrador before insert
  on public.servicio_cobro_enrolamiento for each row execute function public.suscripcion_del_mismo_cobrador();
create trigger trg_suscripcion_del_mismo_cobrador before insert or update of suscripcion_id, workspace_id
  on public.aceptaciones_terminos for each row execute function public.suscripcion_del_mismo_cobrador();
create trigger trg_suscripcion_del_mismo_cobrador before insert
  on public.documentos_contractuales_versiones for each row execute function public.suscripcion_del_mismo_cobrador();


-- ── 2. Las funciones vivas: el ancla del contrato ───────────────────────────────────────

do $$
declare
  r record;
  v_fn text := null;
  v_def text;
  v_n int;
  v_saltar boolean := false;
begin
  for r in
    select * from (values
    (0, 0, 'public.mis_servicios()', E'join public.negocios n on n.id = sc.negocio_id', E'left join public.negocios n on n.id = sc.negocio_id\n  -- suscripciones_producto (20261016): el contrato de una suscripción no tiene negocio.\n  left join public.suscripciones_producto s on s.id = sc.suscripcion_id', 1),
    (0, 1, 'public.mis_servicios()', E'    n.nombre,\n', E'    coalesce(n.nombre, s.nombre),\n', 1),
    (1, 0, 'public.mis_cuotas_de_servicio(uuid)', E'on p.negocio_id = sc.negocio_id', E'on (p.negocio_id = sc.negocio_id or p.suscripcion_id = sc.suscripcion_id)', 1),
    (2, 0, 'public.mis_cobros_de_servicio(uuid)', E'join public.negocios n on n.id = sc.negocio_id', E'left join public.negocios n on n.id = sc.negocio_id\n  -- suscripciones_producto (20261016): el contrato de una suscripción no tiene negocio.\n  left join public.suscripciones_producto s on s.id = sc.suscripcion_id', 1),
    (2, 1, 'public.mis_cobros_de_servicio(uuid)', E'join public.cobros c on c.negocio_id = sc.negocio_id', E'join public.cobros c on (c.negocio_id = sc.negocio_id or c.suscripcion_id = sc.suscripcion_id)', 1),
    (2, 2, 'public.mis_cobros_de_servicio(uuid)', E'    n.nombre,\n', E'    coalesce(n.nombre, s.nombre),\n', 1),
    (3, 0, 'public.mis_documentos_de_servicio()', E'select distinct sc.empresa_id, cs.modulo', E'select distinct sc.empresa_id, sc.suscripcion_id, cs.modulo', 1),
    (3, 1, 'public.mis_documentos_de_servicio()', E'(d.alcance = \'cliente\' and sc.empresa_id = d.empresa_id)', E'(d.alcance = \'cliente\' and (sc.empresa_id = d.empresa_id or sc.suscripcion_id = d.suscripcion_id))', 1),
    (3, 2, 'public.mis_documentos_de_servicio()', E'(d.alcance = \'cliente\' and m.empresa_id = d.empresa_id)', E'(d.alcance = \'cliente\' and (m.empresa_id = d.empresa_id or m.suscripcion_id = d.suscripcion_id))', 1),
    (3, 3, 'public.mis_documentos_de_servicio()', E'and a.negocio_id in (', E'and coalesce(a.negocio_id, a.suscripcion_id) in (', 1),
    (3, 4, 'public.mis_documentos_de_servicio()', E'select sc.negocio_id', E'select coalesce(sc.negocio_id, sc.suscripcion_id)', 1),
    (4, 0, 'public.aceptaciones_terminos_modulo()', E'd.empresa_id, d.modulo,', E'd.empresa_id, d.suscripcion_id, d.modulo,', 1),
    (4, 1, 'public.aceptaciones_terminos_modulo()', E'where sc.negocio_id = new.negocio_id', E'where coalesce(sc.negocio_id, sc.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', 2),
    (4, 2, 'public.aceptaciones_terminos_modulo()', E'(v_doc.alcance = \'cliente\' and sc.empresa_id = v_doc.empresa_id)', E'(v_doc.alcance = \'cliente\' and (sc.empresa_id = v_doc.empresa_id or sc.suscripcion_id = v_doc.suscripcion_id))', 2),
    (4, 3, 'public.aceptaciones_terminos_modulo()', E'and a.negocio_id = new.negocio_id', E'and coalesce(a.negocio_id, a.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', 1),
    (5, 0, 'public.aceptaciones_terminos_registro()', E'd.alcance, d.empresa_id, d.titulo', E'd.alcance, d.empresa_id, d.suscripcion_id, d.titulo', 1),
    (5, 1, 'public.aceptaciones_terminos_registro()', E'where sc.negocio_id = new.negocio_id', E'where coalesce(sc.negocio_id, sc.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', 1),
    (5, 2, 'public.aceptaciones_terminos_registro()', E'and sc.empresa_id = v_doc.empresa_id', E'and (sc.empresa_id = v_doc.empresa_id or sc.suscripcion_id = v_doc.suscripcion_id)', 1),
    (5, 3, 'public.aceptaciones_terminos_registro()', E'and a.negocio_id = new.negocio_id', E'and coalesce(a.negocio_id, a.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', 1),
    (6, 0, 'public.documentos_versiones_inmutables()', E'or new.empresa_id is distinct from old.empresa_id', E'or new.empresa_id is distinct from old.empresa_id\n     or new.suscripcion_id is distinct from old.suscripcion_id', 1),
    (7, 0, 'public.documentos_versiones_por_aviso()', E'select d.workspace_id, d.slug, d.alcance, d.empresa_id, d.modulo', E'select d.workspace_id, d.slug, d.alcance, d.empresa_id, d.modulo, d.suscripcion_id', 1),
    (7, 1, 'public.documentos_versiones_por_aviso()', E'or v_previa.empresa_id is distinct from new.empresa_id', E'or v_previa.empresa_id is distinct from new.empresa_id\n     or v_previa.suscripcion_id is distinct from new.suscripcion_id', 1),
    (8, 0, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'select sc.id, sc.workspace_id, sc.negocio_id, sc.estado', E'select sc.id, sc.workspace_id, sc.negocio_id, sc.suscripcion_id, sc.estado', 1),
    (8, 1, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'and p.negocio_id = v_contrato.negocio_id', E'and coalesce(p.negocio_id, p.suscripcion_id) = coalesce(v_contrato.negocio_id, v_contrato.suscripcion_id)', 1),
    (8, 2, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'workspace_id, negocio_id, monto, frecuencia,', E'workspace_id, negocio_id, suscripcion_id, monto, frecuencia,', 1),
    (8, 3, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'v_contrato.negocio_id,\n    v_monto,', E'v_contrato.negocio_id,\n    v_contrato.suscripcion_id,\n    v_monto,', 1),
    (8, 4, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'servicio_contratado_id, workspace_id, negocio_id, plan_cobro_id,', E'servicio_contratado_id, workspace_id, negocio_id, suscripcion_id, plan_cobro_id,', 1),
    (8, 5, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'p_servicio_contratado_id, v_contrato.workspace_id, v_contrato.negocio_id, v_plan_id,', E'p_servicio_contratado_id, v_contrato.workspace_id, v_contrato.negocio_id, v_contrato.suscripcion_id, v_plan_id,', 1),
    (9, 0, 'public.registrar_compra_licencia(uuid,uuid,date,numeric,integer,jsonb,jsonb,text)', E'sc.parametros, sc.negocio_id, sc.workspace_id', E'sc.parametros, sc.negocio_id, sc.suscripcion_id, sc.workspace_id', 1),
    (9, 1, 'public.registrar_compra_licencia(uuid,uuid,date,numeric,integer,jsonb,jsonb,text)', E'and p.negocio_id = v_sc.negocio_id', E'and coalesce(p.negocio_id, p.suscripcion_id) = coalesce(v_sc.negocio_id, v_sc.suscripcion_id)', 1),
    (10, 0, 'public.registrar_retiro_licencia(uuid,uuid,date,uuid[],jsonb,integer,text)', E'sc.parametros, sc.negocio_id, sc.workspace_id', E'sc.parametros, sc.negocio_id, sc.suscripcion_id, sc.workspace_id', 1),
    (10, 1, 'public.registrar_retiro_licencia(uuid,uuid,date,uuid[],jsonb,integer,text)', E'and p.negocio_id = v_sc.negocio_id', E'and coalesce(p.negocio_id, p.suscripcion_id) = coalesce(v_sc.negocio_id, v_sc.suscripcion_id)', 1)
    ) as t(i, j, firma, viejo, nuevo, veces)
    order by i, j
  loop
    if v_fn is distinct from r.firma then
      -- Cierra la anterior.
      if v_fn is not null and not v_saltar then
        execute v_def;
      end if;
      v_fn := r.firma;
      v_def := pg_get_functiondef(r.firma::regprocedure);
      v_saltar := position('suscripcion_id' in v_def) > 0;
      if v_saltar then
        raise notice '% ya lee el ancla de la suscripción: se salta', r.firma;
      end if;
    end if;
    if not v_saltar then
      v_n := (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo);
      if v_n <> r.veces then
        raise exception '% cambió en producción: «%» aparece % veces (se esperaban %). Revisar a mano antes de aplicar.',
          r.firma, r.viejo, v_n, r.veces;
      end if;
      v_def := replace(v_def, r.viejo, r.nuevo);
    end if;
  end loop;
  if v_fn is not null and not v_saltar then
    execute v_def;
  end if;
end;
$$;


-- ── 3. La activación autogestionada crea una suscripción ────────────────────────────────
--
-- Las mismas reglas de 20261012100000, comprobadas con las filas bloqueadas:
--   1. el espacio nació en el registro autogestionado (fila `creado` en `valida_registros`);
--   2. quien activa es un perfil de ESE espacio;
--   3. el espacio no tiene un contrato vivo de Valida → `ya_activo`, sin escribir;
--   4. la ficha existe, está activa, es de `valida_consulta` y se cobra por ciclo;
--   5. el NIT no es de un cliente de hoy con contrato vivo de Valida: ni de una empresa del cobrador
--      (los 4 CDA, en negocios) ni de otra suscripción viva de Valida → `nit_con_contrato`;
--   6. la huella del texto es la de su texto, y el PDF trae la suya.
--
-- Lo que deja: la suscripción (empresa declarada, RUT, origen comercial, medio de pago, plan), los
-- Términos de ESA suscripción (alcance 'cliente', `suscripcion_id`), el contrato colgado de ella con la
-- persona como designada y el plazo para aceptar, beneficiario, bitácora del contrato y de la
-- suscripción, y la activación del módulo. NO deja: empresa en el directorio de `metrik`, negocio,
-- carpeta, ni nada en los tableros comerciales.

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
  ) then
    return jsonb_build_object('ok', false, 'error', 'nit_con_contrato');
  end if;

  -- La suscripción: la empresa declarada vive aquí, no en el directorio del cobrador.
  v_con_tarjeta := v_reg.metodo_pago_estado = 'registrado' and coalesce(v_reg.metodo_pago_ref, '') like 'epayco:%';
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
  'Activa el plan de una cuenta autogestionada de Valida como SUSCRIPCIÓN (suscripciones_producto): Términos de la suscripción, contrato colgado de ella con designada y plazo, y módulo. Sin empresa en el directorio ni negocio del CRM. Idempotente (ya_activo). No acepta los términos.';
