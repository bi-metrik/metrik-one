-- La tarifa UPME se anula por el SERVICIO CONTRATADO, no por su reflejo derivado.
--
-- `count_negocios_por_conciliar` decidia si un negocio debe la tarifa mirando
-- `requiere_certificacion_upme`, un campo DERIVADO que colgaba de `servicio` por
-- `lock_when`. Derivado y fuente se desincronizan en silencio apenas alguien escribe por
-- fuera de la app (cargue masivo, SQL, instancias creadas despues de que el negocio ya
-- paso por Negociacion), y eso ya costo plata: cinco negocios de SOENA llegaron con el
-- derivado en `false` puesto por un relleno retroactivo, no por una respuesta. Dos de
-- ellos SI habian contratado la certificacion y el sistema les anulaba $1.552.461.
--
-- Aqui se lee la fuente: de las tres ramas de `servicio` (`completo`, `solo_upme`,
-- `solo_iva`) solo `solo_iva` va sin certificacion. Un bloque sin responder no anula la
-- tarifa de un negocio normal, igual que antes.
--
-- Radio medido en produccion antes de aplicar: el conjunto de negocios con la tarifa
-- anulada es identico con la regla vieja y con la nueva (10 negocios, cero entran, cero
-- salen). El cambio es inerte porque el backfill de `servicio` se hizo primero.
--
-- Unico objeto SQL vivo que leia el derivado: esta funcion. Aparece tres veces en el
-- historial de migraciones (20260806160000, 20260810130000, 20260811000001) porque se
-- redefinio tres veces; la vigente es la ultima y es la que se reemplaza aqui.

create or replace function public.count_negocios_por_conciliar(p_workspace_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $function$
  with
  cobrado as (
    select c.negocio_id, sum(c.monto) as total
    from public.cobros c
    where c.workspace_id = p_workspace_id
      and c.anulado_at is null
      and coalesce(c.tipo_cobro, '') <> 'devolucion_pendiente'
    group by c.negocio_id
  ),
  tarifa_confirmada as (
    select nb.negocio_id,
           max((nb.data ->> 'tarifa_upme_confirmada')::numeric) as tarifa
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.config_extra -> 'tarifa_confirmacion' ->> 'enabled' = 'true'
      and nb.data ->> 'tarifa_confirmada' = 'true'
      and nb.data ->> 'tarifa_upme_confirmada' ~ '^[0-9]+(\.[0-9]+)?$'
      and (nb.data ->> 'tarifa_upme_confirmada')::numeric > 0
    group by nb.negocio_id
  ),
  -- Si el negocio NO contrato la certificacion UPME, no hay tarifa que pasarle al
  -- cliente: sumarsela esconderia un sobrepago real. Lo dice el servicio contratado.
  sin_certificacion as (
    select distinct nb.negocio_id
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.slug = 'servicio_contratado'
      and nb.data ->> 'servicio' = 'solo_iva'
  ),
  valor_a_recaudar as (
    select n.id as negocio_id,
           vv.valor_total
             + case when sc.negocio_id is not null then 0 else coalesce(t.tarifa, 0) end as valor
    from public.negocios n
    join public.v_negocio_valor vv on vv.negocio_id = n.id
    left join tarifa_confirmada t on t.negocio_id = n.id
    left join sin_certificacion sc on sc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
  ),
  sobrepagos as (
    select n.id
    from public.negocios n
    join cobrado cb on cb.negocio_id = n.id
    join valor_a_recaudar vr on vr.negocio_id = n.id
    left join public.negocio_conciliacion nc on nc.negocio_id = n.id
    where n.workspace_id = p_workspace_id
      and n.estado = 'abierto'
      and cb.total - vr.valor > 1000
      and coalesce(nc.conciliado, false) = false
  ),
  refs_no_split as (
    select c.external_ref, c.negocio_id
    from public.cobros c
    join public.negocios n on n.id = c.negocio_id
    where c.workspace_id = p_workspace_id
      and c.external_ref is not null
      and c.anulado_at is null
      and (c.split_json ->> 'split_id') is null
      and n.estado = 'abierto'
  ),
  duplicados as (
    select distinct r.negocio_id as id
    from refs_no_split r
    where r.external_ref in (
      select external_ref
      from refs_no_split
      group by external_ref
      having count(distinct negocio_id) > 1
    )
  ),
  etiquetados as (
    select distinct al.entidad_id as id
    from public.activity_log al
    where al.workspace_id = p_workspace_id
      and al.entidad_tipo = 'negocio'
      and al.tipo = 'solicitud_conciliacion'
      and exists (
        select 1 from public.negocios n3
        where n3.id = al.entidad_id
          and n3.workspace_id = p_workspace_id
          and n3.estado = 'abierto'
      )
      and not exists (
        select 1 from public.activity_log al2
        where al2.workspace_id = p_workspace_id
          and al2.entidad_tipo = 'negocio'
          and al2.entidad_id = al.entidad_id
          and al2.tipo = 'conciliacion_atendida'
          and al2.created_at > al.created_at
      )
  )
  select count(*)::integer
  from (
    select id from sobrepagos
    union
    select id from duplicados
    union
    select id from etiquetados
  ) u;
$function$;

-- `create or replace` conserva el ACL de la funcion que ya existe, pero en un entorno
-- donde nazca de cero llegaria ejecutable por PUBLIC, y `anon` la alcanza por ahi. Se
-- redeclara igual que en 20260811000001: la cuenta de casos por conciliar es de usuario
-- autenticado, nunca del cliente anonimo.
revoke execute on function public.count_negocios_por_conciliar(uuid) from public, anon;
grant execute on function public.count_negocios_por_conciliar(uuid) to authenticated;
