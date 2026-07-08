-- ============================================================
-- 20260708000010 — tipo_cobro += 'pasante' (recaudo a favor de terceros)
-- ------------------------------------------------------------
-- P3 Ola 1 (SOENA). El cambio de proceso UPME (2026-07-08) hace que SOENA
-- recaude TODO (honorario + tarifa UPME) y luego financiera desembolse la
-- tarifa a la UPME. Esa tarifa es un PASIVO (recaudo a favor de un tercero),
-- no un ingreso de SOENA.
--
-- `pasante` es simétrico a `devolucion_pendiente` (2026-06-23): un tipo de
-- cobro que SÍ cuadra el saldo del negocio (el cliente pagó esa plata) pero se
-- EXCLUYE del ingreso/recaudo/MC/EBITDA. La exclusión del ingreso vive en la
-- migración 20260708000011 (v_pyl_mes) y en numeros/actions-v2.ts.
--
-- Backward-compatible: ningún cobro tiene este tipo aún, así que agregar el
-- valor al CHECK no cambia números de ningún workspace hoy.
--
-- NOTA: la CREACIÓN de cobros pasante (el reparto honorario/tarifa) es Ola 2.
-- Aquí solo se habilita el tipo.
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
    'pasante'::text
  ]));

comment on constraint cobros_tipo_cobro_check on public.cobros is
  '8 tipos. pasante (2026-07-08) = recaudo a favor de terceros (tarifa UPME): '
  'cuadra el saldo del negocio pero se excluye de ingreso/recaudo/MC/EBITDA.';
