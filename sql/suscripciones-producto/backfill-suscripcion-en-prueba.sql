-- Backfill (NO es migración; lo corre la sesión principal con el OK de Mauricio, DESPUÉS de aplicar
-- 20261016170000): la suscripción EN PRUEBA para los registros autogestionados de Valida que se
-- registraron antes de que el registro la creara (`asegurarSuscripcionEnPrueba`, 2026-10-16).
--
-- Solo registros `creado`, con la prueba todavía corriendo (vence en el futuro), sin contrato vivo de
-- Valida y sin suscripción viva: no toca a los 4 CDA (tienen contrato y no están en valida_registros),
-- ni a un espacio ya activado (cda-pruebas-futuras tiene su suscripción activa desde el 16-oct).
-- Con cobro cancelado no se crea (no hay prueba que mostrar con cobro).
--
-- Dry-run: correr el SELECT de abajo solo (sin el INSERT) y revisar las filas.

begin;

with candidatos as (
  select r.*
    from public.valida_registros r
   where r.estado = 'creado'
     and r.workspace_id is not null
     and r.prueba_vence_en > now()
     and coalesce(r.cobro_estado, 'programado') = 'programado'
     and not exists (
       select 1 from public.servicios_contratados sc
        where sc.workspace_pagador_id = r.workspace_id and sc.estado not in ('cancelado', 'terminado')
     )
     and not exists (
       select 1 from public.suscripciones_producto s
        where s.workspace_cliente_id = r.workspace_id and s.producto = 'valida' and s.estado <> 'cancelada'
     )
)
insert into public.suscripciones_producto (
  workspace_id, producto, workspace_cliente_id, nombre, razon_social, tipo_documento, numero_documento, dv,
  correo_facturacion, plan_slug, estado, prueba_desde, prueba_hasta, origen_comercial, origen_fuente,
  valida_registro_id, metodo_pago_pasarela, metodo_pago_ref, metadata, creado_por
)
select
  'a21bfc88-1a60-48c3-afcd-144226aa2392', 'valida', c.workspace_id, 'Valida — ' || c.razon_social, c.razon_social, 'NIT',
  regexp_replace(c.identificacion, '[^0-9]', '', 'g'), c.dv, c.correo, 'valida-cda-licencia', 'prueba',
  c.aceptado_at, c.prueba_vence_en, c.origen, c.origen_fuente, c.id,
  case when c.metodo_pago_estado = 'registrado' and coalesce(c.metodo_pago_ref, '') like 'epayco:%' then 'epayco' end,
  case when c.metodo_pago_estado = 'registrado' and coalesce(c.metodo_pago_ref, '') like 'epayco:%' then c.metodo_pago_ref end,
  jsonb_build_object('origen', 'valida_autogestion', 'workspace_one', c.slug_creado, 'fuente', 'registro autogestionado de Valida (backfill 20261016)'),
  c.usuario_id
from candidatos c
returning id, workspace_cliente_id, razon_social, prueba_hasta;

-- Revisar lo que devolvió el RETURNING y cerrar con commit (o rollback).
-- commit;
