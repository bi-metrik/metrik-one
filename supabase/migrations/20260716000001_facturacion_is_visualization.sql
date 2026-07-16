-- El bloque tipo 'facturacion' (Factura para Siigo) es un helper de visualización
-- (autopobla datos del cliente para copiar a Siigo, sin acción de completar). Se
-- marca is_visualization=true para que no aparezca como tarea "Pendiente" perpetua;
-- el cuerpo sigue interactivo (copiar campos + override "facturar a nombre de otro").
-- Cosmético: is_visualization solo afecta el icono/badge del bloque; no toca gates,
-- modo de edición ni datos. Definition global (solo SOENA usa este tipo hoy).

UPDATE bloque_definitions SET is_visualization = true WHERE tipo = 'facturacion';

-- Rollback: UPDATE bloque_definitions SET is_visualization = false WHERE tipo = 'facturacion';
