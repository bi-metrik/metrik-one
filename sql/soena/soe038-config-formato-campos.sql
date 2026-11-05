-- SOE-038 · Reglas de formato para las correcciones a mano de las facturas de SOENA.
--
-- Va DESPUÉS del merge del PR que agrega `valor_fijo` y `min_caracteres` (antes no hace daño:
-- las llaves que el código no conoce se ignoran). Escribir en SOENA exige el «autorizo
-- escribir en soena» de Mauricio.
--
--   · partida_arancelaria → valor_fijo «0000». La propia config ya lo dice («NO se extrae de
--     la factura. Siempre poner el valor 0000»); en producción había 6 «X» a mano.
--   · numero_factura → min_caracteres 3. Frena los rellenos «0» y «1». Medido el
--     2026-11-05: el número más corto que ha leído ONE en SOENA tiene 4 caracteres.
--
-- Lo genérico (fecha real, números, NIT de al menos 6 dígitos) no necesita config: aplica
-- en todos los workspaces desde el merge.
--
-- Idempotente: volver a correrlo no cambia nada.

begin;

update bloque_configs bc
set config_extra = jsonb_set(
  bc.config_extra,
  '{campos_extraccion}',
  (
    select jsonb_agg(
      case
        when c->>'slug' = 'partida_arancelaria' then c || '{"valor_fijo": "0000"}'::jsonb
        when c->>'slug' = 'numero_factura'      then c || '{"min_caracteres": 3}'::jsonb
        else c
      end
      order by ord
    )
    from jsonb_array_elements(bc.config_extra->'campos_extraccion') with ordinality as t(c, ord)
  )
)
where bc.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'  -- SOENA
  and exists (
    select 1 from jsonb_array_elements(bc.config_extra->'campos_extraccion') c
    where c->>'slug' in ('partida_arancelaria', 'numero_factura')
  );

-- Esperado el 2026-11-05: 17 configs (13 «Factura emitida» + 4 «Factura Venta Vehículo»).
select bc.nombre, count(distinct bc.id) as configs
from bloque_configs bc, jsonb_array_elements(bc.config_extra->'campos_extraccion') c
where bc.workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'
  and (c ? 'valor_fijo' or c ? 'min_caracteres')
group by 1;

commit;
