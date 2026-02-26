-- D119: Estado de pago en gastos (pagado/pendiente)
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS estado_pago TEXT DEFAULT 'pagado'
    CHECK (estado_pago IN ('pagado', 'pendiente'));

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS fecha_pago DATE;

CREATE INDEX IF NOT EXISTS idx_gastos_estado_pago ON gastos(estado_pago);

COMMENT ON COLUMN gastos.estado_pago IS 'pagado (default) o pendiente (cuenta por pagar)';
COMMENT ON COLUMN gastos.fecha_pago IS 'Fecha de pago efectivo. NULL si pagado en la fecha del gasto.';
