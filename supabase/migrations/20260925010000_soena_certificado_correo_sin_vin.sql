-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-24
-- El certificado UPME ya no se cruza por VIN y pasa a cruzarse por el CORREO del cliente.
--
-- Ajuste de Mauricio sobre 20260924230000_soena_voto_documento_y_verificador_upme.sql.
-- Brief: proyectos/soena/ve/2026-09-24_brief-max-blindaje-lectura-documentos.md
--
-- Solo CONFIGURACIÓN (config_extra de una línea y de dos bloque_configs). No toca
-- negocio_bloques: ningún dato de ningún negocio cambia.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- (1) Quita el cruce `certificado_vin_vs_factura` y el campo `vin_certificado` de la
--     extracción del certificado: el certificado UPME no trae VIN (0 de 47 PDFs reales
--     revisados), así que el campo solo invitaba a la IA a inventarlo. El `vin` de la
--     factura se queda: la factura sí lo trae y no frena nada.
-- (2) El certificado lee el correo de notificación de cada beneficiario
--     (`correo_certificado`, `correo_certificado_2`).
-- (3) Dos cruces nuevos: el correo del certificado contra el que ONE tiene del cliente,
--     que es el del CONTACTO del negocio (`@contacto`) o el del RUT de cualquiera de los
--     dos titulares. Basta que coincida con uno: en la muestra de 47 PDFs el contacto
--     solo coincidía en 35 y el RUT en 44; juntos, en 46 (el que no, V0210, trae
--     «hotmaiol.com» en el certificado: un correo mal escrito ante la UPME).
--     SOLO AVISAN (en la tarjeta de datos clave); no frenan en ninguna etapa. Ver abajo.
--
-- ── Por qué no frena (medido 2026-09-24, solo lectura) ───────────────────────
-- Se leyó el correo de los 315 certificados de los casos abiertos (Drive + la misma
-- extracción de la app, sin escribir nada) y se evaluaron estos cruces: 12 discrepancias
-- (14 sin la tolerancia 1/l y 0/o del modo `correo`). De esas, solo V0210 («hotmaiol»)
-- y quizá V0326 (letras transpuestas) son un error que haya que corregir. Las demás son
-- correos que el cliente dio a la UPME a propósito (de trabajo, de otra persona de la
-- familia, del asesor, o `notificacionesupme@gmail.com`), lecturas de IA del RUT con una
-- letra corrida, o casos cuyo RUT no aplica porque les falta el tipo de persona. Frenar
-- ahí pararía casos sanos. Para volverlo freno basta cambiar `bloquea_en_etapas`.
--
-- El celular NO se cruza: el certificado no lo trae (1 de 47 PDFs, una carta del
-- formato viejo; el formato vigente solo trae CORREO DE NOTIFICACIÓN).
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- Inerte con el código viejo: el modo `correo` y la fuente `@contacto` los trae el PR
-- de esta migración, y el código viejo descarta un cruce con un modo que no conoce. Se
-- puede aplicar antes o después del merge.
--
-- ⚠️ Los certificados YA cargados no tienen `correo_certificado`: el cruce calla en
-- ellos hasta que se lea. Para llenarlo sin reprocesar (el reproceso borra datos), con
-- esta migración ya aplicada y primero SIN --commit:
--   npx tsx scripts/backfill-compradores-factura.ts soena --bloque concepto_upme \
--       --campos correo_certificado,correo_certificado_2
--   (y lo mismo con --bloque concepto_upme_anexos).
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  n          int;
  v_cruces_correo jsonb := $cruces_correo$
[
  {
    "slug": "certificado_correo_titular",
    "tipo": "coincide",
    "mensaje": "El certificado UPME notifica a «{a_valor}» y el correo que tenemos del cliente es «{b_valor}».",
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "correo_certificado" },
    "b": [
      { "source_bloque_slug": "@contacto", "field": "email" },
      { "source_bloque_slug": "rut", "field": "email" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "email" }
    ],
    "modo": "correo",
    "bloquea_en_etapas": []
  },
  {
    "slug": "certificado_correo_titular_2",
    "tipo": "coincide",
    "mensaje": "El certificado UPME notifica al segundo beneficiario a «{a_valor}» y los correos que tenemos del cliente son «{b_valor}».",
    "condition": { "field": "modalidad_solicitante", "value": "copropiedad", "source_bloque_slug": "titularidad" },
    "a": { "source_bloque_slug": "concepto_upme_anexos", "alternativas": ["concepto_upme"], "field": "correo_certificado_2" },
    "b": [
      { "source_bloque_slug": "@contacto", "field": "email" },
      { "source_bloque_slug": "rut", "field": "email" },
      { "source_bloque_slug": "rut_solicitante_2", "field": "email" }
    ],
    "modo": "correo",
    "bloquea_en_etapas": []
  }
]
$cruces_correo$::jsonb;
  v_campos_certificado jsonb := $campos_certificado$
