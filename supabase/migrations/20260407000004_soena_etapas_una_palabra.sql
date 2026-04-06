-- ============================================================
-- SOENA VE: Renombrar etapas a una sola palabra
-- ============================================================

UPDATE etapas_negocio SET nombre = 'Contacto'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 1;

UPDATE etapas_negocio SET nombre = 'Negociación'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 2;

UPDATE etapas_negocio SET nombre = 'Documentación'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 3;

UPDATE etapas_negocio SET nombre = 'Inclusión'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 4;

UPDATE etapas_negocio SET nombre = 'Radicación'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 5;

UPDATE etapas_negocio SET nombre = 'Certificación'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 6;

UPDATE etapas_negocio SET nombre = 'Cobro'
WHERE linea_id = (SELECT id FROM lineas_negocio WHERE tipo = 'clarity' AND nombre ILIKE '%VE%' LIMIT 1)
  AND orden = 7;
