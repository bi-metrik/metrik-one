-- ============================================================================
-- Trappvel · la guía de Seguimiento (E3) nombra los botones que existen · 2026-10-29
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de configuración de un workspace (no esquema): lo aplica la
-- sesión principal con el «sí» de Mauricio, DESPUÉS del deploy del PR que lo acompaña.
--
-- Encargo: QA de punta a punta del 2026-10-29 (proyectos/trappvel/clarity/qa/
-- 2026-10-29_punta-a-punta-10-viajes/), hallazgos N10-2 y H6.
--
-- ── Qué hace ────────────────────────────────────────────────────────────────
-- En la etapa 3 (Seguimiento) de la línea «Viaje a medida»:
--   1. `guia.hacer[2]` decía «Registra el resultado con un botón: «El cliente confirmó»,
--      «Aplazar» (…) o «Se perdió» (…)». «Aplazar» no existe en Trappvel (el módulo
--      `pausa_enabled` está apagado) y «Se perdió» se llamaba «Desistir» (desde el PR que acompaña
--      a este SQL, con el seguimiento encendido, el botón ya se llama «Se perdió»).
--   2. `guia.avanzar` decía que para avanzar hace falta «el resultado». El código NO lo exige (H6)
--      y no hace falta: «El cliente confirmó» mueve el negocio solo a Confirmación, «Se perdió» lo
--      cierra, y si se avanza a mano la confirmación se registra en Confirmación, cuyo gate
--      `confirmacion_registrada` no deja seguir sin ella. La guía pasa a decir eso.
-- Solo cambia cada texto si sigue siendo el medido el 2026-10-29 (SELECT); si alguien lo cambió,
-- no se toca y se avisa (NOTICE).
--
-- Si Mauricio enciende `pausa_enabled` en Trappvel, el botón se llama «Aplazar» (mismo PR) y se
-- puede volver a nombrar aquí.
--
-- Idempotente. Reversa: 2026-10-29_guia-seguimiento-resultado-REVERSA.sql
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

  if v_cfg #>> '{guia,hacer,2}' = c_hacer_viejo then
    v_cfg := jsonb_set(v_cfg, '{guia,hacer,2}', to_jsonb(c_hacer_nuevo));
  elsif v_cfg #>> '{guia,hacer,2}' is distinct from c_hacer_nuevo then
    raise notice 'guia.hacer[2] no es el medido: no se toca (%).', v_cfg #>> '{guia,hacer,2}';
  end if;

  if v_cfg #>> '{guia,avanzar}' = c_avanzar_viejo then
    v_cfg := jsonb_set(v_cfg, '{guia,avanzar}', to_jsonb(c_avanzar_nuevo));
  elsif v_cfg #>> '{guia,avanzar}' is distinct from c_avanzar_nuevo then
    raise notice 'guia.avanzar no es el medido: no se toca (%).', v_cfg #>> '{guia,avanzar}';
  end if;

  update public.etapas_negocio set config_extra = v_cfg where id = v_e3;
end $$;
