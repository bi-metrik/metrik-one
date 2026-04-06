-- Permitir multiples borradores por negocio, pero maximo 1 cotizacion enviada
CREATE UNIQUE INDEX IF NOT EXISTS idx_una_enviada_por_negocio
  ON cotizaciones (negocio_id)
  WHERE estado = 'enviada' AND negocio_id IS NOT NULL;
