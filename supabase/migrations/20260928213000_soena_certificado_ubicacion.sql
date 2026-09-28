-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-28
-- El certificado UPME también se cruza por DEPARTAMENTO, CIUDAD y DIRECCIÓN del cliente.
--
-- Brief: proyectos/soena/ve/2026-09-28_brief-max-certificado-ubicacion.md
-- Mismo patrón que 20260925010000_soena_certificado_correo_sin_vin.sql (el correo).
--
-- Solo CONFIGURACIÓN (config_extra de una línea y de dos bloque_configs). No toca
-- negocio_bloques: ningún dato de ningún negocio cambia.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- V0129 volvió a reproceso el 22-sep porque el certificado salió con un dato mal y hubo
-- que radicar de nuevo ante la UPME (tarifa pagada dos veces). El correo ya se cruza; el
-- certificado trae en la misma fila de BENEFICIARIOS el departamento, la ciudad y la
-- dirección, y hoy nadie los compara con el RUT.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- (1) El certificado lee `departamento_certificado`, `ciudad_certificado`,
--     `direccion_certificado` y sus `_2` (segundo beneficiario, en copropiedad).
-- (2) Seis cruces: cada dato contra el RUT de CUALQUIERA de los dos titulares (basta con
--     uno, igual que el correo). Los `_2` solo en copropiedad.
--     - Departamento y ciudad: modo `contenido` («CARTAGENA DE INDIAS» contra «Cartagena»,
--       «BOGOTÁ. D.C.» contra «Bogotá», «SAN JOSÉ DE CÚCUTA» contra «Cúcuta»).
--     - Dirección: modo `direccion` (nuevo, en el PR de esta migración): compara la placa,
--       el tipo de vía y la unidad; no el barrio ni el edificio. Ver
--       src/lib/negocios/direccion-predio.ts.
--     SOLO AVISAN (en la tarjeta de datos clave); no frenan en ninguna etapa.
--
-- ── Medido el 2026-09-28, solo lectura ───────────────────────────────────────
-- 321 certificados de casos abiertos (Drive + la misma extracción de la app, sin
-- escribir), 315 con RUT para comparar:
--   departamento: 15 avisos (con `tokens` serían 16: «BOGOTÁ. D.C.» contra «Bogotá»).
--   ciudad:       19 avisos (con `tokens` serían 27: «Cartagena de Indias», «Cúcuta»).
--   dirección:    13 avisos (con `compacto` 32, con `contenido` 31). Los 19 que el modo
--                 nuevo deja pasar eran la misma dirección escrita de otra forma.
--   segundo beneficiario (8 copropiedades con dos filas): 0 avisos en los tres.
-- Los avisos que se revisaron contra el PDF son diferencias de verdad: o el certificado
-- dice otra ciudad que el RUT (V0398: Bogotá en el certificado, Bucaramanga en el RUT, con
-- la misma dirección), o el RUT quedó mal leído en ONE (V0129, V0258, V0326: el PDF del
-- RUT dice lo mismo que el certificado). En ambos casos hay un dato mal en algún lado; por
-- eso avisa, y como la mitad de las veces lo que está mal es el RUT de ONE y no el
-- certificado, no frena. Para volverlo freno basta cambiar `bloquea_en_etapas`.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- Inerte con el código viejo en la dirección: el modo `direccion` lo trae el PR de esta
-- migración, y el código viejo descarta un cruce con un modo que no conoce. Departamento
-- y ciudad usan un modo que ya existe y avisan en cuanto el certificado traiga el dato.
-- Se puede aplicar antes o después del merge.
--
-- ⚠️ Los certificados YA cargados no tienen estos campos: los cruces callan en ellos hasta
-- que se lean. Para llenarlos sin reprocesar (el reproceso borra datos), con esta migración
-- ya aplicada y primero SIN --commit:
--   npx tsx scripts/backfill-compradores-factura.ts soena --bloque concepto_upme \
--       --campos departamento_certificado,ciudad_certificado,direccion_certificado,departamento_certificado_2,ciudad_certificado_2,direccion_certificado_2
--   (y lo mismo con --bloque concepto_upme_anexos).
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  n          int;
  v_cruces jsonb := $cruces_ubicacion$
