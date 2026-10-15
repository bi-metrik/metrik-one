-- ============================================================
-- REVERSA de 20261016100100 y 20261016100000 (suscripciones multiproducto)
--
-- Solo mientras NO haya filas con `suscripcion_id` (ninguna suscripción creada). Si ya hay altas
-- autogestionadas como suscripción, revertir deja esos contratos sin ancla: no correr sin decidir antes
-- qué pasa con ellos.
--
-- Orden: (1) las funciones vivas al revés, (2) el trigger de coherencia, (3) `valida_activar_autogestion`
-- con el cuerpo de 20261012100000 (correr ese archivo tal cual DESPUÉS de este), (4) el esquema.
-- La vista de MRR (20261016100200) se borra primero porque lee las columnas nuevas.
-- ============================================================

drop view if exists public.v_mrr_por_producto_resumen;
drop view if exists public.v_mrr_por_producto;

-- (1) Las once funciones: los mismos reemplazos, al revés, sobre la definición viva.
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
    (0, 0, 'public.mis_servicios()', E'left join public.negocios n on n.id = sc.negocio_id\n  -- suscripciones_producto (20261016): el contrato de una suscripción no tiene negocio.\n  left join public.suscripciones_producto s on s.id = sc.suscripcion_id', E'join public.negocios n on n.id = sc.negocio_id', 1),
    (0, 1, 'public.mis_servicios()', E'    coalesce(n.nombre, s.nombre),\n', E'    n.nombre,\n', 1),
    (1, 0, 'public.mis_cuotas_de_servicio(uuid)', E'on (p.negocio_id = sc.negocio_id or p.suscripcion_id = sc.suscripcion_id)', E'on p.negocio_id = sc.negocio_id', 1),
    (2, 0, 'public.mis_cobros_de_servicio(uuid)', E'left join public.negocios n on n.id = sc.negocio_id\n  -- suscripciones_producto (20261016): el contrato de una suscripción no tiene negocio.\n  left join public.suscripciones_producto s on s.id = sc.suscripcion_id', E'join public.negocios n on n.id = sc.negocio_id', 1),
    (2, 1, 'public.mis_cobros_de_servicio(uuid)', E'join public.cobros c on (c.negocio_id = sc.negocio_id or c.suscripcion_id = sc.suscripcion_id)', E'join public.cobros c on c.negocio_id = sc.negocio_id', 1),
    (2, 2, 'public.mis_cobros_de_servicio(uuid)', E'    coalesce(n.nombre, s.nombre),\n', E'    n.nombre,\n', 1),
    (3, 0, 'public.mis_documentos_de_servicio()', E'select distinct sc.empresa_id, sc.suscripcion_id, cs.modulo', E'select distinct sc.empresa_id, cs.modulo', 1),
    (3, 1, 'public.mis_documentos_de_servicio()', E'(d.alcance = \'cliente\' and (sc.empresa_id = d.empresa_id or sc.suscripcion_id = d.suscripcion_id))', E'(d.alcance = \'cliente\' and sc.empresa_id = d.empresa_id)', 1),
    (3, 2, 'public.mis_documentos_de_servicio()', E'(d.alcance = \'cliente\' and (m.empresa_id = d.empresa_id or m.suscripcion_id = d.suscripcion_id))', E'(d.alcance = \'cliente\' and m.empresa_id = d.empresa_id)', 1),
    (3, 3, 'public.mis_documentos_de_servicio()', E'and coalesce(a.negocio_id, a.suscripcion_id) in (', E'and a.negocio_id in (', 1),
    (3, 4, 'public.mis_documentos_de_servicio()', E'select coalesce(sc.negocio_id, sc.suscripcion_id)', E'select sc.negocio_id', 1),
    (4, 0, 'public.aceptaciones_terminos_modulo()', E'd.empresa_id, d.suscripcion_id, d.modulo,', E'd.empresa_id, d.modulo,', 1),
    (4, 1, 'public.aceptaciones_terminos_modulo()', E'where coalesce(sc.negocio_id, sc.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', E'where sc.negocio_id = new.negocio_id', 2),
    (4, 2, 'public.aceptaciones_terminos_modulo()', E'(v_doc.alcance = \'cliente\' and (sc.empresa_id = v_doc.empresa_id or sc.suscripcion_id = v_doc.suscripcion_id))', E'(v_doc.alcance = \'cliente\' and sc.empresa_id = v_doc.empresa_id)', 2),
    (4, 3, 'public.aceptaciones_terminos_modulo()', E'and coalesce(a.negocio_id, a.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', E'and a.negocio_id = new.negocio_id', 1),
    (5, 0, 'public.aceptaciones_terminos_registro()', E'd.alcance, d.empresa_id, d.suscripcion_id, d.titulo', E'd.alcance, d.empresa_id, d.titulo', 1),
    (5, 1, 'public.aceptaciones_terminos_registro()', E'where coalesce(sc.negocio_id, sc.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', E'where sc.negocio_id = new.negocio_id', 1),
    (5, 2, 'public.aceptaciones_terminos_registro()', E'and (sc.empresa_id = v_doc.empresa_id or sc.suscripcion_id = v_doc.suscripcion_id)', E'and sc.empresa_id = v_doc.empresa_id', 1),
    (5, 3, 'public.aceptaciones_terminos_registro()', E'and coalesce(a.negocio_id, a.suscripcion_id) = coalesce(new.negocio_id, new.suscripcion_id)', E'and a.negocio_id = new.negocio_id', 1),
    (6, 0, 'public.documentos_versiones_inmutables()', E'or new.empresa_id is distinct from old.empresa_id\n     or new.suscripcion_id is distinct from old.suscripcion_id', E'or new.empresa_id is distinct from old.empresa_id', 1),
    (7, 0, 'public.documentos_versiones_por_aviso()', E'select d.workspace_id, d.slug, d.alcance, d.empresa_id, d.modulo, d.suscripcion_id', E'select d.workspace_id, d.slug, d.alcance, d.empresa_id, d.modulo', 1),
    (7, 1, 'public.documentos_versiones_por_aviso()', E'or v_previa.empresa_id is distinct from new.empresa_id\n     or v_previa.suscripcion_id is distinct from new.suscripcion_id', E'or v_previa.empresa_id is distinct from new.empresa_id', 1),
    (8, 0, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'select sc.id, sc.workspace_id, sc.negocio_id, sc.suscripcion_id, sc.estado', E'select sc.id, sc.workspace_id, sc.negocio_id, sc.estado', 1),
    (8, 1, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'and coalesce(p.negocio_id, p.suscripcion_id) = coalesce(v_contrato.negocio_id, v_contrato.suscripcion_id)', E'and p.negocio_id = v_contrato.negocio_id', 1),
    (8, 2, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'workspace_id, negocio_id, suscripcion_id, monto, frecuencia,', E'workspace_id, negocio_id, monto, frecuencia,', 1),
    (8, 3, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'v_contrato.negocio_id,\n    v_contrato.suscripcion_id,\n    v_monto,', E'v_contrato.negocio_id,\n    v_monto,', 1),
    (8, 4, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'servicio_contratado_id, workspace_id, negocio_id, suscripcion_id, plan_cobro_id,', E'servicio_contratado_id, workspace_id, negocio_id, plan_cobro_id,', 1),
    (8, 5, 'public.enrolar_cobro_por_ciclo(uuid,timestamptz,integer,jsonb,jsonb)', E'p_servicio_contratado_id, v_contrato.workspace_id, v_contrato.negocio_id, v_contrato.suscripcion_id, v_plan_id,', E'p_servicio_contratado_id, v_contrato.workspace_id, v_contrato.negocio_id, v_plan_id,', 1),
    (9, 0, 'public.registrar_compra_licencia(uuid,uuid,date,numeric,integer,jsonb,jsonb,text)', E'sc.parametros, sc.negocio_id, sc.suscripcion_id, sc.workspace_id', E'sc.parametros, sc.negocio_id, sc.workspace_id', 1),
    (9, 1, 'public.registrar_compra_licencia(uuid,uuid,date,numeric,integer,jsonb,jsonb,text)', E'and coalesce(p.negocio_id, p.suscripcion_id) = coalesce(v_sc.negocio_id, v_sc.suscripcion_id)', E'and p.negocio_id = v_sc.negocio_id', 1),
    (10, 0, 'public.registrar_retiro_licencia(uuid,uuid,date,uuid[],jsonb,integer,text)', E'sc.parametros, sc.negocio_id, sc.suscripcion_id, sc.workspace_id', E'sc.parametros, sc.negocio_id, sc.workspace_id', 1),
    (10, 1, 'public.registrar_retiro_licencia(uuid,uuid,date,uuid[],jsonb,integer,text)', E'and coalesce(p.negocio_id, p.suscripcion_id) = coalesce(v_sc.negocio_id, v_sc.suscripcion_id)', E'and p.negocio_id = v_sc.negocio_id', 1)
    ) as t(i, j, firma, viejo, nuevo, veces)
    order by i, j desc
  loop
    if v_fn is distinct from r.firma then
      if v_fn is not null and not v_saltar then
        execute v_def;
      end if;
      v_fn := r.firma;
      v_def := pg_get_functiondef(r.firma::regprocedure);
      v_saltar := position('suscripcion_id' in v_def) = 0;
      if v_saltar then
        raise notice '% ya no lee la suscripción: se salta', r.firma;
      end if;
    end if;
    if not v_saltar then
      v_n := (length(v_def) - length(replace(v_def, r.viejo, ''))) / length(r.viejo);
      if v_n <> r.veces then
        raise exception 'reversa de %: «%» aparece % veces (se esperaban %)', r.firma, r.viejo, v_n, r.veces;
      end if;
      v_def := replace(v_def, r.viejo, r.nuevo);
    end if;
  end loop;
  if v_fn is not null and not v_saltar then
    execute v_def;
  end if;
