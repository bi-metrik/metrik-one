-- ============================================================
-- Fichas estandar de bloques: codigo + descripciones mejoradas
-- Agrega codigo unico a bloque_definitions y descripcion a bloque_configs
-- ============================================================

-- 1. Agregar columna codigo a bloque_definitions
ALTER TABLE bloque_definitions ADD COLUMN IF NOT EXISTS codigo TEXT;

-- Crear UNIQUE constraint (si no existe)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bloque_definitions_codigo_key'
  ) THEN
    ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_codigo_key UNIQUE (codigo);
  END IF;
END;
$$;

-- 2. Agregar columna descripcion a bloque_configs (nullable)
ALTER TABLE bloque_configs ADD COLUMN IF NOT EXISTS descripcion TEXT;

-- 3. UPDATE codigos en bloque_definitions
UPDATE bloque_definitions SET codigo = 'B01' WHERE tipo = 'datos';
UPDATE bloque_definitions SET codigo = 'B02' WHERE tipo = 'documentos';
UPDATE bloque_definitions SET codigo = 'B03' WHERE tipo = 'documento';
UPDATE bloque_definitions SET codigo = 'B04' WHERE tipo = 'cotizacion';
UPDATE bloque_definitions SET codigo = 'B05' WHERE tipo = 'cobros';
UPDATE bloque_definitions SET codigo = 'B06' WHERE tipo = 'checklist';
UPDATE bloque_definitions SET codigo = 'B07' WHERE tipo = 'checklist_soporte';
UPDATE bloque_definitions SET codigo = 'B08' WHERE tipo = 'equipo';
UPDATE bloque_definitions SET codigo = 'B09' WHERE tipo = 'aprobacion';
UPDATE bloque_definitions SET codigo = 'B10' WHERE tipo = 'cronograma';
UPDATE bloque_definitions SET codigo = 'B11' WHERE tipo = 'resumen_financiero';
UPDATE bloque_definitions SET codigo = 'B12' WHERE tipo = 'ejecucion';
UPDATE bloque_definitions SET codigo = 'B13' WHERE tipo = 'historial';

-- 4. UPDATE descripciones mejoradas en bloque_definitions
UPDATE bloque_definitions SET descripcion = 'Formulario dinamico de campos tipados. Captura informacion estructurada del negocio en cada etapa' WHERE tipo = 'datos';
UPDATE bloque_definitions SET descripcion = 'Coleccion de archivos con slots nombrados. Cada documento tiene slug, label y obligatoriedad' WHERE tipo = 'documentos';
UPDATE bloque_definitions SET descripcion = 'Carga de un documento individual. Exportacion a Drive y extraccion AI opcional' WHERE tipo = 'documento';
UPDATE bloque_definitions SET descripcion = 'Propuesta economica con ciclo borrador-enviada-aceptada/rechazada. Genera PDF profesional' WHERE tipo = 'cotizacion';
UPDATE bloque_definitions SET descripcion = 'Vista de cartera del negocio: anticipos, pagos parciales, saldo pendiente calculado dinamicamente' WHERE tipo = 'cobros';
UPDATE bloque_definitions SET descripcion = 'Lista de tareas checkbox. Completar todos los items marca el bloque como completo' WHERE tipo = 'checklist';
UPDATE bloque_definitions SET descripcion = 'Checklist con link a evidencia obligatorio por cada item' WHERE tipo = 'checklist_soporte';
UPDATE bloque_definitions SET descripcion = 'Asignacion de responsables tipados: comercial, ejecucion, financiero' WHERE tipo = 'equipo';
UPDATE bloque_definitions SET descripcion = 'Punto de decision del workflow. Un aprobador acepta o rechaza con comentario' WHERE tipo = 'aprobacion';
UPDATE bloque_definitions SET descripcion = 'Actividades con fechas de inicio/fin y responsables. Gestion de tiempos liviana' WHERE tipo = 'cronograma';
UPDATE bloque_definitions SET descripcion = 'Consolidacion financiera del negocio en solo lectura' WHERE tipo = 'resumen_financiero';
UPDATE bloque_definitions SET descripcion = 'KPIs de ejecucion y gastos por categoria en solo lectura' WHERE tipo = 'ejecucion';
UPDATE bloque_definitions SET descripcion = 'Gastos, horas y cobros del negocio organizados en tabs. Solo lectura' WHERE tipo = 'historial';
