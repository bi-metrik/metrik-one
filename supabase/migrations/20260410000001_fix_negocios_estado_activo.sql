-- Fix: migrar negocios con estado='activo' a 'abierto'
-- El seed de Altavista y datos legacy usaban 'activo' pero el valor correcto es 'abierto'
UPDATE negocios SET estado = 'abierto' WHERE estado = 'activo';
