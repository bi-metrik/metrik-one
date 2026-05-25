-- Trazabilidad por lote: rango de serie de las unidades fabricadas.
-- Modelo hibrido: un QR por lote, pero el certificado muestra el rango de serie
-- (ej. 0001-0180) y la cantidad. No serializa cada unidad con QR propio.
alter table cert_lotes add column if not exists serie_desde int;
alter table cert_lotes add column if not exists serie_hasta int;
