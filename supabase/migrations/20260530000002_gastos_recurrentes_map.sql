-- ============================================================
-- gastos_recurrentes_map: whitelist proveedor → centro de costos
-- ============================================================
--
-- Tabla que mapea proveedores recurrentes a un centro de costos por defecto.
-- Habilita la heurística #1 de la cascada de auto-asignación: si el proveedor
-- (normalizado de descripción) ya está mapeado, asignar silenciosamente.
--
-- También soporta self-learning: si 3 gastos manuales del mismo proveedor
-- caen al mismo centro, el motor inserta automáticamente con created_by='auto'.
-- ============================================================

CREATE TABLE IF NOT EXISTS gastos_recurrentes_map (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- proveedor_match: string normalizado a comparar contra descripción del gasto.
  -- Convención: lowercase, sin acentos, espacios colapsados.
  proveedor_match text NOT NULL,

  -- Uno de los 4 valores del enum centro_costos
  centro_costos text NOT NULL
    CHECK (centro_costos IN (
      'directa_negocio',
      'distribuible_one',
      'distribuible_clarity',
      'mixta'
    )),

  -- Solo aplicable cuando centro_costos = 'directa_negocio'.
  -- Si está, la regla pre-asigna ESE negocio.
  negocio_id_default uuid REFERENCES negocios(id) ON DELETE SET NULL,

  -- 0.0-1.0. Sistema de promoción 3+ matches incrementa.
  confianza numeric NOT NULL DEFAULT 1.0
    CHECK (confianza >= 0 AND confianza <= 1),

  -- 'auto' = self-learning, 'manual' = usuario lo guardó explícitamente
  created_by text NOT NULL DEFAULT 'manual'
    CHECK (created_by IN ('auto', 'manual')),

  created_at timestamptz NOT NULL DEFAULT now(),

  -- Un proveedor sólo puede tener una regla por workspace
  UNIQUE (workspace_id, proveedor_match),

  -- Si centro = directa_negocio, idealmente hay negocio_id_default.
  -- No se fuerza por CHECK (puede haber regla genérica "siempre a un negocio cualquiera"
  -- y el motor preguntará cuál), pero documentamos.
  CONSTRAINT chk_negocio_solo_si_directa CHECK (
    negocio_id_default IS NULL
    OR centro_costos = 'directa_negocio'
  )
);

-- Índice de búsqueda principal
CREATE INDEX IF NOT EXISTS idx_grm_workspace
  ON gastos_recurrentes_map (workspace_id);

CREATE INDEX IF NOT EXISTS idx_grm_proveedor
  ON gastos_recurrentes_map (workspace_id, proveedor_match);

-- RLS por workspace
ALTER TABLE gastos_recurrentes_map ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS grm_read ON gastos_recurrentes_map;
CREATE POLICY grm_read ON gastos_recurrentes_map
  FOR SELECT
  USING (workspace_id = current_user_workspace_id());

DROP POLICY IF EXISTS grm_insert ON gastos_recurrentes_map;
CREATE POLICY grm_insert ON gastos_recurrentes_map
  FOR INSERT
  WITH CHECK (workspace_id = current_user_workspace_id());

DROP POLICY IF EXISTS grm_update ON gastos_recurrentes_map;
CREATE POLICY grm_update ON gastos_recurrentes_map
  FOR UPDATE
  USING (workspace_id = current_user_workspace_id())
  WITH CHECK (workspace_id = current_user_workspace_id());

DROP POLICY IF EXISTS grm_delete ON gastos_recurrentes_map;
CREATE POLICY grm_delete ON gastos_recurrentes_map
  FOR DELETE
  USING (workspace_id = current_user_workspace_id());

COMMENT ON TABLE gastos_recurrentes_map IS
  'Whitelist de proveedores recurrentes → centro de costos. Habilita auto-asignación silenciosa de gastos repetidos. Self-learning vía promoción 3+ matches manuales con mismo centro.';

COMMENT ON COLUMN gastos_recurrentes_map.proveedor_match IS
  'String normalizado (lowercase, sin acentos, espacios colapsados) a comparar contra gastos.descripcion. Match exacto.';

COMMENT ON COLUMN gastos_recurrentes_map.created_by IS
  '"auto" = creado por self-learning del motor tras 3 manuales coincidentes. "manual" = usuario lo guardó explícitamente o admin.';
