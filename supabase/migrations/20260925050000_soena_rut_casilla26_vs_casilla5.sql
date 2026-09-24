-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-24
-- La casilla 26 del RUT se cruza contra la casilla 5 (el NIT) como TESTIGO, en los
-- dos titulares.
--
-- Brief: proyectos/soena/ve/2026-09-24_brief-max-casilla26-vs-casilla5.md
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- La IA pegó un dígito de más al final de la casilla 26 en tres casos que hubo que
-- corregir a mano el 24-sep: V0326 520238523 (es 52023852), V0354 168394259 (16839425)
-- y V0361 397853081 (39785308, el «1» de la fecha de expedición de la casilla 27). En
-- los tres el NIT de la casilla 5 estaba bien leído, y ningún control lo atrapó: el voto
-- daba «uno empieza por el otro» como el mismo número.
--
-- El código (mismo PR) deja de tolerar dígitos de más que no son el DV y agrega la
-- fuente TESTIGO: vota solo si su número es el de otra fuente o lo contiene con uno o
-- dos dígitos de más, y en ese caso gana el empate (la casilla 26 queda dudosa y se
-- ofrece corregirla al valor de la casilla 5). Si es un número del todo distinto (V0012:
-- NIT 700004389 asignado antes de la cédula 1015442918) no vota y deja un aviso que NO
-- frena ni niega la generación.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- Solo CONFIGURACIÓN (config_extra de la línea y de un bloque_config). No toca
-- negocio_bloques: ningún dato de ningún negocio cambia.
--   (1) `lineas_negocio.config_extra.votos`: reemplaza los dos votos de
--       20260924230000 por la versión nueva. Cambios, y nada más:
--         · documento_titular: la fuente «RUT (casilla 5)» pasa a `testigo: true` y su
--           condición acepta también el código «13» y el tipo vacío (un RUT sin la
--           casilla 25 leída sigue cruzando: con número distinto solo avisa).
--         · documento_titular_2: gana la fuente «RUT 2 (casilla 5)», testigo, que antes
--           no existía (el segundo titular no cruzaba la 26 contra la 5).
--       Aborta si los votos vigentes no son los de 20260924230000 (alguien los cambió
--       después y esto los pisaría).
--   (2) `rut_solicitante_2` lee `tipo_documento` (la casilla 25), con la misma
--       instrucción que ya tiene `rut`. Solo para lo que se cargue o reprocese de aquí en
--       adelante: en los RUT 2 ya cargados el campo no existe y la condición los deja
--       cruzar igual (tipo vacío), con aviso sin freno si el número es distinto.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- ANTES del merge (la sesión principal la aplica). Con el código viejo, la clave
-- `testigo` se ignora: la casilla 5 del titular 1 vota como antes (y con el tipo vacío
-- ahora también vota), y la del titular 2 vota como fuente normal. En esa ventana un
-- segundo titular con cédula de extranjería y RUT sin casilla 25 leída quedaría «sin
-- mayoría» y frenaría: la ventana tiene que ser corta. Al revés (código antes que
-- config) es inocuo: el código nuevo sin `testigo` solo endurece el «mismo número».
--
-- ── Medido contra producción (2026-09-24, solo lectura) ─────────────────────
-- Ver el cuerpo del PR: V0326, V0354 y V0361 con los valores del respaldo salen
-- dudosos y niegan generar; V0521 y V0177 (respaldo del prefijo 13) no dan aviso
-- tras la normalización del #908; V0012 da un aviso que no frena.
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  bc_rut     constant uuid := 'b734032c-19ca-4084-8664-ed2e3036b648';
  bc_rut2    constant uuid := '3c1d18e8-dcf2-49fe-ad40-5997ee185f72';
  n          int;
  v_actual   jsonb;
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
      { "etiqueta": "RUT (casilla 5)", "source_bloque_slug": "rut", "field": "nit", "dv": "dv", "alimenta_generacion": true, "testigo": true,
        "si": { "field": "tipo_documento", "value_in": ["Cédula de Ciudadanía", "13", ""] } },
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
      { "etiqueta": "RUT 2 (casilla 5)", "source_bloque_slug": "rut_solicitante_2", "field": "nit", "alimenta_generacion": true, "testigo": true,
        "si": { "field": "tipo_documento", "value_in": ["Cédula de Ciudadanía", "13", ""] } },
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
  v_tipo_doc jsonb;
begin
  -- (1) Votos. Los vigentes tienen que ser los de 20260924230000: la casilla 5 del
  --     titular 1 sin testigo y el titular 2 con tres fuentes. Si no, alguien los cambió.
  select config_extra->'votos' into v_actual
    from lineas_negocio where id = linea_ve and workspace_id = ws_soena;
  if v_actual is null then
    raise exception 'la línea GIT EV/HEV no tiene votos: aplicar 20260924230000 antes';
  end if;
  if not (v_actual = v_votos) then
    if jsonb_array_length(v_actual) <> 2
       or v_actual->0->>'slug' <> 'documento_titular'
       or v_actual->1->>'slug' <> 'documento_titular_2'
       or jsonb_array_length(v_actual->0->'fuentes') <> 4
       or v_actual->0->'fuentes'->1->>'etiqueta' <> 'RUT (casilla 5)'
       or (v_actual->0->'fuentes'->1) ? 'testigo'
       or jsonb_array_length(v_actual->1->'fuentes') <> 3 then
      raise exception 'los votos vigentes no son los de 20260924230000; revisar antes de pisarlos: %', v_actual;
    end if;
  end if;

  update lineas_negocio
     set config_extra = config_extra || jsonb_build_object('votos', v_votos)
   where id = linea_ve and workspace_id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV y se actualizaron %', n; end if;

  -- (2) El RUT 2 lee la casilla 25, con la misma instrucción que el RUT del titular 1.
  select e into v_tipo_doc
    from bloque_configs b, jsonb_array_elements(b.config_extra->'campos_extraccion') e
   where b.id = bc_rut and b.workspace_id = ws_soena and e->>'slug' = 'tipo_documento';
  if v_tipo_doc is null then raise exception 'el bloque rut no tiene tipo_documento que copiar'; end if;

  update bloque_configs b
     set config_extra = jsonb_set(
           b.config_extra, '{campos_extraccion}',
           b.config_extra->'campos_extraccion' || jsonb_build_array(v_tipo_doc))
   where b.id = bc_rut2 and b.workspace_id = ws_soena and b.slug = 'rut_solicitante_2'
     and not exists (
       select 1 from jsonb_array_elements(b.config_extra->'campos_extraccion') x
        where x->>'slug' = 'tipo_documento');
  -- 0 filas = ya estaba (re-aplicable); más de 1 no puede pasar por el id.

  -- Comprobación sobre lo que quedó, no sobre lo que se mandó.
  if (select config_extra->'votos' from lineas_negocio where id = linea_ve) <> v_votos then
    raise exception 'los votos no quedaron como se esperaba';
  end if;
  select count(*) into n
    from bloque_configs b, jsonb_array_elements(b.config_extra->'campos_extraccion') e
   where b.id = bc_rut2 and e->>'slug' = 'tipo_documento';
  if n <> 1 then raise exception 'rut_solicitante_2 quedó con % campos tipo_documento', n; end if;
end $$;
