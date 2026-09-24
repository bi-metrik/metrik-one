-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-24
-- Datos clave en la barra lateral, y que el sistema detecte la doble titularidad.
--
-- Brief: proyectos/soena/ve/2026-09-24_brief-max-datos-clave-y-titularidad.md
-- Verdad de terreno: proyectos/soena/ve/2026-09-24_auditoria-28-casos-titularidad.md
--
-- Solo CONFIGURACIÓN (config_extra de una línea y de cinco bloque_configs). No crea
-- tablas ni funciones y no toca negocio_bloques: ningún dato de ningún negocio cambia.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- (1) `lineas_negocio.config_extra.datos_clave`: la tarjeta «Datos clave» de la ficha
--     (servicio, tipo de persona, titularidad con los nombres de los titulares, tarifa
--     UPME confirmada o cotizada, cita DIAN con su fecha).
-- (2) `lineas_negocio.config_extra.cruces`: cuatro cruces que se evalúan al leer el
--     negocio y al intentar avanzar. Frenan (omitible con el permiso de omitir gates y
--     motivo escrito) solo donde lo dice `bloquea_en_etapas`; en las demás etapas se ven
--     en rojo en la tarjeta.
--       · factura (cantidad de compradores) vs titularidad ........ frena en Documentación (6)
--       · documento del RUT entre los compradores de la factura ... frena en Documentación (6)
--       · documento del RUT del 2º titular entre los compradores .. frena en Documentación (6)
--       · personas del certificado UPME vs titularidad ............ frena de Certificación (9) en adelante
-- (3) `concepto_upme` y `concepto_upme_anexos`: los checks del 2º solicitante dejan de
--     ser opcionales cuando la titularidad es copropiedad (`required_when`).
-- (4) `factura_venta_vehiculo`: la extracción lee `compradores` (lista con nombre y
--     documento) y `cantidad_compradores`. Solo para lo que se cargue o reprocese de
--     aquí en adelante: los casos abiertos se completan con
--     `scripts/backfill-compradores-factura.ts`, que NO re-extrae los demás campos.
-- (5) `numero_solicitantes` (Validación): sale también del historial
--     (`oculto_en_historial`). Ya estaba fuera de la etapa (`visible: false`) y sin gate
--     desde el 29-jul; el dato NO se borra.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- Se aplica ANTES del merge. Con el código viejo todo esto es INERTE: ninguna de estas
-- claves la lee nadie hasta que el deploy llega (`datos_clave`, `cruces`,
-- `required_when`, `oculto_en_historial`). La única que el código viejo sí consume son
-- los dos campos nuevos de la factura: una factura cargada en esa ventana se extrae con
-- ellos como texto libre, que es inofensivo.
--
-- ── Medido contra producción antes de escribir esto (2026-09-24, solo lectura) ─
-- · 438 negocios abiertos en la línea. Certificado vs titularidad: 306 coinciden,
--   126 no se pueden comprobar todavía (sin certificado o sin titularidad) y 6 se
--   contradicen: V0151, V0165, V0198 (Cita) y V0141 (Seguimiento), copropiedad con
--   certificado a una persona; V0321 (Cita) y V0323 (Seguimiento), «único» con un
--   certificado que trae a INNVENTOR ELECTRONICS SAS como 2º beneficiario. Esos 6
--   quedan frenados al intentar avanzar hasta que alguien lo resuelva u omita con motivo.
-- · Los cruces de la factura no frenan a nadie el día que esto se aplica: ninguna
--   factura existente tiene `compradores` hasta que corra el backfill.
-- · Extracción de compradores sobre el banco de 28 facturas de la auditoría: 28 de 28
--   contra lo que dice el PDF, dos corridas idénticas. El único desacuerdo con la
--   auditoría es V0465, donde la factura sí trae una corregistrante al 50 % que la
--   auditoría no vio.
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  n          int;
  v_datos_clave    jsonb := $datos_clave$
{
  "titulo": "Datos clave",
  "campos": [
    {
      "label": "Servicio",
      "source_bloque_slug": "servicio_contratado",
      "field": "servicio",
      "etiquetas": { "completo": "Completo (UPME + IVA)", "solo_iva": "Solo IVA", "solo_upme": "Solo UPME" }
    },
    {
      "label": "Tipo de persona",
      "source_bloque_slug": "tipo_de_solicitante",
      "field": "tipo_persona",
      "etiquetas": { "natural": "Natural", "juridica": "Jurídica" }
    },
    {
      "label": "Titularidad",
      "source_bloque_slug": "titularidad",
      "field": "modalidad_solicitante",
      "etiquetas": { "unico": "Único", "copropiedad": "Copropiedad", "leasing": "Leasing" },
      "detalle": [
        { "source_bloque_slug": "rut", "field": "razon_social" },
        { "source_bloque_slug": "rut_solicitante_2", "field": "razon_social" }
      ]
    },
    {
      "label": "Tarifa UPME",
      "source_bloque_slug": "confirmar_tarifa_upme",
      "field": "tarifa_upme_confirmada",
      "formato": "moneda",
      "condition": { "source_bloque_slug": "confirmar_tarifa_upme", "field": "tarifa_confirmada", "value": "true" },
      "alternativas": [
        { "source_bloque_slug": "propuesta_economica", "field": "tarifa_upme", "formato": "moneda", "nota": "cotizada" }
      ]
    },
    {
      "label": "Cita DIAN",
      "source_bloque_slug": "cita_dian_requerida",
      "field": "requiere_cita_dian",
      "etiquetas": { "true": "Sí", "false": "No" },
      "alternativas": [
        { "source_bloque_slug": "cita_dian_iva", "field": "requiere_cita_dian_iva", "etiquetas": { "true": "Sí", "false": "No" } }
      ],
      "detalle": [
        { "source_bloque_slug": "fecha_cita_dian", "field": "fecha_cita_dian", "formato": "fecha_hora", "mostrar_aunque_no_aplique": true }
      ]
    }
  ]
}
$datos_clave$::jsonb;
  v_cruces   jsonb := $cruces$
