-- ============================================================================
-- Trappvel · «Condiciones del viaje»: opciones «no definido» · 2026-10-01
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de un workspace, no esquema: lo aplica la sesión principal
-- (copia en proyectos/trappvel/clarity/migrations/ si se decide aplicarlo).
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-01-correcciones-entendimiento.md,
-- corrección 2. Evidencia: docs/entrada/sesiones/2026-10-01_simulacion-chat-wa-solicitud.md
-- («¿cuánto sale?» se volvía «Aún no tiene presupuesto definido»).
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- Marca con `"no_definido": true` dos opciones del bloque:
--   · presupuesto     → sin_definir      («Aún no tiene presupuesto definido»)
--   · categoria_hotel → sin_preferencia  («Sin preferencia»)
-- Con la marca, el paso de entendimiento de la bandeja de WhatsApp solo las sugiere si el
-- cliente LO DICE («no tenemos presupuesto», «el que sea»): una pregunta («¿cuánto sale?») o
-- una frase sin negación ni indiferencia se descarta y el bot vuelve a preguntar
-- (`declaraNoDefinido` en supabase/functions/_shared/wa-entendimiento-reglas.ts).
-- Para marcar otra opción así no hace falta PR: se le agrega la misma llave.
--
-- La pantalla no lee la llave: solo cambia lo que el bot sugiere.
--
-- ── Orden ───────────────────────────────────────────────────────────────────
-- Cualquier orden respecto al deploy de wa-alerts: el código viejo ignora la llave, y el código
-- nuevo sin la llave se comporta como antes (la opción se acepta con cualquier frase).
--
-- Idempotente. Aborta si el bloque o alguna de las dos opciones no está como se midió.
-- La prueba `supabase/functions/_shared/wa-entendimiento-chat-punta-cana.test.ts` lo ejecuta en
-- PGlite sobre el bloque sintético, después del SQL PROVISIONAL del 2026-09-28.
-- ============================================================================

do $$
declare
  v_id constant uuid := '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
  v_slug text;
  v_fields jsonb;
  v_marcas constant jsonb := '{"presupuesto": "sin_definir", "categoria_hotel": "sin_preferencia"}'::jsonb;
  v_campo text;
  v_n int;
begin
  select config_extra->'fields', slug into v_fields, v_slug
  from public.bloque_configs
  where id = v_id
  for update;

  if not found then
    raise exception 'No existe bloque_configs %', v_id;
  end if;
  if v_slug is distinct from 'condiciones_del_viaje' then
    raise exception 'El bloque % no es condiciones_del_viaje (slug=%)', v_id, v_slug;
  end if;

  for v_campo in select jsonb_object_keys(v_marcas) loop
    select count(*) into v_n
    from jsonb_array_elements(v_fields) f, jsonb_array_elements(f->'opciones') o
    where f->>'slug' = v_campo and o->>'value' = v_marcas->>v_campo;
    if v_n <> 1 then
      raise exception 'Se esperaba exactamente una opción % en el campo % (hay %)', v_marcas->>v_campo, v_campo, v_n;
    end if;
  end loop;

  -- Se conserva el orden de campos y opciones; solo se agrega la llave donde va.
  select jsonb_agg(
    case when v_marcas ? (f->>'slug') then
      jsonb_set(f, '{opciones}', (
        select jsonb_agg(
          case when o->>'value' = v_marcas->>(f->>'slug') then o || '{"no_definido": true}'::jsonb else o end
          order by k)
        from jsonb_array_elements(f->'opciones') with ordinality as t2(o, k)))
    else f end
    order by n)
  into v_fields
  from jsonb_array_elements(v_fields) with ordinality as t(f, n);

  update public.bloque_configs
  set config_extra = jsonb_set(config_extra, '{fields}', v_fields)
  where id = v_id;
end $$;

-- Verificación:
-- select f->>'slug' as campo, o->>'value' as opcion, o->'no_definido' as no_definido
-- from public.bloque_configs, jsonb_array_elements(config_extra->'fields') f, jsonb_array_elements(f->'opciones') o
-- where id = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417' and o ? 'no_definido';

-- Vuelta atrás (quita la llave de todas las opciones del bloque):
-- update public.bloque_configs
-- set config_extra = jsonb_set(config_extra, '{fields}', (
--   select jsonb_agg(
--     case when f ? 'opciones' then jsonb_set(f, '{opciones}', (
--       select jsonb_agg(o - 'no_definido' order by k) from jsonb_array_elements(f->'opciones') with ordinality as t2(o, k)))
--     else f end
--     order by n)
--   from jsonb_array_elements(config_extra->'fields') with ordinality as t(f, n)))
-- where id = '98281a40-2f67-4d8e-9bc5-6ca1f7a69417';
