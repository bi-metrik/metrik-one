-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-09-18
--
-- (1) El bloque `rut` declara que espera un RUT de la DIAN.
-- (2) La línea declara que un solicitante persona JURÍDICA no le aplica.
--
-- ⚠️ ESTO NO ESTÁ APLICADO. Es configuración sobre datos de producción y la aplica la
-- sesión principal. El código que lo consume ya está mergeado y es INERTE sin estas
-- dos claves: sin `documento_esperado` el bloque acepta lo de siempre, y sin
-- `no_aplica` la ficha no pinta ningún aviso.
--
-- ── Orden ────────────────────────────────────────────────────────────────────
-- El deploy del código va ANTES que este SQL. Al revés no rompe nada —las claves
-- quedarían escritas y nadie las leería—, pero deja una ventana en la que el bloque
-- promete «aquí va el RUT» sin que nada lo verifique.
--
-- ── Qué cambia el día que se aplique ─────────────────────────────────────────
-- · Cargar o reprocesar un archivo en el bloque `rut` pasa por un lector que
--   identifica el documento. Si es OTRO documento conocido con confianza ≥ 0,70, el
--   bloque NO se guarda y nada se toca: ni Drive, ni los campos, ni la seccional.
--   `otro`, `ilegible` y la confianza baja DEJAN PASAR — ver el encabezado de
--   `src/lib/documentos/tipo-documento.ts`: la asimetría es deliberada.
-- · Cuesta una llamada más a Gemini por carga, SOLO en este bloque.
-- · Los negocios con solicitante jurídico ven un aviso ámbar en la ficha que dice que
--   el caso no aplica y qué hacer. No cierra nada ni frena nada.
--
-- ── Medido contra producción antes de escribir esto (2026-09-18) ─────────────
-- · 25 RUT reales de la línea (V0012 … V0454, tomados de punta a punta del
--   histórico): los 25 identificados como `rut` con confianza 0,98-0,99.
--   **0 rechazos y 0 veredictos no concluyentes** — o sea, 0 falsos rechazos.
-- · Los 3 certificados de Cámara que hoy viven en el bloque `rut` (V0497, V0498 y
--   V0253): los 3 identificados como `camara_comercio` con 0,98-0,99, o sea que los
--   3 se habrían rechazado.
-- · 3,4 a 4,5 segundos por archivo (92-172 kB).
-- · Negocios con solicitante jurídico parados y mudos hoy: V0261, V0320 y V0426.
--
-- ⚠️ Lo que este control NO atrapa: el RUT de una persona jurídica **es** un RUT, así
-- que pasa. El control es sobre el DOCUMENTO, no sobre la persona; de la persona se
-- encarga el aviso de (2).
--
-- Idempotente: se puede correr dos veces. Aborta si algo no queda como se espera.
-- ============================================================================

begin;

do $$
declare
  v_linea uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';  -- GIT EV/HEV
  v_config_id uuid;
  v_tocadas int;
begin
  -- ── (1) El bloque `rut` espera un RUT ────────────────────────────────────
  -- `into strict`: si el slug no resuelve a exactamente un bloque de esta línea,
  -- aborta. Escribir con `||` y no con `jsonb_set` porque la concatenación crea la
  -- llave conservando todo lo demás (label, condition, campos_extraccion,
  -- cross_check…) y no depende de que exista un nivel padre.
  select bc.id into strict v_config_id
    from bloque_configs bc
    join etapas_negocio en on en.id = bc.etapa_id
   where en.linea_id = v_linea
     and bc.slug = 'rut';

  update bloque_configs
     set config_extra = coalesce(config_extra, '{}'::jsonb)
                        || jsonb_build_object('documento_esperado', 'rut')
   where id = v_config_id;

  -- La guarda comprueba el ESTADO, no que el update haya reportado una fila: un
  -- update que corre y no deja el valor se ve igual que el éxito.
  if not exists (
    select 1 from bloque_configs
     where id = v_config_id
       and config_extra->>'documento_esperado' = 'rut'
       and jsonb_array_length(coalesce(config_extra->'campos_extraccion', '[]'::jsonb)) = 22
       and config_extra->'condition'->>'field' = 'tipo_persona'
  ) then
    raise exception 'el bloque rut no quedó como se esperaba (o perdió campos_extraccion / condition)';
  end if;

  -- ── (2) A una persona jurídica no le aplica esta línea ───────────────────
  -- La condición es la MISMA que ya llevan los bloques de Documentación, al revés:
  -- ellos exigen `natural`, esto avisa cuando es `juridica`. La resuelve
  -- `condicion_cumplida`, así que no hay una segunda lectura del mismo dato.
  update lineas_negocio
     set config_extra = coalesce(config_extra, '{}'::jsonb)
       || jsonb_build_object('no_aplica', jsonb_build_array(
            jsonb_build_object(
              'condition', jsonb_build_object(
                'field', 'tipo_persona',
                'value', 'juridica',
                'source_bloque_slug', 'tipo_de_solicitante',
                'source_etapa_orden', 1
              ),
              'titulo', 'Este caso no aplica para devolución de IVA',
              'mensaje',
                'La devolución del IVA del vehículo solo la puede pedir una persona natural. '
                || 'Este caso quedó marcado como persona jurídica, así que no hay documentos '
                || 'que recoger ni trámite que radicar: por eso las etapas se ven vacías.',
              'que_hacer',
                'Si el solicitante sí es una empresa, ciérralo como perdido con la razón que '
                || 'corresponda. Si la respuesta quedó mal, corrígela en «¿El solicitante es '
                || 'persona natural o jurídica?», en E1 Validación. No cargues aquí los '
                || 'documentos de la empresa.'
            )
          ))
   where id = v_linea;
  get diagnostics v_tocadas = row_count;
  if v_tocadas <> 1 then
    raise exception 'se esperaba tocar 1 línea y se tocaron %', v_tocadas;
  end if;

  if not exists (
    select 1 from lineas_negocio
     where id = v_linea
       and jsonb_array_length(coalesce(config_extra->'no_aplica', '[]'::jsonb)) = 1
       -- y lo que la línea ya tenía sigue ahí
       and (config_extra ? 'rutas' or true)
  ) then
    raise exception 'la línea quedó sin no_aplica';
  end if;
end $$;

commit;

-- ── Comprobación posterior (solo lectura) ───────────────────────────────────
--
-- (a) Espera una fila: slug=rut, espera=rut, campos=22.
--   select bc.slug,
--          bc.config_extra->>'documento_esperado' as espera,
--          jsonb_array_length(bc.config_extra->'campos_extraccion') as campos
--     from bloque_configs bc
--     join etapas_negocio en on en.id = bc.etapa_id
--    where en.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
--      and bc.slug = 'rut';
--
-- (b) Espera `true` SOLO en V0261, V0320 y V0426 (medido el 2026-09-18).
--     Si sale `true` en alguno más, algo cambió: re-medir antes de dar por bueno.
--   with regla as (
--     select r->'condition' as cond
--       from lineas_negocio l,
--            jsonb_array_elements(l.config_extra->'no_aplica') r
--      where l.id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
--   )
--   select n.codigo,
--          condicion_cumplida(
--            p_negocio_id => n.id,
--            p_linea_id => n.linea_id,
--            p_etapa_actual_id => n.etapa_actual_id,
--            p_cond => regla.cond
--          ) as no_aplica
--     from negocios n, regla
--    where n.linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8'
--      and n.estado = 'abierto'
--    order by 2 desc nulls last, 1;