end;
$$;

-- (2) El trigger de coherencia.
drop trigger if exists trg_suscripcion_del_mismo_cobrador on public.servicios_contratados;
drop trigger if exists trg_suscripcion_del_mismo_cobrador on public.planes_cobro;
drop trigger if exists trg_suscripcion_del_mismo_cobrador on public.cobros;
drop trigger if exists trg_suscripcion_del_mismo_cobrador on public.servicio_cobro_enrolamiento;
drop trigger if exists trg_suscripcion_del_mismo_cobrador on public.aceptaciones_terminos;
drop trigger if exists trg_suscripcion_del_mismo_cobrador on public.documentos_contractuales_versiones;
drop function if exists public.suscripcion_del_mismo_cobrador();

-- (3) `valida_activar_autogestion`: correr 20261012100000_valida_activar_autogestion.sql DESPUÉS de este
--     archivo (su `create or replace` deja el cuerpo que crea empresa y negocio).

-- (4) El esquema.
alter table public.documentos_contractuales_versiones drop constraint documentos_versiones_ancla_coherente;
alter table public.documentos_contractuales_versiones add constraint documentos_versiones_empresa_coherente
  check ((alcance = 'cliente') = (empresa_id is not null));
drop index public.uq_documentos_versiones_suscripcion;
alter table public.documentos_contractuales_versiones drop column suscripcion_id;

