-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-24
-- El documento de cada titular se vota entre el RUT, la factura y el certificado UPME,
-- y el certificado UPME pasa a ser verificador que frena.
--
-- Brief: proyectos/soena/ve/2026-09-24_brief-max-blindaje-lectura-documentos.md
--
-- Solo CONFIGURACIÓN (config_extra de una línea y de tres bloque_configs). No crea
-- tablas ni funciones y no toca negocio_bloques: ningún dato de ningún negocio cambia.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- (1) `lineas_negocio.config_extra.votos`: dos votos, uno por titular. Fuentes del
--     número de documento: RUT casilla 26, RUT casilla 5 (solo con cédula de
--     ciudadanía: con cédula de extranjería el NIT difiere del documento y no vota),
--     la persona del titular en los compradores de la factura y en los beneficiarios del
--     certificado (Anexos primero, Certificación después). Frenan en Documentación (6),
--     Certificación (9) y Anexos (18), omitible con permiso y motivo, y con una lectura
--     en disputa que alimenta documentos (el RUT) NO se genera ningún formulario.
-- (2) `lineas_negocio.config_extra.cruces`: seis cruces nuevos del certificado UPME,
--     que frenan en Certificación (9) y en Anexos (18). Se AGREGAN a los que ya existen
--     (los cuatro de 20260924190000), sin tocar esos, y solo si su slug no está.
--       · nombre del beneficiario 1 contra los RUT (cualquier orden de palabras)
--       · nombre del beneficiario 2 contra los RUT (solo copropiedad)
--       · valor de la inversión contra la factura sin IVA (tolerancia $1.000)
--       · marca contra la factura (Deepal = Changan)
--       · VIN / chasis contra la factura
--       · proveedor contra la factura (una razón social dentro de la otra)
--     El número de documento del certificado NO va aquí: lo cubre el voto (1).
--     La cantidad de titulares ya la cubre `certificado_personas_vs_titularidad`.
--     La línea/modelo NO frena: el certificado y la factura la escriben distinto en 31 de
--     315 casos abiertos («Model Y» / «Modelo Y», «RAV 4» / «RAV4»); frenar ahí pararía
--     casos sanos. Sigue en el panel del documento al cargarlo, como hasta hoy.
-- (3) Extracción: el certificado lee `vin_certificado` y `proveedor_certificado`, y la
--     factura lee `vin`. Solo para lo que se cargue o reprocese de aquí en adelante; en
--     los documentos ya cargados esos campos no existen y sus cruces callan.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- Inerte con el código viejo: nadie lee `votos` ni el cruce tipo `coincide` hasta el
-- deploy del PR que los trae (el código viejo descarta un cruce de tipo desconocido).
-- Los campos nuevos de extracción el código viejo sí los consume: un documento cargado
-- en esa ventana los extrae como texto, que es inofensivo. Se puede aplicar antes o
-- después del merge.
--
-- ── Medido contra producción (2026-09-24, solo lectura; ver el PR) ───────────
-- Casos abiertos con lectura dudosa por fuente y los que quedan frenados, en el cuerpo
-- del PR. V0142 y V0355: casilla 26 del RUT dudosa. V0164: el certificado.
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  n          int;
  v_votos    jsonb := $votos$
