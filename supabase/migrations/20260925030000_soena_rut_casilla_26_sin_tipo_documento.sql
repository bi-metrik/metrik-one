-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-24
-- La casilla 26 del RUT se lee SOLA, sin el código de la casilla 25 pegado delante,
-- y `nit_completo` lleva el DV una sola vez.
--
-- ── Por qué ──────────────────────────────────────────────────────────────────
-- La extracción leía la casilla 25 (tipo de documento, «13» = cédula de ciudadanía)
-- junto con la 26: V0521 guardó 1380180688 por 80180688, V0254 1379907467, V0110
-- 1379485203, V0395 137556326, V0177 132747706 (este último llegó a la declaración
-- juramentada y la relación de facturas para la DIAN). Y `nit_completo` salía con el DV
-- dos veces («799074677-7» para 79907467-7) en 11 negocios.
--
-- El código ya corrige las dos cosas al guardar la extracción (PR #908,
-- `normalizarIdentificacionRut`); esto ataca el origen: la instrucción que recibe el
-- modelo. Las dos capas se necesitan: la instrucción baja la frecuencia, la
-- normalización cubre lo que la instrucción no logre.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- Solo CONFIGURACIÓN: reescribe `descripcion_ai` de tres campos de extracción en dos
-- `bloque_configs` de SOENA. No toca negocio_bloques: ningún dato guardado cambia. Aplica
-- a lo que se cargue o reprocese de aquí en adelante.
--   · rut.numero_identificacion
--   · rut_solicitante_2.numero_identificacion
--   · rut.nit_completo
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- Independiente del código: se puede aplicar antes o después del merge del #908.
-- Re-aplicable: escribe el mismo texto.
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  bc_rut     constant uuid := 'b734032c-19ca-4084-8664-ed2e3036b648';
  bc_rut2    constant uuid := '3c1d18e8-dcf2-49fe-ad40-5997ee185f72';
  n          int;
  v_ni_rut   constant text := 'Número del documento de identidad del titular, SOLO el de la casilla 26 «Número de Identificación» del RUT, COMPLETO. Solo dígitos, sin puntos, comas, guiones ni espacios. NO truncar ni omitir el último dígito. NO incluir el dígito de verificación (DV). ATENCIÓN: justo a la izquierda está la casilla 25 «Tipo de documento», que trae un código de dos dígitos (13 = cédula de ciudadanía, 22 = cédula de extranjería, 41 = pasaporte, 31 = NIT). Ese código NO es parte del número y NO se pega delante. Ejemplo: casilla 25 «Cédula de Ciudadanía 13» y casilla 26 «80180688» → devolver 80180688, nunca 1380180688. Con cédula de ciudadanía la casilla 26 es igual al NIT de la casilla 5. NO tomar el NIT de la casilla 5: para cédula de extranjería el número de la casilla 26 DIFIERE del NIT. Usar siempre la casilla 26.';
  v_ni_rut2  constant text := 'Número del documento de identidad del titular, SOLO el de la casilla 26 «Número de Identificación» del RUT, COMPLETO. Solo dígitos, sin puntos, comas, guiones ni espacios. NO truncar ni omitir el último dígito. NO incluir el dígito de verificación (DV). ATENCIÓN: justo a la izquierda está la casilla 25 «Tipo de documento», que trae un código de dos dígitos (13 = cédula de ciudadanía, 22 = cédula de extranjería, 41 = pasaporte, 31 = NIT). Ese código NO es parte del número y NO se pega delante. Ejemplo: casilla 25 «Cédula de Ciudadanía 13» y casilla 26 «80180688» → devolver 80180688, nunca 1380180688. Con cédula de ciudadanía la casilla 26 es igual al NIT de la casilla 5.';
  v_nc_rut   constant text := 'NIT del RUT con su dígito de verificación, en formato NIT-DV: el número de la casilla 5 tal como está (SIN el DV), un guion, y el dígito de la casilla 6. El DV va UNA sola vez, después del guion. Ejemplo: casilla 5 «80180688» y casilla 6 «9» → 80180688-9; nunca 801806889-9. Solo dígitos y un guion.';
begin
  -- Reescribe la descripcion_ai de un campo dentro de campos_extraccion, conservando el
  -- orden y el resto de sus claves. Aborta si el bloque o el campo no están.
  update bloque_configs b
     set config_extra = jsonb_set(
           b.config_extra, '{campos_extraccion}',
           (select jsonb_agg(
                     case
                       when e->>'slug' = 'numero_identificacion' then e || jsonb_build_object('descripcion_ai', v_ni_rut)
                       when e->>'slug' = 'nit_completo' then e || jsonb_build_object('descripcion_ai', v_nc_rut)
                       else e
                     end order by i)
              from jsonb_array_elements(b.config_extra->'campos_extraccion') with ordinality as t(e, i)))
   where b.id = bc_rut and b.workspace_id = ws_soena and b.slug = 'rut';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 bloque rut y se actualizaron %', n; end if;

  update bloque_configs b
     set config_extra = jsonb_set(
           b.config_extra, '{campos_extraccion}',
           (select jsonb_agg(
                     case
                       when e->>'slug' = 'numero_identificacion' then e || jsonb_build_object('descripcion_ai', v_ni_rut2)
                       else e
                     end order by i)
              from jsonb_array_elements(b.config_extra->'campos_extraccion') with ordinality as t(e, i)))
   where b.id = bc_rut2 and b.workspace_id = ws_soena and b.slug = 'rut_solicitante_2';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 bloque rut_solicitante_2 y se actualizaron %', n; end if;

  -- Comprobación sobre lo que quedó, no sobre lo que se mandó.
  select count(*) into n
    from bloque_configs b, jsonb_array_elements(b.config_extra->'campos_extraccion') e
   where b.id in (bc_rut, bc_rut2)
     and (   (e->>'slug' = 'numero_identificacion' and e->>'descripcion_ai' like '%nunca 1380180688%')
          or (b.id = bc_rut and e->>'slug' = 'nit_completo' and e->>'descripcion_ai' like '%nunca 801806889-9%'));
  if n <> 3 then raise exception 'se esperaban 3 campos reescritos y quedaron %', n; end if;
end $$;
