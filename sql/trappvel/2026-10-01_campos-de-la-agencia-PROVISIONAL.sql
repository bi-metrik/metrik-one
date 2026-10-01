-- ============================================================================
-- Trappvel · Etapa 1 «Solicitud»: campos que escribe la agencia · 2026-10-01
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de un workspace, no esquema: lo aplica la sesión principal
-- (copia en proyectos/trappvel/clarity/migrations/ si se decide aplicarlo).
--
-- Evidencia: proyectos/trappvel/clarity/qa/bandeja-wa/resultado-2026-10-01-pr969.md, A4 corrida 3:
-- el paso de entendimiento de la bandeja de WhatsApp redactó un párrafo turístico en
-- `presentacion_destino` («Madrid, París y Roma son tres de las ciudades más emblemáticas…»),
-- que es lo primero que lee el cliente en la cotización.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- Marca con `"lo_llena": "agencia"` los campos de la etapa que produce la agencia para la
-- cotización, no el cliente:
--   · presentacion_destino      (bloque condiciones_del_viaje)  — obligatorio que exista
--   · clasificacion_complejidad (bloque de complejidad)          — si existe en la etapa
--   · formato_cotizacion, nivel_detalle (bloque de formato)      — si existen en la etapa
-- Con la marca, `camposEntendibles` los saca del esquema y del prompt del modelo: el
-- entendimiento no los llena nunca (supabase/functions/_shared/wa-entendimiento-reglas.ts).
-- Para marcar otro campo así no hace falta PR: se le agrega la misma llave.
--
-- La pantalla no lee la llave: la persona los sigue llenando igual.
--
-- ── Orden ───────────────────────────────────────────────────────────────────
-- Cualquier orden respecto al deploy de wa-alerts: el código viejo ignora la llave. Pero SIN
-- la llave el código nuevo sigue ofreciéndole `presentacion_destino` al modelo; el guardián de
-- texto (`textoSaleDelMensaje`) frena un párrafo redactado, no una frase corta inventada.
--
-- Idempotente. Aborta si `presentacion_destino` no está exactamente una vez en la etapa.
-- La prueba `supabase/functions/_shared/wa-entendimiento-campos-agencia.test.ts` lo ejecuta en
-- PGlite sobre bloques sintéticos.
-- ============================================================================

do $$
declare
  v_etapa constant uuid := '3b6b4133-f656-4145-8e32-bf598cde68d0';
  v_slugs constant text[] := array['presentacion_destino', 'clasificacion_complejidad', 'formato_cotizacion', 'nivel_detalle'];
  v_n int;
  v_bc record;
  v_fields jsonb;
begin
  select count(*) into v_n
  from public.bloque_configs bc, jsonb_array_elements(bc.config_extra->'fields') f
  where bc.etapa_id = v_etapa and f->>'slug' = 'presentacion_destino';
  if v_n <> 1 then
    raise exception 'Se esperaba presentacion_destino exactamente una vez en la etapa % (hay %)', v_etapa, v_n;
  end if;

  for v_bc in
    select bc.id, bc.config_extra->'fields' as fields
    from public.bloque_configs bc
    where bc.etapa_id = v_etapa
      and exists (select 1 from jsonb_array_elements(bc.config_extra->'fields') f where f->>'slug' = any (v_slugs))
    for update
  loop
    -- Se conserva el orden de los campos; solo se agrega la llave donde va.
    select jsonb_agg(
      case when f->>'slug' = any (v_slugs) then f || '{"lo_llena": "agencia"}'::jsonb else f end
      order by n)
    into v_fields
    from jsonb_array_elements(v_bc.fields) with ordinality as t(f, n);

    update public.bloque_configs
    set config_extra = jsonb_set(config_extra, '{fields}', v_fields)
    where id = v_bc.id;
  end loop;
end $$;

-- Verificación:
-- select bc.slug, f->>'slug' as campo, f->>'lo_llena' as lo_llena
-- from public.bloque_configs bc, jsonb_array_elements(bc.config_extra->'fields') f
-- where bc.etapa_id = '3b6b4133-f656-4145-8e32-bf598cde68d0' and f ? 'lo_llena';

-- Vuelta atrás (quita la llave de todos los campos de la etapa):
-- update public.bloque_configs
-- set config_extra = jsonb_set(config_extra, '{fields}', (
--   select jsonb_agg(f - 'lo_llena' order by n)
--   from jsonb_array_elements(config_extra->'fields') with ordinality as t(f, n)))
-- where etapa_id = '3b6b4133-f656-4145-8e32-bf598cde68d0'
--   and exists (select 1 from jsonb_array_elements(config_extra->'fields') f where f ? 'lo_llena');