[
  {
    "slug": "certificado_departamento_titular",
    "tipo": "coincide",
    "mensaje": "El certificado UPME trae el departamento «{a_valor}» y el RUT del cliente dice «{b_valor}».",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "departamento_certificado" },
    "b": [
      { "source_bloque_slug": "rut", "field": "departamento" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "departamento" }
    ],
    "modo": "contenido",
    "bloquea_en_etapas": []
  },
  {
    "slug": "certificado_ciudad_titular",
    "tipo": "coincide",
    "mensaje": "El certificado UPME trae la ciudad «{a_valor}» y el RUT del cliente dice «{b_valor}».",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "ciudad_certificado" },
    "b": [
      { "source_bloque_slug": "rut", "field": "municipio" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "municipio" }
    ],
    "modo": "contenido",
    "bloquea_en_etapas": []
  },
  {
    "slug": "certificado_direccion_titular",
    "tipo": "coincide",
    "mensaje": "El certificado UPME trae la dirección «{a_valor}» y el RUT del cliente dice «{b_valor}».",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "direccion_certificado" },
    "b": [
      { "source_bloque_slug": "rut", "field": "direccion" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "direccion" }
    ],
    "modo": "direccion",
    "bloquea_en_etapas": []
  },
  {
    "slug": "certificado_departamento_titular_2",
    "tipo": "coincide",
    "mensaje": "El certificado UPME trae para el segundo beneficiario el departamento «{a_valor}» y los RUT dicen «{b_valor}».",
    "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "departamento_certificado_2" },
    "b": [
      { "source_bloque_slug": "rut", "field": "departamento" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "departamento" }
    ],
    "modo": "contenido",
    "bloquea_en_etapas": []
  },
  {
    "slug": "certificado_ciudad_titular_2",
    "tipo": "coincide",
    "mensaje": "El certificado UPME trae para el segundo beneficiario la ciudad «{a_valor}» y los RUT dicen «{b_valor}».",
    "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "ciudad_certificado_2" },
    "b": [
      { "source_bloque_slug": "rut", "field": "municipio" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "municipio" }
    ],
    "modo": "contenido",
    "bloquea_en_etapas": []
  },
  {
    "slug": "certificado_direccion_titular_2",
    "tipo": "coincide",
    "mensaje": "El certificado UPME trae para el segundo beneficiario la dirección «{a_valor}» y los RUT dicen «{b_valor}».",
    "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "direccion_certificado_2" },
    "b": [
      { "source_bloque_slug": "rut", "field": "direccion" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "direccion" }
    ],
    "modo": "direccion",
    "bloquea_en_etapas": []
  }
]
$cruces_ubicacion$::jsonb;
  v_campos jsonb := $campos_ubicacion$
