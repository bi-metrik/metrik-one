-- ============================================================================
-- Trappvel · «Condiciones del viaje»: modalidad A medida | Bloqueo y operador · 2026-10-27
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de un workspace (config del bloque), no esquema: lo aplica la
-- sesión principal DESPUÉS del deploy del PR feat/trappvel-bloqueo. Aplicado antes, la pantalla
-- solo muestra dos campos más y nadie los lee: no se rompe nada.
--
-- Encargo: proyectos/trappvel/clarity/briefs/2026-10-27_brief-max-bloqueo.md, punto 1.
-- Bloque: bloque_configs 98281a40-2f67-4d8e-9bc5-6ca1f7a69417 (slug condiciones_del_viaje),
-- el mismo de `2026-09-28_solicitud-minimo-deseable-PROVISIONAL.sql`.
--
-- Qué hace: agrega DOS campos detrás de `tipo_viaje` (o al final, si no está):
--   · modalidad_viaje (select): a_medida «A medida» | bloqueo «Bloqueo». Sin valor = A medida.
--   · operador_bloqueo (texto), visible solo si modalidad_viaje = bloqueo (`showIf`).
-- Sin `nivel`: no suman a las barras de mínimo/deseable y el bot no los pregunta. El bot SÍ los
-- llena cuando la solicitud lo dice («un bloqueo de Aliados del 5 al 8 de febrero»): la carga
-- del agente pasa todos los campos del bloque al modelo con su `ayuda`; el modelo interpreta y
-- el código solo guarda lo que cabe en el campo (no hay regla por palabra clave en código).
--
-- ⚠️ El slug NO es `tipo_viaje`: ese ya existe (playa / naturaleza / crucero).
--
-- Idempotente: si `modalidad_viaje` ya existe, no hace nada y lo dice.
-- ============================================================================

do $$
declare
  v_id constant uuid := '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
  v_cfg jsonb;
  v_slug text;
  v_fields jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_puesto boolean := false;
  v_nuevos constant jsonb := $cfg$
[
  {
    "slug": "modalidad_viaje",
    "tipo": "select",
    "label": "Modalidad",
    "ayuda": "Bloqueo = el cliente compra un paquete de un operador (Aliados Travel, Tu Reserva…) con cupo fijo de vuelo y hotel en fechas cerradas. A medida = la agencia arma el viaje servicio por servicio. Si no lo dicen, A medida.",
    "opciones": [
      { "value": "a_medida", "label": "A medida" },
      { "value": "bloqueo", "label": "Bloqueo" }
    ]
  },
  {
    "slug": "operador_bloqueo",
    "tipo": "texto",
    "label": "Operador del bloqueo",
    "ayuda": "El operador que vende el bloqueo, como lo dicen (ej. Aliados Travel, Tu Reserva).",
    "showIf": { "field": "modalidad_viaje", "equals": "bloqueo" }
  }
]
$cfg$::jsonb;
begin
  select config_extra, slug into v_cfg, v_slug
  from public.bloque_configs
  where id = v_id
  for update;

  if not found then
    raise exception 'No existe bloque_configs %', v_id;
  end if;
  if v_slug is distinct from 'condiciones_del_viaje' then
    raise exception 'El bloque % no es condiciones_del_viaje (slug=%)', v_id, v_slug;
  end if;
  if exists (select 1 from jsonb_array_elements(v_cfg->'fields') e where e->>'slug' in ('modalidad_viaje', 'operador_bloqueo')) then
    raise notice 'Ya aplicado: el bloque ya tiene modalidad_viaje u operador_bloqueo. No se toca.';
    return;
  end if;

  for v_elem in select e from jsonb_array_elements(v_cfg->'fields') with ordinality as t(e, n) order by n loop
    v_fields := v_fields || jsonb_build_array(v_elem);
    if v_elem->>'slug' = 'tipo_viaje' then
      v_fields := v_fields || v_nuevos;
      v_puesto := true;
    end if;
  end loop;
  if not v_puesto then
    v_fields := v_fields || v_nuevos;
  end if;

  if jsonb_array_length(v_fields) <> jsonb_array_length(v_cfg->'fields') + 2 then
    raise exception 'El resultado no tiene los 2 campos nuevos (quedaron %)', jsonb_array_length(v_fields);
  end if;

  update public.bloque_configs
  set config_extra = jsonb_set(config_extra, '{fields}', v_fields)
  where id = v_id;
end $$;

-- Verificación:
-- select e->>'slug', e->>'label', e->'showIf'
-- from public.bloque_configs, jsonb_array_elements(config_extra->'fields') with ordinality as t(e, n)
-- where id = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417' order by n;

-- Vuelta atrás (los valores escritos quedan en negocio_bloques.data sin mostrarse):
-- update public.bloque_configs
-- set config_extra = jsonb_set(config_extra, '{fields}', (
--   select jsonb_agg(e order by n)
--   from jsonb_array_elements(config_extra->'fields') with ordinality as t(e, n)
--   where e->>'slug' not in ('modalidad_viaje', 'operador_bloqueo')
-- ))
-- where id = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
