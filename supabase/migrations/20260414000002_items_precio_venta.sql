-- ============================================================
-- Items: precio_venta, descuento y descripción por item
-- Permite cotizaciones orientadas al cliente con precio de venta
-- separado de los costos internos (rubros)
-- ============================================================

ALTER TABLE items
  ADD COLUMN IF NOT EXISTS precio_venta numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descuento_porcentaje numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS descripcion text;

-- Backfill: items existentes sin precio_venta usan subtotal como precio
UPDATE items SET precio_venta = COALESCE(subtotal, 0) WHERE precio_venta = 0 OR precio_venta IS NULL;

COMMENT ON COLUMN items.precio_venta IS 'Precio de venta al cliente (lo que ve en PDF)';
COMMENT ON COLUMN items.descuento_porcentaje IS 'Descuento % por item (0-100)';
COMMENT ON COLUMN items.descripcion IS 'Descripción para el cliente (aparece en PDF)';
