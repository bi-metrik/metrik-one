-- ============================================================================
-- Trappvel · bandeja de WhatsApp: cortes de edad de los pasajeros · 2026-10-01
-- ============================================================================
-- ⚠️ NO ESTÁ APLICADO. Es dato de un workspace, no esquema: lo aplica la sesión principal
-- (copia en proyectos/trappvel/clarity/migrations/ si se decide aplicarlo).
--
-- Encargo: QA de #971 v5, punto 2 (C10). «Los niños tienen 2 y 12» se resolvía callado con un
-- corte de adulto a los 12 que vivía en el código. Desde #971 los cortes salen SOLO de
-- `config_extra.bandeja_solicitudes`; sin ellos, una edad justo en el borde (2 o 12) queda vacía
-- y el bot la pregunta.
--
-- ── Qué propone ─────────────────────────────────────────────────────────────
--   · infante: menor de 2 años      → edad_infante_menor_de = 2
--   · niño:    de 2 a 11 años       → (lo que queda entre los dos cortes)
--   · adulto:  desde 12 años        → edad_adulto_desde = 12
-- Es la regla de las aerolíneas. Si Trappvel cotiza hoteles con otro corte de niño (muchos
-- cobran adulto desde 11 o desde 13), se cambia el número aquí antes de aplicarlo.
--
-- ── Efecto ──────────────────────────────────────────────────────────────────
-- Con los dos cortes, «2 y 12» deja de preguntarse: 1 niño de 2 y el de 12 cuenta como adulto,
-- con la deducción a la vista en el mensaje al comercial. Sin este SQL, se pregunta.
--
-- ── Orden ───────────────────────────────────────────────────────────────────
-- Cualquier orden respecto al deploy: el código viejo ya leía estas dos llaves (con 2 y 12 por
-- defecto); el nuevo las lee sin defecto. No enciende la bandeja (`bandeja_solicitudes_wa`).
--
-- Idempotente. Conserva el resto de `bandeja_solicitudes`.
-- ============================================================================

do $$
declare
  v_ws constant uuid := 'cdd87e5d-5a55-4f6c-a563-7a6ba7800cdc';
  v_n int;
begin
  update public.workspaces
     set config_extra = jsonb_set(
           coalesce(config_extra, '{}'::jsonb),
           '{bandeja_solicitudes}',
           coalesce(config_extra->'bandeja_solicitudes', '{}'::jsonb)
             || '{"edad_infante_menor_de": 2, "edad_adulto_desde": 12}'::jsonb
         )
   where id = v_ws;
  get diagnostics v_n = row_count;
  if v_n <> 1 then
    raise exception 'No existe el workspace % (filas: %)', v_ws, v_n;
  end if;
end;
$$;
