-- ============================================================================
-- Trappvel · la autorización de datos frena ENVIAR la cotización, no armarla · 2026-10-22
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de configuración de un workspace (no esquema): lo aplica la
-- sesión principal con el «sí» de Mauricio, DESPUÉS del deploy del PR que lo acompaña.
--
-- Encargo: proyectos/trappvel/clarity/briefs/2026-10-22_brief-max-tarifa-publica-neta-y-fallas-reunion.md,
-- punto 4 (reunión del 2026-10-22, L789-793: «el cliente se puede demorar… deberíamos ir
-- pudiendo avanzar con la cotización»).
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- En la línea «Viaje a medida» de Trappvel:
--   1. Quita `autorizacion_datos` de los gates de Solicitud (E1): sin la firma se llega a Cotización.
--   2. Lo agrega a los gates de Cotización (E2): sin la firma no se pasa a Seguimiento, o sea no
--      sale nada al cliente ni se llega a reservas y cobros.
--   3. Si E1 tenía mensajes propios del gate (`gate_messages.autorizacion_datos*`), los mueve a E2.
--   4. Ajusta los textos que decían lo contrario, SOLO si siguen siendo los medidos el 2026-10-21:
--        · guía de E1 «avanzar» · guía de E2 «avanzar» · descripción del bloque «Autorización de datos».
--      Si alguien los cambió después, no se tocan y se avisa (NOTICE).
--
-- El código del PR ya exige la autorización al ENVIAR, ENVIAR POR PASOS y APROBAR en toda línea
-- que declare el gate en cualquier etapa (`src/lib/autorizacion-datos/envio.ts`), así que el orden
-- respecto al deploy no abre un hueco: antes de este SQL el gate sigue en E1 como hoy.
--
-- Idempotente. Aborta si la línea, las etapas o el bloque no son los medidos.
-- Reversa: 2026-10-22_autorizacion-datos-a-cotizacion-REVERSA.sql
-- Probado en PGlite: src/lib/autorizacion-datos/autorizacion-a-cotizacion-sql.test.ts
-- ============================================================================

do $$
declare
  v_ws     constant uuid := 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc';
  v_linea  constant uuid := '42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887';
  v_e1     constant uuid := '3b6b4133-f656-4145-8e32-bf598cde68d0';
  v_e2     constant uuid := '0138f4b0-6382-4377-b1ff-15d3e31bb051';
  v_bloque constant uuid := '01cacb65-6421-431e-859c-9d01f23f85d5';
  v_gate   constant text := 'autorizacion_datos';

  c_e1_viejo constant text := 'Que el contacto haya firmado la autorización de datos: sin ella ONE no deja avanzar. Lo ideal es llegar con «Mínimo para cotizar» completo.';
  c_e1_nuevo constant text := 'Lo ideal es llegar con «Mínimo para cotizar» completo. La autorización de datos ya no frena: sin ella se cotiza, pero la cotización no se envía.';
  c_e2_viejo constant text := 'Todo dice «Completo» y ONE no avisa que el viaje deja muy poca plata.';
  c_e2_nuevo constant text := 'Todo dice «Completo», ONE no avisa que el viaje deja muy poca plata y el cliente ya autorizó sus datos (sin la autorización la cotización no se envía).';
  c_bloque_viejo constant text := 'Sin autorización el viaje no pasa a Cotización.';
  c_bloque_nuevo constant text := 'Sin autorización se puede cotizar, pero la cotización no se envía al cliente.';

  v_e1_cfg jsonb;
  v_e2_cfg jsonb;
  v_msgs   jsonb;
  v_desc   text;
