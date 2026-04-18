-- Agrega 4 campos faltantes a relacion-facturas en SOENA etapa 9 (Devolución).
-- tipo_vehiculo, municipio, email, telefono son necesarios para la firma y el
-- párrafo introductorio del documento oficial de la DIAN.
-- Fuentes validadas contra la config real del bloque (consultada 2026-04-17):
--   tipo_vehiculo  <- etapa 3, bloque 3 (Factura venta), campo tipo_vehiculo
--   municipio      <- etapa 5, bloque 4 (RUT), campo municipio
--   email          <- etapa 5, bloque 4 (RUT), campo email
--   telefono       <- etapa 5, bloque 4 (RUT), campo telefono

UPDATE bloque_configs
SET config_extra = jsonb_set(
  config_extra,
  '{campos_fuente}',
  (config_extra->'campos_fuente') || '[
    {"slug":"tipo_vehiculo", "source":{"tipo":"ai","campo_slug":"tipo_vehiculo","etapa_orden":3,"bloque_orden":3}},
    {"slug":"municipio",     "source":{"tipo":"ai","campo_slug":"municipio",    "etapa_orden":5,"bloque_orden":4}},
    {"slug":"email",         "source":{"tipo":"ai","campo_slug":"email",        "etapa_orden":5,"bloque_orden":4}},
    {"slug":"telefono",      "source":{"tipo":"ai","campo_slug":"telefono",     "etapa_orden":5,"bloque_orden":4}}
  ]'::jsonb
)
WHERE id = '123b34e1-11bf-4965-9bff-b1ed29013782'
  AND workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5';