[
  {
    "slug": "departamento_certificado",
    "tipo": "texto",
    "label": "Departamento del beneficiario",
    "required": false,
    "descripcion_ai": "Departamento del PRIMER beneficiario (primera fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna DPTO. Transcribir el texto tal como aparece (p. ej. «BOLÍVAR», «BOGOTÁ D.C.»). Si el certificado es una carta, el departamento de la dirección del destinatario. Nunca el de la UPME ni el del proveedor. Vacío si no aparece."
  },
  {
    "slug": "ciudad_certificado",
    "tipo": "texto",
    "label": "Ciudad del beneficiario",
    "required": false,
    "descripcion_ai": "Ciudad del PRIMER beneficiario (primera fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna CIUDAD. Transcribir el texto tal como aparece (p. ej. «CARTAGENA DE INDIAS»). Si el certificado es una carta, la ciudad de la dirección del destinatario. Nunca la de la UPME ni la del proveedor. Vacío si no aparece."
  },
  {
    "slug": "direccion_certificado",
    "tipo": "texto",
    "label": "Dirección del beneficiario",
    "required": false,
    "descripcion_ai": "Dirección del PRIMER beneficiario (primera fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna DIRECCIÓN. Transcribir la dirección COMPLETA tal como aparece, con barrio, edificio, torre y apartamento si los trae, sin abreviar ni expandir nada; si viene partida en varios renglones, unirlos con un espacio. Si el certificado es una carta, la dirección del destinatario. Nunca la de la UPME ni la del proveedor. Vacío si no aparece."
  },
  {
    "slug": "departamento_certificado_2",
    "tipo": "texto",
    "label": "Departamento (2º beneficiario)",
    "required": false,
    "descripcion_ai": "Departamento del SEGUNDO beneficiario (segunda fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna DPTO., SOLO si el certificado trae dos beneficiarios. Transcribir el texto tal como aparece. Vacío si hay un solo beneficiario o si no aparece."
  },
  {
    "slug": "ciudad_certificado_2",
    "tipo": "texto",
    "label": "Ciudad (2º beneficiario)",
    "required": false,
    "descripcion_ai": "Ciudad del SEGUNDO beneficiario (segunda fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna CIUDAD, SOLO si el certificado trae dos beneficiarios. Transcribir el texto tal como aparece. Vacío si hay un solo beneficiario o si no aparece."
  },
  {
    "slug": "direccion_certificado_2",
    "tipo": "texto",
    "label": "Dirección (2º beneficiario)",
    "required": false,
    "descripcion_ai": "Dirección del SEGUNDO beneficiario (segunda fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna DIRECCIÓN, SOLO si el certificado trae dos beneficiarios. Transcribir la dirección COMPLETA tal como aparece, sin abreviar ni expandir nada; si viene partida en varios renglones, unirlos con un espacio. Vacío si hay un solo beneficiario o si no aparece."
  }
]
$campos_ubicacion$::jsonb;
begin
  -- Los cruces del correo (20260925010000) tienen que estar: este frente va encima.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and l.workspace_id = ws_soena
         and c->>'slug' in ('certificado_correo_titular', 'certificado_correo_titular_2')) <> 2 then
    raise exception 'faltan los cruces del correo de 20260925010000: aplicar esa migración antes';
  end if;

  -- (2) Cruces de ubicación: al final, solo los que no estén (re-aplicable).
  update lineas_negocio l
     set config_extra = jsonb_set(
           l.config_extra,
           '{cruces}',
           l.config_extra->'cruces'
             || (select coalesce(jsonb_agg(c order by ord), '[]'::jsonb)
                   from jsonb_array_elements(v_cruces) with ordinality as t(c, ord)
                  where not exists (
                    select 1 from jsonb_array_elements(l.config_extra->'cruces') x
                     where x->>'slug' = c->>'slug'))
         )
   where l.id = linea_ve and l.workspace_id = ws_soena
     and jsonb_typeof(l.config_extra->'cruces') = 'array';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV con cruces y se actualizaron %', n; end if;

  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve
         and c->>'slug' in (select x->>'slug' from jsonb_array_elements(v_cruces) x)) <> 6 then
    raise exception 'los seis cruces de ubicación no quedaron exactamente una vez';
  end if;

  -- (1) Extracción del certificado: los seis campos, solo los que no estén.
  update bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{campos_extraccion}',
           coalesce(bc.config_extra->'campos_extraccion', '[]'::jsonb)
             || (select coalesce(jsonb_agg(c order by ord), '[]'::jsonb)
                   from jsonb_array_elements(v_campos) with ordinality as t(c, ord)
                  where not exists (
                    select 1 from jsonb_array_elements(coalesce(bc.config_extra->'campos_extraccion', '[]'::jsonb)) x
                     where x->>'slug' = c->>'slug'))
         )
    from etapas_negocio e
   where e.id = bc.etapa_id
     and e.linea_id = linea_ve
     and bc.workspace_id = ws_soena
     and bc.slug in ('concepto_upme', 'concepto_upme_anexos');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'se esperaban 2 bloques de certificado UPME y se actualizaron %', n; end if;

  if (select count(*) from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id,
                jsonb_array_elements(bc.config_extra->'campos_extraccion') c
       where e.linea_id = linea_ve and bc.slug in ('concepto_upme', 'concepto_upme_anexos')
         and c->>'slug' in (select x->>'slug' from jsonb_array_elements(v_campos) x)) <> 12 then
    raise exception 'los seis campos de ubicación no quedaron exactamente una vez en cada certificado';
  end if;
  -- Los correos siguen ahí (no se pisó la lista).
  if (select count(*) from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id,
                jsonb_array_elements(bc.config_extra->'campos_extraccion') c
       where e.linea_id = linea_ve and bc.slug in ('concepto_upme', 'concepto_upme_anexos')
         and c->>'slug' in ('correo_certificado', 'correo_certificado_2')) <> 4 then
    raise exception 'los correos del certificado ya no están en la extracción';
  end if;
end $$;