[
  {
    "slug": "correo_certificado",
    "tipo": "texto",
    "label": "Correo de notificación",
    "required": false,
    "descripcion_ai": "Correo electrónico del PRIMER beneficiario (primera fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna CORREO DE NOTIFICACIÓN. Si el certificado es una carta, el correo que aparece debajo del nombre y la dirección del destinatario. Devolver la dirección completa tal como aparece, en minúsculas y sin espacios: a veces viene partida en dos renglones. Nunca un correo de la UPME ni de la DIAN (correspondencia@upme.gov.co, subdir_fisca_tributaria@dian.gov.co). Vacío si no aparece."
  },
  {
    "slug": "correo_certificado_2",
    "tipo": "texto",
    "label": "Correo de notificación (2º beneficiario)",
    "required": false,
    "descripcion_ai": "Correo electrónico del SEGUNDO beneficiario (segunda fila «Dueño del Proyecto») en la sección BENEFICIARIOS, columna CORREO DE NOTIFICACIÓN, SOLO si el certificado trae dos beneficiarios. Devolver la dirección completa tal como aparece, en minúsculas y sin espacios. Nunca un correo de la UPME ni de la DIAN. Vacío si hay un solo beneficiario o si no aparece."
  }
]
$campos_certificado$::jsonb;
begin
  -- (1a) Fuera el cruce del VIN.
  update lineas_negocio l
     set config_extra = jsonb_set(
           l.config_extra,
           '{cruces}',
           (select coalesce(jsonb_agg(c order by ord), '[]'::jsonb)
              from jsonb_array_elements(l.config_extra->'cruces') with ordinality as t(c, ord)
             where c->>'slug' <> 'certificado_vin_vs_factura')
         )
   where l.id = linea_ve and l.workspace_id = ws_soena
     and jsonb_typeof(l.config_extra->'cruces') = 'array';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV con cruces y se actualizaron %', n; end if;

  -- (3) Cruces del correo: al final, solo los que no estén (re-aplicable).
  update lineas_negocio l
     set config_extra = jsonb_set(
           l.config_extra,
           '{cruces}',
           l.config_extra->'cruces'
             || (select coalesce(jsonb_agg(c order by ord), '[]'::jsonb)
                   from jsonb_array_elements(v_cruces_correo) with ordinality as t(c, ord)
                  where not exists (
                    select 1 from jsonb_array_elements(l.config_extra->'cruces') x
                     where x->>'slug' = c->>'slug'))
         )
   where l.id = linea_ve and l.workspace_id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV al agregar cruces y se actualizaron %', n; end if;

  if exists (select 1 from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
              where l.id = linea_ve and c->>'slug' = 'certificado_vin_vs_factura') then
    raise exception 'el cruce del VIN sigue en la línea';
  end if;
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and c->>'slug' in ('certificado_correo_titular', 'certificado_correo_titular_2')) <> 2 then
    raise exception 'los dos cruces del correo no quedaron exactamente una vez';
  end if;
  -- Los otros cinco cruces del certificado (20260924230000) siguen ahí.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve
         and c->>'slug' in ('certificado_nombre_titular', 'certificado_nombre_titular_2', 'certificado_valor_vs_factura',
                            'certificado_marca_vs_factura', 'certificado_proveedor_vs_factura')) <> 5 then
    raise exception 'faltan cruces de 20260924230000: aplicar esa migración antes';
  end if;

  -- (1b) + (2) Extracción del certificado: sin VIN, con los dos correos.
  update bloque_configs bc
     set config_extra = jsonb_set(
           bc.config_extra,
           '{campos_extraccion}',
           (select coalesce(jsonb_agg(c order by ord), '[]'::jsonb)
              from jsonb_array_elements(coalesce(bc.config_extra->'campos_extraccion', '[]'::jsonb)) with ordinality as t(c, ord)
             where c->>'slug' <> 'vin_certificado')
             || (select coalesce(jsonb_agg(c), '[]'::jsonb)
                   from jsonb_array_elements(v_campos_certificado) c
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

  if exists (select 1 from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id,
                    jsonb_array_elements(bc.config_extra->'campos_extraccion') c
              where e.linea_id = linea_ve and bc.slug in ('concepto_upme', 'concepto_upme_anexos')
                and c->>'slug' = 'vin_certificado') then
    raise exception 'el certificado sigue leyendo el VIN';
  end if;
  if (select count(*) from bloque_configs bc join etapas_negocio e on e.id = bc.etapa_id,
                jsonb_array_elements(bc.config_extra->'campos_extraccion') c
       where e.linea_id = linea_ve and bc.slug in ('concepto_upme', 'concepto_upme_anexos')
         and c->>'slug' in ('correo_certificado', 'correo_certificado_2')) <> 4 then
    raise exception 'los dos correos no quedaron exactamente una vez en cada certificado';
  end if;
end $$;
