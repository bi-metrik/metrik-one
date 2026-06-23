-- Pago externo (no ePayco) — F4 SOENA
--
-- Agrega 'externo' al CHECK de cobros.tipo_cobro para soportar pagos que NO
-- entran por la pasarela ePayco (caso "cuenta de vivienda" ~10 casos + B2B).
-- Un cobro tipo 'externo' con fecha seteada cuenta para el saldo del negocio
-- igual que cualquier otro cobro confirmado (la lógica de saldo suma cobros.monto
-- por negocio_id sin filtrar por tipo_cobro).
--
-- Retrocompatible: solo amplía el ARRAY del constraint, no toca filas existentes
-- ni el comportamiento de otros tipos. Otros workspaces no ven cambio.

alter table public.cobros drop constraint if exists cobros_tipo_cobro_check;

alter table public.cobros add constraint cobros_tipo_cobro_check
  check (tipo_cobro = any (array[
    'regular'::text,
    'anticipo'::text,
    'saldo'::text,
    'pago'::text,
    'programado'::text,
    'externo'::text
  ]));