[
  {
    "slug": "documento_titular",
    "label": "Documento del titular",
    "condition": { "field": "tipo_persona", "value": "natural", "source_bloque_slug": "tipo_de_solicitante" },
    "nombre": { "source_bloque_slug": "rut", "field": "razon_social" },
    "bloquea_en_etapas": [6, 9, 18],
    "niega_generacion": true,
    "fuentes": [
      { "etiqueta": "RUT (casilla 26)", "source_bloque_slug": "rut", "field": "numero_identificacion", "alimenta_generacion": true },
      { "etiqueta": "RUT (casilla 5)", "source_bloque_slug": "rut", "field": "nit", "dv": "dv", "alimenta_generacion": true,
        "si": { "field": "tipo_documento", "value_in": ["Cédula de Ciudadanía"] } },
      { "etiqueta": "Factura", "source_bloque_slug": "factura_venta_vehiculo", "lista": "compradores" },
      { "etiqueta": "Certificado UPME", "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"],
        "personas": [
          { "nombre": "nombre_certificado", "documento": "numero_identificacion_certificado" },
          { "nombre": "nombre_certificado_2", "documento": "numero_identificacion_certificado_2" }
        ] }
    ]
  },
  {
    "slug": "documento_titular_2",
    "label": "Documento del segundo titular",
    "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
    "nombre": { "source_bloque_slug": "rut_solicitante_2", "field": "razon_social" },
    "bloquea_en_etapas": [6, 9, 18],
    "niega_generacion": true,
    "fuentes": [
      { "etiqueta": "RUT 2 (casilla 26)", "source_bloque_slug": "rut_solicitante_2", "field": "numero_identificacion", "alimenta_generacion": true },
      { "etiqueta": "Factura", "source_bloque_slug": "factura_venta_vehiculo", "lista": "compradores" },
      { "etiqueta": "Certificado UPME", "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"],
        "personas": [
          { "nombre": "nombre_certificado", "documento": "numero_identificacion_certificado" },
          { "nombre": "nombre_certificado_2", "documento": "numero_identificacion_certificado_2" }
        ] }
    ]
  }
]
$votos$::jsonb;
  v_cruces_cert jsonb := $cruces_cert$
[
  {
    "slug": "certificado_nombre_titular",
    "tipo": "coincide",
    "mensaje": "El certificado UPME está a nombre de «{a_valor}» y el RUT dice «{b_valor}».",
    "condition": { "field": "tipo_persona", "value": "natural", "source_bloque_slug": "tipo_de_solicitante" },
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "nombre_certificado" },
    "b": [
      { "source_bloque_slug": "rut", "field": "razon_social" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "razon_social" }
    ],
    "modo": "tokens",
    "bloquea_en_etapas": [9, 18]
  },
  {
    "slug": "certificado_nombre_titular_2",
    "tipo": "coincide",
    "mensaje": "El segundo beneficiario del certificado UPME es «{a_valor}» y los RUT dicen «{b_valor}».",
    "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "nombre_certificado_2" },
    "b": [
      { "source_bloque_slug": "rut", "field": "razon_social" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "razon_social" }
    ],
    "modo": "tokens",
    "bloquea_en_etapas": [9, 18]
  },
  {
    "slug": "certificado_valor_vs_factura",
    "tipo": "coincide",
    "mensaje": "El certificado UPME aprueba una inversión de {a_valor} pesos y la factura dice {b_valor} sin IVA.",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "valor_total_certificado" },
    "b": [ { "source_bloque_slug": "factura_venta_vehiculo", "field": "valor_unitario_sin_iva" } ],
    "modo": "monto",
    "tolerancia_cop": 1000,
    "bloquea_en_etapas": [9, 18]
  },
  {
    "slug": "certificado_marca_vs_factura",
    "tipo": "coincide",
    "mensaje": "El certificado UPME dice marca «{a_valor}» y la factura «{b_valor}».",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "marca_certificado" },
    "b": [ { "source_bloque_slug": "factura_venta_vehiculo", "field": "marca" } ],
    "modo": "palabra_comun",
    "equivalencias": [["deepal", "changan"]],
    "bloquea_en_etapas": [9, 18]
  },
  {
    "slug": "certificado_vin_vs_factura",
    "tipo": "coincide",
    "mensaje": "El VIN del certificado UPME ({a_valor}) no es el de la factura ({b_valor}).",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "vin_certificado" },
    "b": [ { "source_bloque_slug": "factura_venta_vehiculo", "field": "vin" } ],
    "modo": "compacto",
    "bloquea_en_etapas": [9, 18]
  },
  {
    "slug": "certificado_proveedor_vs_factura",
    "tipo": "coincide",
    "mensaje": "El certificado UPME dice proveedor «{a_valor}» y la factura la emitió «{b_valor}».",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "proveedor_certificado" },
    "b": [ { "source_bloque_slug": "factura_venta_vehiculo", "field": "proveedor" } ],
    "modo": "contenido",
    "bloquea_en_etapas": [9, 18]
  }
]
$cruces_cert$::jsonb;
  v_campos_certificado jsonb := $campos_certificado$