begin
  perform 1 from public.lineas_negocio where id = v_linea and workspace_id = v_ws;
  if not found then
    raise exception 'La línea % no es del workspace % (o no existe)', v_linea, v_ws;
  end if;

  select config_extra into v_e1_cfg from public.etapas_negocio where id = v_e1 and linea_id = v_linea and numero = 1 for update;
  if not found then raise exception 'No está la etapa 1 (Solicitud) % de la línea %', v_e1, v_linea; end if;
  select config_extra into v_e2_cfg from public.etapas_negocio where id = v_e2 and linea_id = v_linea and numero = 2 for update;
  if not found then raise exception 'No está la etapa 2 (Cotización) % de la línea %', v_e2, v_linea; end if;
  v_e1_cfg := coalesce(v_e1_cfg, '{}'::jsonb);
  v_e2_cfg := coalesce(v_e2_cfg, '{}'::jsonb);

  -- 1 · fuera de E1.
  if jsonb_typeof(v_e1_cfg->'gates') = 'array' and (v_e1_cfg->'gates') ? v_gate then
    v_e1_cfg := jsonb_set(v_e1_cfg, '{gates}', (
      select coalesce(jsonb_agg(g), '[]'::jsonb) from jsonb_array_elements(v_e1_cfg->'gates') g where g <> to_jsonb(v_gate)
    ));
  end if;

  -- 2 · dentro de E2 (sin repetirlo).
  if jsonb_typeof(v_e2_cfg->'gates') = 'array' then
    if not ((v_e2_cfg->'gates') ? v_gate) then
      v_e2_cfg := jsonb_set(v_e2_cfg, '{gates}', (v_e2_cfg->'gates') || to_jsonb(v_gate));
    end if;
  else
    v_e2_cfg := jsonb_set(v_e2_cfg, '{gates}', jsonb_build_array(v_gate));
  end if;

  -- 3 · los mensajes propios del gate viajan con él.
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_msgs
  from jsonb_each(coalesce(v_e1_cfg->'gate_messages', '{}'::jsonb)) as m(k, v)
  where k = v_gate or k like v_gate || ':%';
  if v_msgs <> '{}'::jsonb then
    v_e2_cfg := jsonb_set(v_e2_cfg, '{gate_messages}', coalesce(v_e2_cfg->'gate_messages', '{}'::jsonb) || v_msgs);
    v_e1_cfg := jsonb_set(v_e1_cfg, '{gate_messages}', (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from jsonb_each(v_e1_cfg->'gate_messages') as m(k, v)
      where not (k = v_gate or k like v_gate || ':%')
    ));
  end if;

  -- 4 · los textos, solo si siguen siendo los medidos.
  if v_e1_cfg #>> '{guia,avanzar}' = c_e1_viejo then
    v_e1_cfg := jsonb_set(v_e1_cfg, '{guia,avanzar}', to_jsonb(c_e1_nuevo));
  elsif coalesce(v_e1_cfg #>> '{guia,avanzar}', '') <> c_e1_nuevo then
    raise notice 'La guía «avanzar» de E1 cambió desde el 2026-10-21: no se toca. Revísala a mano.';
  end if;
  if v_e2_cfg #>> '{guia,avanzar}' = c_e2_viejo then
    v_e2_cfg := jsonb_set(v_e2_cfg, '{guia,avanzar}', to_jsonb(c_e2_nuevo));
  elsif coalesce(v_e2_cfg #>> '{guia,avanzar}', '') <> c_e2_nuevo then
    raise notice 'La guía «avanzar» de E2 cambió desde el 2026-10-21: no se toca. Revísala a mano.';
  end if;

  update public.etapas_negocio set config_extra = v_e1_cfg where id = v_e1;
  update public.etapas_negocio set config_extra = v_e2_cfg where id = v_e2;

  select descripcion into v_desc from public.bloque_configs where id = v_bloque and etapa_id = v_e1 for update;
  if not found then raise exception 'No está el bloque «Autorización de datos» % en la etapa 1', v_bloque; end if;
  if position(c_bloque_viejo in coalesce(v_desc, '')) > 0 then
    update public.bloque_configs set descripcion = replace(v_desc, c_bloque_viejo, c_bloque_nuevo) where id = v_bloque;
  elsif position(c_bloque_nuevo in coalesce(v_desc, '')) = 0 then
    raise notice 'La descripción del bloque «Autorización de datos» cambió desde el 2026-10-21: no se toca.';
  end if;
end
$$;
