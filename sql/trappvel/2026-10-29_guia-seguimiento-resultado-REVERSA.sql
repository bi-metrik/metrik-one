-- ============================================================================
-- Trappvel · REVERSA de 2026-10-29_guia-seguimiento-resultado-PENDIENTE.sql
-- ============================================================================
-- Devuelve `guia.hacer[2]` y `guia.avanzar` de Seguimiento (E3) a los textos medidos el
-- 2026-10-29, solo si siguen siendo los que puso el PENDIENTE. Idempotente.
-- ============================================================================

do $$
declare
  v_linea constant uuid := '42bba7b7-8ca2-41d8-93cf-ef6ab6f8f887';
  v_e3    constant uuid := 'b49223fe-7e13-456b-8ff6-ab818b98f4ee';

  c_hacer_viejo constant text := 'Registra el resultado con un botón: «El cliente confirmó», «Aplazar» (con la fecha en que le vuelves a escribir) o «Se perdió» (con el motivo).';
  c_hacer_nuevo constant text := 'Registra el resultado: «El cliente confirmó» (el negocio pasa solo a Confirmación) o «Se perdió» (con el motivo). Si el cliente pide otra versión, toca «Nueva cotización»: al enviarla, reemplaza a la que estaba enviada.';
  c_avanzar_viejo constant text := 'La cotización enviada desde ONE y el resultado: confirmó, se aplaza con fecha o se perdió con motivo.';
  c_avanzar_nuevo constant text := 'La cotización enviada desde ONE. Con «El cliente confirmó» pasa sola a Confirmación; si avanzas a mano, la confirmación se registra allá y Confirmación no deja seguir sin ella.';

  v_cfg jsonb;
begin
  select config_extra into v_cfg from public.etapas_negocio where id = v_e3 and linea_id = v_linea and orden = 3 for update;
  if not found then raise exception 'No está la etapa 3 (Seguimiento) % de la línea %', v_e3, v_linea; end if;

  if v_cfg #>> '{guia,hacer,2}' = c_hacer_nuevo then
    v_cfg := jsonb_set(v_cfg, '{guia,hacer,2}', to_jsonb(c_hacer_viejo));
  elsif v_cfg #>> '{guia,hacer,2}' is distinct from c_hacer_viejo then
    raise notice 'guia.hacer[2] no es el que puso el PENDIENTE: no se toca (%).', v_cfg #>> '{guia,hacer,2}';
  end if;

  if v_cfg #>> '{guia,avanzar}' = c_avanzar_nuevo then
    v_cfg := jsonb_set(v_cfg, '{guia,avanzar}', to_jsonb(c_avanzar_viejo));
  elsif v_cfg #>> '{guia,avanzar}' is distinct from c_avanzar_viejo then
    raise notice 'guia.avanzar no es el que puso el PENDIENTE: no se toca (%).', v_cfg #>> '{guia,avanzar}';
  end if;

  update public.etapas_negocio set config_extra = v_cfg where id = v_e3;
end $$;
