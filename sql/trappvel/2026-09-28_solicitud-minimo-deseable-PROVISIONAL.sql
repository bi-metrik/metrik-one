-- ============================================================================
-- Trappvel · Etapa 1 «Condiciones del viaje»: mínimo y deseable · 2026-09-28
-- ============================================================================
-- ⚠️⚠️ PROVISIONAL. Qué dato es mínimo, cuál deseable y cuándo se pide NO está decidido:
-- falta la reunión con Edgar. Esto es una propuesta para poder probar el mecanismo, y
-- se cambia editando esta config, sin PR.
--
-- ⚠️ NO ESTÁ APLICADO. Es dato de un workspace, no esquema: lo aplica la sesión
-- principal (copia en proyectos/trappvel/clarity/migrations/).
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-28-solicitud-configurable.md
-- Insumos: sesión del 25-sep (Edgar, Tatiana), audios de Tatiana del 28-sep, formulario del QR.
--
-- Bloque: bloque_configs 98281a40-2f67-4d8e-9bc5-6ca1f7a69417 (slug condiciones_del_viaje,
-- etapa 1 «Solicitud», línea 42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887). Config leída el
-- 2026-09-28: 13 campos, de destino a presentacion_destino.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- 1. A campos existentes les agrega `nivel` y `pregunta` (y `pedir_si` donde aplica).
--    `ninos` cambia su `ayuda`: la edad ya SÍ se pide, en `edades_menores`.
--    `ninos` e `infantes` pierden `default: 0` (ver abajo).
-- 2. Agrega 8 campos: tipo_viaje, edades_menores, presupuesto, categoria_hotel,
--    plan_alimentacion, equipaje, acomodacion, permiso_salida_menores. Ninguno es
--    `required`: el mínimo avisa, no frena (Edgar, 25-sep: «el sistema no los controla»).
--
-- Niveles provisionales:
--   Mínimo:   destino, fecha_salida, fecha_regreso, adultos, ninos, infantes,
--             edades_menores (si ninos + infantes > 0).
--   Deseable: presupuesto, tipo_viaje, categoria_hotel, plan_alimentacion, equipaje,
--             acomodacion (si numero_pasajeros >= 6),
--             permiso_salida_menores (si hay menores Y destino_tipo = internacional).
-- Por qué: fechas exactas, quiénes viajan y la edad de los niños son lo que Tatiana llama
-- mínimo y lo que daña la cotización si llega mal (audios 4 y 5). El presupuesto lo nombra
-- ella, pero en Airtable no se registra nunca: queda deseable hasta que Edgar diga otra cosa.
--
-- `ninos` e `infantes` PIERDEN su `default: 0` (decisión de Mauricio, 2026-09-28). Con el
-- default, la pantalla los mostraba en 0 y contaban como respondidos: el mínimo nunca
-- preguntaba si viajan menores. Ahora quedan vacíos hasta que alguien escriba un número; un
-- 0 escrito SÍ cuenta como respondido. Para calcular (composición, número de pasajeros, tarifa)
-- un vacío sigue valiendo 0: `normalizarComposicion` y `aplicarSumas` ya lo tratan así.
-- Los negocios que ya guardaron 0 conservan su 0.

-- ── Orden ───────────────────────────────────────────────────────────────────
-- DESPUÉS del deploy del PR «mínimo y deseable como configuración del campo». Aplicado
-- antes, la pantalla vieja ignora `nivel`/`pedir_si`/`pregunta` y solo muestra los 8
-- campos nuevos como campos opcionales más: no se rompe nada.
--
-- Para que el mínimo FRENE el avance (modo «bloquea») no se toca este bloque: se agrega
-- 'solicitud_minimo' a etapas_negocio.config_extra.gates de la etapa 1
-- (3b6b4133-f656-4145-8e32-bf598cde68d0). NO se hace aquí: por defecto es aviso.
--
-- Idempotente: si `tipo_viaje` ya existe, no hace nada y lo dice.
-- Aborta si el bloque no está como se midió.
--
-- El JSON entre las marcas $cfg$ lo lee también la prueba
-- `src/lib/negocios/niveles-solicitud-trappvel.test.ts`: si se edita y deja de ser
-- válido, la prueba cae.
-- ============================================================================