[
  {
    "slug": "vin_certificado",
    "tipo": "texto",
    "label": "VIN / chasis",
    "required": false,
    "descripcion_ai": "Número de identificación vehicular (VIN) o número de chasis o serie del vehículo en la sección BIENES APROBADOS, SOLO si el certificado lo trae. Solo letras y dígitos, sin espacios ni guiones. Vacío si no aparece."
  },
  {
    "slug": "proveedor_certificado",
    "tipo": "texto",
    "label": "Proveedor",
    "required": false,
    "descripcion_ai": "Razón social del proveedor, vendedor o importador del bien en la sección BIENES APROBADOS, SOLO si el certificado la trae. Devolver el texto tal como aparece. Vacío si no aparece."
  }
]
$campos_certificado$::jsonb;
  v_campos_factura jsonb := $campos_factura$
[
  {
    "slug": "vin",
    "tipo": "texto",
    "label": "VIN / chasis",
    "required": false,
    "descripcion_ai": "Número de identificación vehicular (VIN) o número de chasis del vehículo facturado, tal como aparece en la factura (17 caracteres en los vehículos modernos). Solo letras y dígitos, sin espacios ni guiones. Vacío si la factura no lo trae."
  }
]
$campos_factura$::jsonb;
begin
  -- (1) Votos: clave nueva de la línea.
  update lineas_negocio
     set config_extra = coalesce(config_extra, '{}'::jsonb) || jsonb_build_object('votos', v_votos)
   where id = linea_ve and workspace_id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV y se actualizaron %', n; end if;

  -- (2) Cruces del certificado: se agregan al final, solo los que no estén (re-aplicable).
  update lineas_negocio l
     set config_extra = jsonb_set(
           l.config_extra,
           '{cruces}',
           coalesce(l.config_extra->'cruces', '[]'::jsonb)
             || (select coalesce(jsonb_agg(c order by ord), '[]'::jsonb)
                   from jsonb_array_elements(v_cruces_cert) with ordinality as t(c, ord)
                  where not exists (
                    select 1 from jsonb_array_elements(coalesce(l.config_extra->'cruces', '[]'::jsonb)) x
                     where x->>'slug' = c->>'slug'))
         )
   where l.id = linea_ve and l.workspace_id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV al agregar cruces y se actualizaron %', n; end if;

  -- Los cuatro cruces que ya existían siguen ahí, y los seis nuevos entraron una vez.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve
         and c->>'slug' in ('factura_compradores_vs_titularidad', 'rut_entre_compradores',
                            'rut2_entre_compradores', 'certificado_personas_vs_titularidad')) <> 4 then
    raise exception 'los cuatro cruces de 20260924190000 no están: aplicar esa migración antes';
  end if;
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and c->>'slug' like 'certificado\_%\_vs\_factura' escape '\') <> 4
     or (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
          where l.id = linea_ve and c->>'slug' in ('certificado_nombre_titular', 'certificado_nombre_titular_2')) <> 2 then
    raise exception 'los seis cruces del certificado no quedaron exactamente una vez';
  end if;

  -- (3a) El certificado lee VIN y proveedor. Solo se agregan si no están.
  update bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{campos_extraccion}',
           coalesce(bc.config_extra->'campos_extraccion', '[]'::jsonb)
             || (select coalesce(jsonb_agg(c), '[]'::jsonb)
                   from jsonb_array_elements(v_campos_certificado) c
                  where not exists (
                    select 1 from jsonb_array_elements(bc.config_extra->'campos_extraccion') x
                     where x->>'slug' = c->>'slug'))
         )
    from etapas_negocio e
   where e.id = bc.etapa_id
     and e.linea_id = linea_ve
     and bc.workspace_id = ws_soena
     and bc.slug in ('concepto_upme', 'concepto_upme_anexos');
  get diagnostics n = row_count;
  if n <> 2 then raise exception 'se esperaban 2 bloques de certificado UPME y se actualizaron %', n; end if;

  -- (3b) La factura lee el VIN.
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
end $$;