drop index public.uq_aceptaciones_terminos_modulo_suscripcion;
drop index public.uq_aceptaciones_terminos_registro_suscripcion;
drop index public.idx_aceptaciones_terminos_suscripcion;
alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_modulo_completa;
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
alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_registro_completa;
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
alter table public.aceptaciones_terminos drop constraint aceptaciones_terminos_ancla;
alter table public.aceptaciones_terminos drop column suscripcion_id;

alter table public.servicio_cobro_enrolamiento drop constraint servicio_cobro_enrolamiento_ancla;
alter table public.servicio_cobro_enrolamiento drop column suscripcion_id;
alter table public.servicio_cobro_enrolamiento alter column negocio_id set not null;

drop index public.idx_cobros_suscripcion;
alter table public.cobros drop constraint cobros_ancla;
alter table public.cobros drop column suscripcion_id;

drop index public.idx_planes_cobro_suscripcion;
alter table public.planes_cobro drop constraint planes_cobro_ancla;
alter table public.planes_cobro drop column suscripcion_id;
alter table public.planes_cobro alter column negocio_id set not null;

drop index public.idx_servicios_contratados_suscripcion;
alter table public.servicios_contratados drop constraint servicios_contratados_ancla;
alter table public.servicios_contratados drop constraint servicios_contratados_empresa_por_ancla;
alter table public.servicios_contratados drop column suscripcion_id;
alter table public.servicios_contratados alter column negocio_id set not null;
alter table public.servicios_contratados alter column empresa_id set not null;

drop table public.suscripciones_producto_eventos;
drop function public.suscripciones_producto_eventos_inmutable();
drop table public.suscripciones_producto;
drop function public.suscripciones_producto_touch();
