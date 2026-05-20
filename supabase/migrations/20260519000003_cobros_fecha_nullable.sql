-- Drop NOT NULL en cobros.fecha.
-- Semantica nueva: fecha=NULL => cobro programado pendiente de pago.
--                  fecha=DATE => pago confirmado en esa fecha.
-- Alinea schema con la logica usada en generarCuentasCobroPeriodo
-- (filtra .is('fecha', null) para identificar cobros aun no pagados).
-- El default CURRENT_DATE se mantiene para inserts manuales/legacy
-- que no especifiquen fecha; el cron pasa fecha:null explicito.

ALTER TABLE cobros ALTER COLUMN fecha DROP NOT NULL;

COMMENT ON COLUMN cobros.fecha IS 'Fecha de pago confirmado. NULL = cobro programado aun no pagado. Default CURRENT_DATE solo aplica si el insert no pasa fecha explicita.';
