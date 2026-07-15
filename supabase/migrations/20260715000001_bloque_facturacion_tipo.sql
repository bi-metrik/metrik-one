-- Bloque nuevo tipo 'facturacion' (Siigo-ready): amplía el CHECK de
-- bloque_definitions.tipo y crea la definition global (sin workspace_id).
-- La instancia por workspace (bloque_config) es config específica de cada línea
-- (ver proyectos/<cliente>/<linea>/migrations). Idempotente.

ALTER TABLE bloque_definitions DROP CONSTRAINT IF EXISTS bloque_definitions_tipo_check;
ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_tipo_check
  CHECK (tipo = ANY (ARRAY[
    'datos','documentos','documento','cotizacion','cobros','checklist',
    'checklist_soporte','equipo','aprobacion','cronograma','resumen_financiero',
    'ejecucion','historial','formulario','plan_recurrente','historial_valida',
    'propuesta_economica','guia_devolucion','facturacion'
  ]::text[]));

INSERT INTO bloque_definitions (tipo, nombre, descripcion, is_visualization, can_be_gate, default_estado, codigo)
SELECT 'facturacion', 'Facturación',
       'Datos de factura para Siigo: autopoblado desde RUT + contacto, con override manual y copiar campos',
       false, false, 'editable', 'FA'
WHERE NOT EXISTS (SELECT 1 FROM bloque_definitions WHERE tipo = 'facturacion');