[
  {
    "slug": "factura_compradores_vs_titularidad",
    "tipo": "cantidad",
    "mensaje": "La factura trae {a} y la titularidad dice «{b_valor}».",
    "a": { "source_bloque_slug": "factura_venta_vehiculo", "field": "cantidad_compradores", "unidad": ["comprador", "compradores"] },
    "b": { "source_bloque_slug": "titularidad", "field": "modalidad_solicitante", "mapeo": { "unico": 1, "copropiedad": 2 } },
    "bloquea_en_etapas": [6]
  },
  {
    "slug": "rut_entre_compradores",
    "tipo": "documento_en_lista",
    "mensaje": "El documento del RUT ({documento}) no está entre los compradores de la factura: {lista}.",
    "documento": { "source_bloque_slug": "rut", "field": "numero_identificacion" },
    "lista": { "source_bloque_slug": "factura_venta_vehiculo", "field": "compradores" },
    "condition": { "source_bloque_slug": "titularidad", "field": "modalidad_solicitante", "value_in": ["unico", "copropiedad"] },
    "bloquea_en_etapas": [6]
  },
  {
    "slug": "rut2_entre_compradores",
    "tipo": "documento_en_lista",
    "mensaje": "El documento del RUT del segundo titular ({documento}) no está entre los compradores de la factura: {lista}.",
    "documento": { "source_bloque_slug": "rut_solicitante_2", "field": "numero_identificacion" },
    "lista": { "source_bloque_slug": "factura_venta_vehiculo", "field": "compradores" },
    "condition": { "source_bloque_slug": "titularidad", "field": "modalidad_solicitante", "value": "copropiedad" },
    "bloquea_en_etapas": [6]
  },
  {
    "slug": "certificado_personas_vs_titularidad",
    "tipo": "cantidad",
    "mensaje": "El certificado UPME trae {a} y la titularidad dice «{b_valor}».",
    "a": {
      "source_bloque_slug": "concepto_upme_anexos",
      "alternativas": ["concepto_upme"],
      "contar_campos": ["nombre_certificado", "nombre_certificado_2"],
      "unidad": ["solicitante", "solicitantes"]
    },
    "b": { "source_bloque_slug": "titularidad", "field": "modalidad_solicitante", "mapeo": { "unico": 1, "copropiedad": 2 } },
    "bloquea_en_etapas": [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
  }
]
$cruces$::jsonb;
  v_required_when  jsonb := $required_when$
{ "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad", "source_etapa_orden": 4 }
$required_when$::jsonb;
  v_campos_factura jsonb := $campos_factura$
[
  {
    "slug": "compradores",
    "tipo": "personas",
    "label": "Compradores",
    "required": false,
    "descripcion_ai": "TODAS las personas a cuyo nombre se factura el vehículo (compradores, adquirentes o clientes), cada una con su nombre completo y su número de documento (cédula o NIT, solo dígitos). Una entrada por persona. Formatos habituales en facturas de concesionarios: un bloque \"COMPRADOR(ES)\" con dos personas y su % de participación; dos columnas o dos recuadros \"CLIENTE\"; \"CLIENTE 1\" y \"CLIENTE 2\"; una tabla \"VENDIDO A\" o \"NOMBRES / DOC. IDENTIDAD\" con dos filas; o la leyenda \"FACTURA A NOMBRE DE DOS PERSONAS\". Si el encabezado muestra un solo \"Nombre Cliente\" pero en otra parte de la factura aparecen dos compradores con su documento o su % de participación, devolver LOS DOS. NO incluir: al vendedor o emisor de la factura, al asesor o vendedor comercial, a la entidad financiera (\"FINANCIADO POR\", banco, leasing, prenda), al proveedor tecnológico de la factura electrónica, ni a terceros autorizados o a quien recibe el vehículo. Si la misma persona aparece varias veces, devolverla una sola vez."
  },
  {
    "slug": "cantidad_compradores",
    "tipo": "numero",
    "label": "Cantidad de compradores",
    "required": false,
    "descripcion_ai": "Cuántas personas figuran como compradoras (adquirentes) del vehículo en la factura: normalmente 1 o 2. Tiene que coincidir con la lista de compradores. Si la factura dice \"FACTURA A NOMBRE DE DOS PERSONAS\" o reparte un % de participación entre dos personas, es 2. El vendedor, el asesor, la financiera y el proveedor tecnológico NO cuentan. Solo el número entero."
  }
]
$campos_factura$::jsonb;
begin
  -- (1) y (2) Tarjeta y cruces de la línea.
  update lineas_negocio
     set config_extra = coalesce(config_extra, '{}'::jsonb)
                        || jsonb_build_object('datos_clave', v_datos_clave, 'cruces', v_cruces)
   where id = linea_ve and workspace_id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV y se actualizaron %', n; end if;

  -- (3) El 2º solicitante del certificado es obligatorio en copropiedad. Se conserva
  -- `optional: true`: fuera de la copropiedad (leasing con banco, único) sigue igual.
  update bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{cross_check,checks}',
           (select jsonb_agg(
                     case when chk->>'slug' in ('nombre_certificado_2', 'numero_identificacion_certificado_2')
                          then chk || jsonb_build_object('required_when', v_required_when)
                          else chk end
                     order by ord)
              from jsonb_array_elements(bc.config_extra->'cross_check'->'checks') with ordinality as t(chk, ord))
         )
    from etapas_negocio e
   where e.id = bc.etapa_id
     and e.linea_id = linea_ve
     and bc.workspace_id = ws_soena
     and bc.slug in ('concepto_upme', 'concepto_upme_anexos');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'se esperaban 2 bloques de certificado UPME y se actualizaron %', n; end if;

  if (select count(*)
        from bloque_configs bc
        join etapas_negocio e on e.id = bc.etapa_id,
             jsonb_array_elements(bc.config_extra->'cross_check'->'checks') chk
       where e.linea_id = linea_ve
         and bc.slug in ('concepto_upme', 'concepto_upme_anexos')
         and chk ? 'required_when') <> 4 then
    raise exception 'se esperaban 4 checks con required_when (2 por bloque de certificado)';
  end if;

  -- (4) La factura lee a los compradores. Solo se agregan si no están (re-aplicable).
  update bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{campos_extraccion}',
           coalesce(bc.config_extra->'campos_extraccion', '[]'::jsonb)
             || (select coalesce(jsonb_agg(c), '[]'::jsonb)
                   from jsonb_array_elements(v_campos_factura) c
                  where not exists (
                    select 1 from jsonb_array_elements(bc.config_extra->'campos_extraccion') x
                     where x->>'slug' = c->>'slug'))
         )
    from etapas_negocio e
   where e.id = bc.etapa_id
     and e.linea_id = linea_ve
     and bc.workspace_id = ws_soena
     and bc.slug = 'factura_venta_vehiculo';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 bloque factura_venta_vehiculo y se actualizaron %', n; end if;

  -- (5) La pregunta vieja sale también del historial. El dato queda intacto.
  update bloque_configs bc
     set config_extra = bc.config_extra || '{"oculto_en_historial": true}'::jsonb
    from etapas_negocio e
   where e.id = bc.etapa_id
     and e.linea_id = linea_ve
     and bc.workspace_id = ws_soena
     and bc.slug = 'numero_solicitantes';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 bloque numero_solicitantes y se actualizaron %', n; end if;

  -- Ningún condition, cross_check ni routing de la línea lee `numero_solicitantes`
  -- (barrido del 2026-09-24 sobre bloque_configs, etapas_negocio, lineas_negocio y el
  -- workspace; el código de ONE y de metrik-pdf-render tampoco). Si alguien lo vuelve a
  -- referenciar, ocultarlo escondería un dato que decide algo: mejor fallar aquí.
  if exists (
    select 1 from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id
     where e.linea_id = linea_ve
       and bc.slug is distinct from 'numero_solicitantes'
       and bc.config_extra::text like '%numero_solicitantes%'
  ) or exists (
    select 1 from etapas_negocio where linea_id = linea_ve and config_extra::text like '%numero_solicitantes%'
  ) then
    raise exception 'otro bloque o etapa referencia numero_solicitantes: revisar antes de ocultarlo';
  end if;
end $$;
