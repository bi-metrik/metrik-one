-- El pago que NO lleva recibo de caja, y por qué.
--
-- Decisión de Mauricio (2026-09-07): los pagos de negocios que YA se facturaron no
-- reciben recibo retroactivo. El recibo de caja arrancó el 2026-09-03 y emitirlo hacia
-- atrás sobre 334 pagos ($216.8M) llenaría la contabilidad de documentos de septiembre
-- por plata de meses anteriores, y le escribiría a cientos de clientes por trámites que
-- ya terminaron.
--
-- ⚠️ Es una MARCA EXPLÍCITA, no una regla. Se pensó resolverlo con "si el negocio tiene
-- factura, no pide recibo", y está mal: un pago entra ANTES de la factura, así que esa
-- regla haría que todo pago reciente pidiera recibo y dejara de pedirlo el día que se
-- facturara. El recibo se emite cuando entra la plata, no según lo que pase después.
-- Esto es un corte histórico que se aplica una vez, no un criterio permanente.
--
-- Sin datos: la columna nace vacía. El corte lo aplica un UPDATE aparte, revisable.
alter table public.cobros add column if not exists recibo_no_aplica jsonb;

comment on column public.cobros.recibo_no_aplica is
  'Marca de que este pago no lleva recibo de caja: { motivo, at, por }. '
  'La usa el control de recibos para no reportarlo como pendiente eternamente.';

-- El control de recibos pregunta por lo PENDIENTE: sin recibo, sin marca y sin anular.
drop index if exists public.cobros_sin_recibo_idx;
create index if not exists cobros_recibo_pendiente_idx
  on public.cobros (workspace_id, fecha)
  where siigo_recibo is null and recibo_no_aplica is null and anulado_at is null;
