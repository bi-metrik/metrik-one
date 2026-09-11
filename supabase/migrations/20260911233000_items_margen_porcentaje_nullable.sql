-- El margen propio de una linea deja de ser obligatorio.
--
-- Desde que la cotizacion tiene su propio margen, `items.margen_porcentaje` pasa a ser
-- una EXCEPCION: `null` quiere decir "usa el de la cotizacion" y un numero quiere decir
-- "esta linea margina distinto". Con NOT NULL y default 0 no habia forma de decir lo
-- primero: toda linea nacia marcada como excepcion al 0%, y subir el margen de la
-- cotizacion no movia ni un peso.
--
-- Las lineas que ya existen conservan su numero, asi que ninguna cotizacion emitida
-- cambia de precio.

ALTER TABLE items ALTER COLUMN margen_porcentaje DROP NOT NULL;
ALTER TABLE items ALTER COLUMN margen_porcentaje DROP DEFAULT;

COMMENT ON COLUMN items.margen_porcentaje IS
  'Margen propio de la linea. NULL = usa el margen de la cotizacion; 0 = esta linea va a costo.';