do $$
declare
  v_id constant uuid := '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
  v_cfg jsonb;
  v_slug text;
  v_fields jsonb := '[]'::jsonb;
  v_elem jsonb;
  v_s text;
  v_esperados constant text[] := array['destino','destino_tipo','fecha_salida','fecha_regreso',
    'adultos','ninos','infantes','numero_pasajeros','composicion'];
  v_parche constant jsonb := $cfg$
{
  "quitar": {
    "ninos": ["default"],
    "infantes": ["default"]
  },
  "props": {
    "destino": {
      "nivel": "minimo",
      "pregunta": "¿A dónde quieren viajar?"
    },
    "fecha_salida": {
      "nivel": "minimo",
      "pregunta": "¿Qué día salen?"
    },
    "fecha_regreso": {
      "nivel": "minimo",
      "pregunta": "¿Qué día regresan?"
    },
    "adultos": {
      "nivel": "minimo",
      "pregunta": "¿Cuántos adultos viajan?"
    },
    "ninos": {
      "nivel": "minimo",
      "pregunta": "¿Viajan niños? ¿Cuántos?",
      "ayuda": "Cuántos niños viajan. La edad de cada uno se pide aparte: cada proveedor pone su corte de edad."
    },
    "infantes": {
      "nivel": "minimo",
      "pregunta": "¿Viajan bebés menores de 2 años? ¿Cuántos?"
    }
  },
  "insertar_despues_de": {
    "destino_tipo": [
      {
        "slug": "tipo_viaje",
        "tipo": "select",
        "label": "Tipo de viaje",
        "nivel": "deseable",
        "pregunta": "¿Qué tipo de viaje buscan: playa, naturaleza y aventura, crucero u otro?",
        "opciones": [
          { "value": "playa", "label": "Playa" },
          { "value": "naturaleza_aventura", "label": "Naturaleza y aventura" },
          { "value": "crucero", "label": "Crucero" },
          { "value": "otro", "label": "Otro" }
        ]
      }
    ],
    "numero_pasajeros": [
      {
        "slug": "edades_menores",
        "tipo": "texto",
        "label": "Edades de los niños e infantes",
        "ayuda": "La edad de cada uno, en años (ej.: 9, 6 y 1). Es el dato que, si llega mal, daña la cotización entera.",
        "nivel": "minimo",
        "pregunta": "¿Qué edad tiene cada niño?",
        "pedir_si": { "suma_de": ["ninos", "infantes"], "mayor_que": 0 }
      }
    ],
    "composicion": [
      {
        "slug": "presupuesto",
        "tipo": "select",
        "label": "Presupuesto aproximado del viaje",
        "ayuda": "Los rangos del formulario del QR de Tatiana. Es para todo el viaje, no por persona.",
        "nivel": "deseable",
        "pregunta": "¿Cuánto tienen pensado invertir en el viaje, más o menos?",
        "opciones": [
          { "value": "menos_3m", "label": "Menos de $3 millones" },
          { "value": "3m_5m", "label": "Entre $3 y $5 millones" },
          { "value": "5m_8m", "label": "Entre $5 y $8 millones" },
          { "value": "8m_12m", "label": "Entre $8 y $12 millones" },
          { "value": "12m_20m", "label": "Entre $12 y $20 millones" },
          { "value": "mas_20m", "label": "Más de $20 millones" },
          { "value": "sin_definir", "label": "Aún no tiene presupuesto definido" }
        ]
      },
      {
        "slug": "categoria_hotel",
        "tipo": "select",
        "label": "Categoría de hotel",
        "nivel": "deseable",
        "pregunta": "¿De qué categoría prefieren el hotel?",
        "opciones": [
          { "value": "3", "label": "3 estrellas" },
          { "value": "4", "label": "4 estrellas" },
          { "value": "5", "label": "5 estrellas" },
          { "value": "sin_preferencia", "label": "Sin preferencia" }
        ]
      },
      {
        "slug": "plan_alimentacion",
        "tipo": "select",
        "label": "Plan de alimentación",
        "nivel": "deseable",
        "pregunta": "¿Qué plan de alimentación quieren?",
        "opciones": [
          { "value": "solo_alojamiento", "label": "Solo alojamiento" },
          { "value": "desayuno", "label": "Con desayuno" },
          { "value": "media_pension", "label": "Media pensión" },
          { "value": "pension_completa", "label": "Pensión completa" },
          { "value": "todo_incluido", "label": "Todo incluido" }
        ]
      },
      {
        "slug": "equipaje",
        "tipo": "select",
        "label": "Equipaje",
        "ayuda": "El dato que más se queda faltando (Tatiana, 28-sep).",
        "nivel": "deseable",
        "pregunta": "¿Qué equipaje llevan?",
        "opciones": [
          { "value": "personal", "label": "Solo artículo personal" },
          { "value": "mano", "label": "Maleta de mano" },
          { "value": "bodega", "label": "Maleta de bodega" }
        ]
      },
      {
        "slug": "acomodacion",
        "tipo": "texto",
        "label": "Acomodación",
        "ayuda": "Cómo se reparten en habitaciones. Se pide en grupos de 6 o más.",
        "nivel": "deseable",
        "pregunta": "¿Cómo se quieren acomodar en las habitaciones?",
        "pedir_si": { "field": "numero_pasajeros", "al_menos": 6 }
      },
      {
        "slug": "permiso_salida_menores",
        "tipo": "select",
        "label": "Permiso de salida de los menores",
        "ayuda": "Si los menores no viajan con papá y mamá, necesitan permiso de salida del país.",
        "nivel": "deseable",
        "pregunta": "¿Los niños viajan con papá y mamá, o tienen el permiso de salida?",
        "pedir_si": [
          { "suma_de": ["ninos", "infantes"], "mayor_que": 0 },
          { "field": "destino_tipo", "value": "internacional" }
        ],
        "opciones": [
          { "value": "con_ambos_padres", "label": "Viajan con papá y mamá" },
          { "value": "tiene_permiso", "label": "Tienen el permiso" },
          { "value": "en_tramite", "label": "Está en trámite" },
          { "value": "no_tiene", "label": "No lo tienen" }
        ]
      }
    ]
  }
}
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

  if exists (select 1 from jsonb_array_elements(v_cfg->'fields') e where e->>'slug' = 'tipo_viaje') then
    raise notice 'Ya aplicado: el bloque ya tiene tipo_viaje. No se toca.';
    return;
  end if;

  foreach v_s in array v_esperados loop
    if (select count(*) from jsonb_array_elements(v_cfg->'fields') e where e->>'slug' = v_s) <> 1 then
      raise exception 'Se esperaba exactamente un campo % en el bloque', v_s;
    end if;
  end loop;

  -- Se conserva el orden: cada campo recibe sus propiedades y, detrás de los campos
  -- ancla, entran los nuevos. El orden importa: es el orden de las preguntas.
  for v_elem in select e from jsonb_array_elements(v_cfg->'fields') with ordinality as t(e, n) order by n loop
    v_s := v_elem->>'slug';
    if v_parche->'quitar' ? v_s then
      v_elem := v_elem - array(select jsonb_array_elements_text(v_parche->'quitar'->v_s));
    end if;
    v_fields := v_fields || jsonb_build_array(v_elem || coalesce(v_parche->'props'->v_s, '{}'::jsonb));
    if v_parche->'insertar_despues_de' ? v_s then
      v_fields := v_fields || (v_parche->'insertar_despues_de'->v_s);
    end if;
  end loop;

  if jsonb_array_length(v_fields) <> jsonb_array_length(v_cfg->'fields') + 8 then
    raise exception 'El resultado no tiene los 8 campos nuevos (quedaron %)', jsonb_array_length(v_fields);
  end if;

  update public.bloque_configs
  set config_extra = jsonb_set(config_extra, '{fields}', v_fields)
  where id = v_id;
