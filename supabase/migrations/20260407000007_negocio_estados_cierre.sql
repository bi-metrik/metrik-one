-- ============================================================
-- NEGOCIOS: Estados de cierre diferenciados
-- Reemplaza el CHECK binario ('activo','cerrado') con 4 estados
-- y agrega columnas para cierre detallado
-- ============================================================

-- 1. Actualizar CHECK constraint de estado
ALTER TABLE negocios DROP CONSTRAINT IF EXISTS negocios_estado_check;
ALTER TABLE negocios ADD CONSTRAINT negocios_estado_check
  CHECK (estado IN ('abierto', 'activo', 'perdido', 'cancelado', 'completado', 'cerrado'));
-- Nota: 'activo' y 'cerrado' se mantienen para compatibilidad con datos existentes

-- 2. Agregar columnas de cierre detallado (si no existen)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'negocios' AND column_name = 'razon_cierre') THEN
    ALTER TABLE negocios ADD COLUMN razon_cierre TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'negocios' AND column_name = 'descripcion_cierre') THEN
    ALTER TABLE negocios ADD COLUMN descripcion_cierre TEXT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'negocios' AND column_name = 'cierre_snapshot') THEN
    ALTER TABLE negocios ADD COLUMN cierre_snapshot JSONB;
  END IF;
END $$;

-- 3. Migrar datos existentes: estado='cerrado' sin tipo_cierre → 'completado'
UPDATE negocios
SET estado = 'completado'
WHERE estado = 'cerrado' AND tipo_cierre IS NULL;

-- Migrar: estado='cerrado' + tipo_cierre='perdido' → 'perdido'
UPDATE negocios
SET estado = 'perdido',
    razon_cierre = COALESCE(motivo_cierre, 'otro')
WHERE estado = 'cerrado' AND tipo_cierre = 'perdido';

-- Migrar: estado='cerrado' + tipo_cierre='cancelado' → 'cancelado'
UPDATE negocios
SET estado = 'cancelado',
    razon_cierre = COALESCE(motivo_cierre, 'otro'),
    descripcion_cierre = motivo_cierre
WHERE estado = 'cerrado' AND tipo_cierre = 'cancelado';

-- Migrar: estado='cerrado' + tipo_cierre='finalizado' → 'completado'
UPDATE negocios
SET estado = 'completado',
    cierre_snapshot = balance_final
WHERE estado = 'cerrado' AND tipo_cierre = 'finalizado';

-- Migrar: estado='activo' → 'abierto' (normalizar)
UPDATE negocios
SET estado = 'abierto'
WHERE estado = 'activo';
