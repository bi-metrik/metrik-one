-- Congela la convención de margen de todo lo ya cotizado.
--
-- El default del producto pasa de `markup` (recargo sobre el costo) a `sobre_venta`,
-- para que el número que escribe quien cotiza SEA el margen real y la pantalla no
-- tenga que enseñar dos cifras del mismo dinero.
--
-- Una cotización con `convencion_margen` en NULL lee el default en tiempo de cálculo,
-- así que cambiar el default le movería el precio a lo que ya está cotizado. Dejarlo
-- escrito lo impide: lo viejo sigue calculando como calculaba, y el default nuevo solo
-- alcanza a lo que nazca de aquí en adelante.
--
-- A la fecha son 18 cotizaciones, y solo una tiene margen distinto de cero; con margen
-- 0 las dos convenciones dan el mismo precio. Aun así se fijan todas: el valor escrito
-- es lo que hace la migración idempotente y auditable, no el efecto sobre el precio.

UPDATE cotizaciones
SET convencion_margen = 'markup'
WHERE convencion_margen IS NULL;

COMMENT ON COLUMN cotizaciones.convencion_margen IS
  'markup = el margen es un recargo sobre el costo; sobre_venta = el margen es el margen real sobre el precio. Se copia al CREAR la cotización y no se vuelve a consultar: cambiar la política de la línea no puede moverle el precio a una cotización ya enviada. NULL lee CONVENCION_MARGEN_POR_DEFECTO, hoy sobre_venta.';