end $$;

-- Verificación:
-- select e->>'slug' as slug, e->>'nivel' as nivel, e->'pedir_si' as pedir_si, e->>'pregunta' as pregunta
-- from public.bloque_configs, jsonb_array_elements(config_extra->'fields') with ordinality as t(e, n)
-- where id = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417' order by n;

-- Vuelta atrás: quitar los 8 campos nuevos, las tres llaves nuevas, reponer la ayuda de
-- `ninos` y el `default: 0` de `ninos` e `infantes`. Los valores que alguien haya escrito en los campos nuevos quedan en
-- negocio_bloques.data sin mostrarse (no se borran).
-- update public.bloque_configs
-- set config_extra = jsonb_set(config_extra, '{fields}', (
--   select jsonb_agg(
--     case when e->>'slug' = 'ninos'
--          then (e - 'nivel' - 'pedir_si' - 'pregunta')
--               || '{"default":0,"ayuda":"Cuántos niños viajan. Cada proveedor pone su corte de edad: en la cotización se ajusta por línea."}'::jsonb
--          when e->>'slug' = 'infantes' then (e - 'nivel' - 'pedir_si' - 'pregunta') || '{"default":0}'::jsonb
--          else e - 'nivel' - 'pedir_si' - 'pregunta' end
--     order by n)
--   from jsonb_array_elements(config_extra->'fields') with ordinality as t(e, n)
--   where e->>'slug' not in ('tipo_viaje','edades_menores','presupuesto','categoria_hotel',
--                            'plan_alimentacion','equipaje','acomodacion','permiso_salida_menores')
-- ))
-- where id = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
