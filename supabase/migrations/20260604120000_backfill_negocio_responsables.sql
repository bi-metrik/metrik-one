-- Backfill negocio_responsables (N:M) desde negocios.responsable_id (legacy singular).
--
-- Contexto: el modelo de permisos (getNegociosV2, getNegocioDetalleCompleto,
-- guard-negocio) lee SIEMPRE negocio_responsables, pero la asignación histórica
-- escribía solo negocios.responsable_id → la tabla N:M quedaba vacía y ningún
-- operator veía sus negocios. A partir de ahora negocio_responsables es la fuente
-- de verdad (multi-responsable); responsable_id queda como principal derivado.
--
-- Idempotente: conserva filas N:M existentes (ON CONFLICT DO NOTHING).
-- assigned_by se deja NULL (backfill de sistema, no atribuible a un usuario).

INSERT INTO negocio_responsables (negocio_id, staff_id, assigned_by)
SELECT n.id, n.responsable_id, NULL
FROM negocios n
WHERE n.responsable_id IS NOT NULL
ON CONFLICT (negocio_id, staff_id) DO NOTHING;
