-- ============================================================================
-- SOENA · línea GIT EV/HEV · 2026-10-05
-- Quién puede avanzar un cruce con motivo, y el costo de hacerlo antes de radicar.
--
-- Brief: proyectos/soena/ve/2026-10-05_brief-max-avanzar-cruces-con-motivo.md
-- Estilo de 20261001100000_soena_freno_titular_2_antes_de_radicar.sql.
-- Va encima de 20261005120000_negocio_cruces_avanzados.sql (el mecanismo genérico).
--
-- Solo CONFIGURACIÓN: `workspaces.config_extra` de SOENA y `config_extra.cruces` de una
-- línea. No toca negocios ni bloques.
--
-- ── Qué hace ─────────────────────────────────────────────────────────────────
-- (1) `workspaces.config_extra.avanzar_cruces.staff_ids` = las dos personas que decidió
--     Mauricio (una administradora y una supervisora; staff.id, no profile.id). Solo
--     ellas ven «Avanzar de todas formas» y el servidor rechaza a cualquier otra.
-- (2) Los 4 cruces de ANTES DE RADICAR (factura contra titularidad, RUT y RUT 2 entre
--     los compradores, titular 2 completo) declaran `advertencia`: el texto de costo que
--     se muestra en la confirmación.
--
-- ── Medido el 2026-10-05, solo lectura ───────────────────────────────────────
-- 26 negocios abiertos de la línea frenados hoy por un cruce (467 abiertos):
--   certificado_personas_vs_titularidad  23 (14 en Cita, 8 en Seguimiento, 1 en Anexos)
--   factura_compradores_vs_titularidad    2 (1 en Documentación, 1 en Cargue)
--   certificado_valor_vs_factura          1 (Anexos)
-- Más 1 frenado por un voto en disputa (documento del titular, Anexos): un voto no se
-- avanza por aquí.
-- Esta migración no cambia cuáles frenan: solo quién puede avanzarlos.
--
-- Re-aplicable: (1) reemplaza la lista; (2) reescribe la advertencia.
-- ============================================================================

do $$
declare
  ws_soena   constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  linea_ve   constant uuid := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  autorizados constant uuid[] := array[
    'c914313f-3042-4757-92f3-e96c35b3b6d6',  -- administradora
    '6f107e73-cfb7-4869-acd3-73195173f249'   -- supervisora
  ]::uuid[];
  antes_de_radicar constant text[] := array[
    'factura_compradores_vs_titularidad',
    'rut_entre_compradores',
    'rut2_entre_compradores',
    'titular_2_completo_antes_de_radicar'
  ];
  v_advertencia constant text :=
    'Si radicas así, la UPME puede emitir el certificado incompleto y habría que pagar la tarifa otra vez';
  n int;
begin
  -- El mecanismo genérico tiene que estar.
  if to_regclass('public.negocio_cruces_avanzados') is null then
    raise exception 'falta la tabla negocio_cruces_avanzados: aplicar 20261005120000 antes';
  end if;

  -- Las dos personas existen, están activas y son de SOENA.
  if (select count(*) from staff
       where id = any(autorizados) and workspace_id = ws_soena and is_active) <> 2 then
    raise exception 'las dos personas autorizadas no están activas en el staff de SOENA';
  end if;

  -- Los 4 cruces de antes de radicar tienen que estar en la línea.
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and l.workspace_id = ws_soena
         and c->>'slug' = any(antes_de_radicar)) <> 4 then
    raise exception 'faltan cruces de antes de radicar en la línea GIT EV/HEV (se esperaban 4)';
  end if;

  -- (1) La lista de quién puede avanzar cruces.
  update workspaces w
     set config_extra = coalesce(w.config_extra, '{}'::jsonb)
                        || jsonb_build_object('avanzar_cruces',
                             jsonb_build_object('staff_ids', to_jsonb(autorizados::text[])))
   where w.id = ws_soena;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 workspace SOENA y se actualizaron %', n; end if;

  -- (2) La advertencia de costo en los 4 cruces, sin tocar nada más de su definición
  -- ni el orden de la lista.
  update lineas_negocio l
     set config_extra = jsonb_set(
           l.config_extra,
           '{cruces}',
           (select jsonb_agg(
                     case when c->>'slug' = any(antes_de_radicar)
                          then c || jsonb_build_object('advertencia', v_advertencia)
                          else c end
                     order by ord)
              from jsonb_array_elements(l.config_extra->'cruces') with ordinality as t(c, ord)))
   where l.id = linea_ve and l.workspace_id = ws_soena
     and jsonb_typeof(l.config_extra->'cruces') = 'array';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'se esperaba 1 línea GIT EV/HEV con cruces y se actualizaron %', n; end if;

  -- Verificaciones.
  if (select jsonb_array_length(config_extra->'avanzar_cruces'->'staff_ids')
        from workspaces where id = ws_soena) <> 2 then
    raise exception 'la lista avanzar_cruces.staff_ids no quedó con 2 personas';
  end if;
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and c->>'slug' = any(antes_de_radicar)
         and c->>'advertencia' = v_advertencia) <> 4 then
    raise exception 'la advertencia no quedó en los 4 cruces de antes de radicar';
  end if;
  if (select count(*) from lineas_negocio l, jsonb_array_elements(l.config_extra->'cruces') c
       where l.id = linea_ve and c ? 'advertencia'
         and not (c->>'slug' = any(antes_de_radicar))) <> 0 then
    raise exception 'la advertencia quedó en un cruce que no es de antes de radicar';
  end if;
end $$;
