-- ============================================================================
-- REVERSA de 2026-10-22_autorizacion-datos-a-cotizacion-PENDIENTE.sql
-- ============================================================================
-- Devuelve el gate `autorizacion_datos` a Solicitud (E1), lo saca de Cotización (E2), regresa sus
-- mensajes propios y los tres textos, solo si siguen siendo los que dejó el SQL de ida.
-- Idempotente. El código del PR sigue exigiendo la autorización al enviar y aprobar (la línea
-- declara el gate en E1): no hace falta revertir el código para usar esta reversa.
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
  if not found then raise exception 'La línea % no es del workspace %', v_linea, v_ws; end if;
  select coalesce(config_extra, '{}'::jsonb) into v_e1_cfg from public.etapas_negocio where id = v_e1 and linea_id = v_linea for update;
  if not found then raise exception 'No está la etapa 1 %', v_e1; end if;
  select coalesce(config_extra, '{}'::jsonb) into v_e2_cfg from public.etapas_negocio where id = v_e2 and linea_id = v_linea for update;
  if not found then raise exception 'No está la etapa 2 %', v_e2; end if;

  if jsonb_typeof(v_e2_cfg->'gates') = 'array' and (v_e2_cfg->'gates') ? v_gate then
    v_e2_cfg := jsonb_set(v_e2_cfg, '{gates}', (
      select coalesce(jsonb_agg(g), '[]'::jsonb) from jsonb_array_elements(v_e2_cfg->'gates') g where g <> to_jsonb(v_gate)
    ));
  end if;
  if jsonb_typeof(v_e1_cfg->'gates') = 'array' then
    if not ((v_e1_cfg->'gates') ? v_gate) then
      v_e1_cfg := jsonb_set(v_e1_cfg, '{gates}', (v_e1_cfg->'gates') || to_jsonb(v_gate));
    end if;
  else
    v_e1_cfg := jsonb_set(v_e1_cfg, '{gates}', jsonb_build_array(v_gate));
  end if;

  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into v_msgs
  from jsonb_each(coalesce(v_e2_cfg->'gate_messages', '{}'::jsonb)) as m(k, v)
  where k = v_gate or k like v_gate || ':%';
  if v_msgs <> '{}'::jsonb then
    v_e1_cfg := jsonb_set(v_e1_cfg, '{gate_messages}', coalesce(v_e1_cfg->'gate_messages', '{}'::jsonb) || v_msgs);
    v_e2_cfg := jsonb_set(v_e2_cfg, '{gate_messages}', (
      select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
      from jsonb_each(v_e2_cfg->'gate_messages') as m(k, v)
      where not (k = v_gate or k like v_gate || ':%')
    ));
  end if;

  if v_e1_cfg #>> '{guia,avanzar}' = c_e1_nuevo then
    v_e1_cfg := jsonb_set(v_e1_cfg, '{guia,avanzar}', to_jsonb(c_e1_viejo));
  end if;
  if v_e2_cfg #>> '{guia,avanzar}' = c_e2_nuevo then
    v_e2_cfg := jsonb_set(v_e2_cfg, '{guia,avanzar}', to_jsonb(c_e2_viejo));
  end if;

  update public.etapas_negocio set config_extra = v_e1_cfg where id = v_e1;
  update public.etapas_negocio set config_extra = v_e2_cfg where id = v_e2;

  select descripcion into v_desc from public.bloque_configs where id = v_bloque for update;
  if found and position(c_bloque_nuevo in coalesce(v_desc, '')) > 0 then
    update public.bloque_configs set descripcion = replace(v_desc, c_bloque_nuevo, c_bloque_viejo) where id = v_bloque;
  end if;
end
$$;
