-- ============================================================
-- 20260513100001 — Tipo bloque historial_valida
-- ============================================================
-- Bloque de visualizacion read-only que renderiza el historial
-- de consultas Valida atadas al negocio.
--
-- Decision (2026-05-13, Mauricio + Noor + Mik): migrar el panel
-- ad-hoc NegocioValidaSection al esquema de bloques. NO se
-- persisten instancias en negocio_bloques: el bloque se renderiza
-- de forma free-standing al final del detalle de negocio cuando
-- workspace.modules.valida_consulta = true (Opcion B). El registro
-- aqui sirve como catalogo formal del tipo + slot reutilizable
-- a futuro si se quiere insertar como bloque etapa-especifico.
-- ============================================================

-- 1. Expandir CHECK constraint para incluir 'historial_valida'
ALTER TABLE bloque_definitions DROP CONSTRAINT IF EXISTS bloque_definitions_tipo_check;
ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_tipo_check
  CHECK (tipo IN (
    'datos','documentos','documento','cotizacion','cobros',
    'checklist','checklist_soporte','equipo',
    'aprobacion','cronograma',
    'resumen_financiero','ejecucion','historial','formulario',
    'plan_recurrente','historial_valida'
  ));

-- 2. Registrar definicion (idempotente)
INSERT INTO bloque_definitions (
  tipo, nombre, descripcion,
  is_visualization, can_be_gate, supports_array_items,
  default_estado, icon_name
)
VALUES (
  'historial_valida',
  'Consultas Valida',
  'Historial read-only de consultas SARLAFT (Valida) atadas a este negocio. Renderiza free-standing al final del detalle cuando el workspace tiene modules.valida_consulta = true.',
  true,   -- is_visualization
  false,  -- can_be_gate
  false,  -- supports_array_items
  'visible',
  'ShieldCheck'
)
ON CONFLICT (tipo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  is_visualization = EXCLUDED.is_visualization,
  icon_name = EXCLUDED.icon_name;
