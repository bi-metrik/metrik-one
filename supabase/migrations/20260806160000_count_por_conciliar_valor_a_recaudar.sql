-- El badge "por conciliar" medía el sobrepago contra el HONORARIO, no contra lo que el
-- cliente le paga a SOENA.
--
-- `negocios.precio_aprobado` es solo el honorario (el ingreso). El cliente paga, en UN
-- recaudo, honorario + tarifa UPME (pasante, plata de terceros que SOENA recauda y
-- desembolsa). Comparar el recaudo contra el honorario convertía a TODO cliente que paga
-- completo en un sobrepago del tamaño exacto de la tarifa: medido en producción (workspace
-- SOENA, 2026-08-06) la fórmula vieja marcaba 20 sobrepagos y con el valor a recaudar
-- quedan 0. Ninguno tenía nada que conciliar.
--
-- Es la sexta aparición de la misma fórmula (las anteriores se cerraron en #197 y #206).
-- La regla canónica vive en TypeScript, en `valorARecaudar` (src/lib/upme/modelo-dinero.ts);
-- esta función es su espejo en SQL porque el badge se cuenta en la base.
--
-- NO cambia la forma ni la firma de la función: sigue devolviendo un integer y sigue
-- contando sobrepagos ∪ duplicados ∪ etiquetados. Solo cambia el criterio de "sobrepago".

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
      and coalesce(c.tipo_cobro, '') <> 'devolucion_pendiente'
    group by c.negocio_id
  ),
  -- Tarifa UPME CONFIRMADA. El toggle `tarifa_confirmada` es obligatorio: el bloque
  -- también guarda la tarifa de REFERENCIA calculada (Art. 13), y esa no es una
  -- obligación del cliente hasta que alguien la confirma. Se filtra por el contrato
  -- genérico del producto (`config_extra.tarifa_confirmacion.enabled`), no por el slug
  -- del bloque: un workspace puede nombrarlo como quiera, y uno sin el bloque no
  -- cambia de comportamiento. El guard de formato evita que un valor no numérico
  -- reviente el cast.
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
  -- Si el negocio NO contrató la certificación UPME, no hay tarifa que pasarle al
  -- cliente: sumársela escondería un sobrepago real. Solo cuenta si el campo EXISTE y
  -- está en false (un bloque sin tocar no anula la tarifa de un negocio normal).
  sin_certificacion as (
    select distinct nb.negocio_id
    from public.negocio_bloques nb
    join public.bloque_configs bc on bc.id = nb.bloque_config_id
    join public.negocios n on n.id = nb.negocio_id
    where n.workspace_id = p_workspace_id
      and bc.slug = 'certificacion_upme'
      and nb.data -> 'requiere_certificacion_upme' = 'false'::jsonb
  ),
  -- Lo que el cliente le paga a SOENA = honorario + tarifa confirmada.
  valor_a_recaudar as (
    select n.id as negocio_id,
           coalesce(n.precio_aprobado, n.precio_estimado, 0)
             + case when sc.negocio_id is not null then 0 else coalesce(t.tarifa, 0) end as valor
    from public.negocios n
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
      -- Piso de materialidad: espejo de TOLERANCIA_SALDO_COP
      -- (src/lib/negocios/tolerancia-saldo.ts). Si cambia allá, cambia acá.
      and cb.total - vr.valor > 1000
      and coalesce(nc.conciliado, false) = false
  ),
  refs_no_split as (
    select c.external_ref, c.negocio_id
    from public.cobros c
    join public.negocios n on n.id = c.negocio_id
    where c.workspace_id = p_workspace_id
      and c.external_ref is not null
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
