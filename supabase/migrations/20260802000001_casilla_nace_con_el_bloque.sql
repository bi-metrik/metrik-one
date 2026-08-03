-- O5 — la casilla nace CON el bloque, no cuando alguien pasa por ahí.
--
-- EL DEFECTO
-- Las filas de `negocio_bloques` se materializan al ENTRAR a una etapa (auto-init de
-- `getNegocioDetalle`). Un bloque creado después de que un negocio ya recorrió esa etapa
-- nunca se materializa: el negocio no vuelve a entrar. No es que el dato esté sin
-- responder, es que **no hay dónde responderlo**.
--
-- Es el primer defecto de la auditoría del 2026-07-31 (297 casillas gate que nunca
-- existieron) y el que más caro sale, porque no se ve: en pantalla el bloque sencillamente
-- no está. Un gate que se exige desde una etapa POSTERIOR (patrón `source_etapa_orden`,
-- donde un campo ausente cuenta como no cumplido) frena el avance sin ofrecer dónde
-- responder — le pasó a V0072.
--
-- QUÉ CUBRE ESTE MECANISMO, Y QUÉ NO
-- El auto-init ya resuelve a quien LLEGA a la etapa después de crear el bloque: al entrar,
-- se le crean las filas que le falten. El hueco es el complementario: los negocios que **ya
-- visitaron** la etapa y por eso nunca la vuelven a instanciar. Ahí siembra esto.
--
-- ⚠️ NO se hace un barrido histórico de las casillas ya ausentes (medido el 2026-08-02:
-- 5.581 en SOENA, 50 en AFI, 17 en dimpro). Crearlas todas llenaría cada caso de bloques
-- "pendientes" de etapas pasadas que no deciden nada, y el propio código ya documenta a
-- dónde lleva eso: *"el equipo vería decenas de bloques marcados como pendientes... Ruido
-- que enseña a ignorar los avisos"* (`bloque-visible-completo.ts`). El guardián reporta 0
-- `casilla_gate_ausente` en SOENA, así que no hay nada vivo que reparar hacia atrás.
-- Lo que se cierra aquí es que el hueco **no se vuelva a abrir**.

-- ── Regla de estado, replicada de `visiblePuedeNacerCompleto` ────────────────
-- La fuente conceptual es TS (`src/lib/negocios/bloque-visible-completo.ts`), que decide
-- con el `data` real. Aquí el `data` es SIEMPRE vacío (la casilla nace sin responder), y
-- con data vacía la regla se reduce a lo que sigue:
--   · no es 'visible'        → pendiente (lo responde una persona)
--   · 'visible' y no es gate → completo  (lo llena el sistema, no retiene nada)
--   · 'visible' y es gate    → completo SOLO si no tiene campos obligatorios; si los tiene,
--                              pendiente, para que el gate retenga en vez de dar por
--                              resuelta una pregunta que nadie respondió.
-- Está escrita aparte para poder probarla contra la de TS (ver `casilla-nace.test.ts`).
create or replace function bloque_nace_completo(
  p_estado text, p_es_gate boolean, p_config_extra jsonb
) returns boolean
language sql immutable
set search_path = public
as $$
  select case
    when p_estado is distinct from 'visible' then false
    when not coalesce(p_es_gate, false) then true
    else not exists (
      select 1 from jsonb_array_elements(coalesce(p_config_extra->'fields', '[]'::jsonb)) f
      where (f->>'required')::boolean is true
    )
  end;
$$;

comment on function bloque_nace_completo(text, boolean, jsonb) is
  'Estado con el que nace una casilla VACÍA. Espejo en SQL de visiblePuedeNacerCompleto '
  '(src/lib/negocios/bloque-visible-completo.ts) para el caso data={}. Si cambia allá, cambia aquí.';

-- ── La siembra ──────────────────────────────────────────────────────────────
create or replace function sembrar_casillas_bloque(p_bloque_config_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_etapa_id uuid;
  v_estado text;
  v_es_gate boolean;
  v_config jsonb;
  v_completo boolean;
  v_creadas int;
begin
  select bc.etapa_id, bc.estado, bc.es_gate, bc.config_extra
    into v_etapa_id, v_estado, v_es_gate, v_config
  from bloque_configs bc where bc.id = p_bloque_config_id;

  if v_etapa_id is null then return 0; end if;

  v_completo := bloque_nace_completo(v_estado, v_es_gate, v_config);

  -- Solo negocios ABIERTOS que YA visitaron la etapa (tienen alguna otra casilla suya).
  -- A los demás los cubre el auto-init cuando entren: sembrarles por adelantado crearía
  -- filas para etapas que quizá nunca recorran (el flujo tiene ramas).
  insert into negocio_bloques (negocio_id, bloque_config_id, estado, data, completado_at)
  select n.id, p_bloque_config_id,
         case when v_completo then 'completo' else 'pendiente' end,
         '{}'::jsonb,                      -- vacía: sembrar NO es responder
         case when v_completo then now() else null end
  from negocios n
  where n.estado = 'abierto'
    and exists (
      select 1 from negocio_bloques nb
      join bloque_configs bc2 on bc2.id = nb.bloque_config_id
      where nb.negocio_id = n.id and bc2.etapa_id = v_etapa_id)
    and not exists (
      select 1 from negocio_bloques nb2
      where nb2.negocio_id = n.id and nb2.bloque_config_id = p_bloque_config_id);

  get diagnostics v_creadas = row_count;
  return v_creadas;
end;
$$;

comment on function sembrar_casillas_bloque(uuid) is
  'Crea la casilla VACÍA de un bloque en los negocios abiertos que ya recorrieron su etapa '
  '(a los que aún no llegan los cubre el auto-init). Idempotente: no duplica.';

-- ── El disparo: al nacer el bloque, nacen sus casillas ──────────────────────
create or replace function trg_sembrar_casillas_bloque()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Un bloque desactivado no se muestra: no tiene sentido darle casillas.
  if coalesce((new.config_extra->>'desactivado')::boolean, false) then
    return new;
  end if;
  perform sembrar_casillas_bloque(new.id);
  return new;
end;
$$;

drop trigger if exists sembrar_casillas_al_crear_bloque on bloque_configs;
create trigger sembrar_casillas_al_crear_bloque
  after insert on bloque_configs
  for each row execute function trg_sembrar_casillas_bloque();

-- Diagnóstico y siembra son operaciones de configuración: nunca las llama el cliente.
revoke all on function bloque_nace_completo(text, boolean, jsonb) from anon;
revoke all on function sembrar_casillas_bloque(uuid) from anon, authenticated;
revoke all on function trg_sembrar_casillas_bloque() from anon, authenticated;
