-- Ficha tecnica del producto: descripcion + nomenclatura del SKU + especificaciones.
-- jsonb por producto, editable. Se muestra en la pagina publica de certificacion
-- (seccion "Especificaciones tecnicas" + "Que significa <SKU>").
alter table cert_productos add column if not exists ficha jsonb;
