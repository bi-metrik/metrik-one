-- ============================================================
-- 20260709000002 — tipo_cobro += 'penalidad' (Regla 2 SOENA, cancelados)
-- ------------------------------------------------------------
-- NO APLICADA A PROD. Se deja en el repo para que Mauricio la aplique cuando
-- Felipe (tributario) resuelva el tratamiento fiscal de la penalidad.
--
-- Regla 2 (2026-07-08): cuando un negocio SOENA se cancela con plata ya recaudada,
-- financiera puede RETENER parte del honorario como penalidad. Contablemente esa
-- plata SÍ se vuelve ingreso, pero de naturaleza DISTINTA al honorario: es una
-- INDEMNIZACIÓN, no contraprestación por servicios. Por eso NO se mezcla con el
-- ingreso por servicios normal — lleva su propio `tipo_cobro='penalidad'`.
--
-- Simétrico a `pasante` (20260708000010) y `devolucion_pendiente` (20260623000001):
-- un tipo de cobro adicional en el CHECK. Backward-compatible: ningún cobro tiene
-- este tipo aún, así que agregar el valor al CHECK no cambia números de ningún
-- workspace hoy.
--
-- 🔴 PENDIENTE FELIPE (tributario): definir si la penalidad entra a `v_pyl_mes` como
-- ingreso (indemnización gravada con renta/IVA/nota) o se excluye. HOY la vista usa
-- `WHERE tipo_cobro IS DISTINCT FROM 'pasante'`, así que un `penalidad` contaría como
-- ingreso. La sección OPCIONAL de abajo (comentada) lo excluiría para NO inflar el
-- ingreso por servicios mientras Felipe decide. Se deja comentada: la decisión es de
-- Felipe, no del código.
-- ============================================================

alter table public.cobros drop constraint if exists cobros_tipo_cobro_check;
alter table public.cobros add constraint cobros_tipo_cobro_check
  check (tipo_cobro = any (array[
    'regular'::text,
    'anticipo'::text,
    'saldo'::text,
    'pago'::text,
    'programado'::text,
    'externo'::text,
    'devolucion_pendiente'::text,
    'pasante'::text,
    'penalidad'::text
  ]));

comment on constraint cobros_tipo_cobro_check on public.cobros is
  '9 tipos. penalidad (2026-07-09) = honorario retenido en un negocio cancelado '
  '(indemnización, NO contraprestación por servicios). Tratamiento fiscal pendiente Felipe.';

-- ─────────────────────────────────────────────────────────────────────────────
-- OPCIONAL (decisión Felipe): excluir 'penalidad' del ingreso por servicios de
-- v_pyl_mes, igual que se excluye 'pasante'. Descomentar SOLO si Felipe confirma
-- que la indemnización no debe sumar al ingreso por servicios de la vista.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- DROP VIEW IF EXISTS v_pyl_mes;
-- CREATE VIEW v_pyl_mes AS
--   ... (misma definición de 20260708000011 pero con:
--        WHERE tipo_cobro IS DISTINCT FROM 'pasante'
--          AND tipo_cobro IS DISTINCT FROM 'penalidad'   -- indemnización, no ingreso por servicios
--        en el subquery `ingresos`)
-- ALTER VIEW v_pyl_mes SET (security_invoker = on);
-- REVOKE SELECT ON v_pyl_mes FROM anon;
