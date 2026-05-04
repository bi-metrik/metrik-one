-- ============================================================
-- 20260504100001 — Planes de cobro recurrente
-- Decision producto 2026-05-04: ONE soporta negocios con plan de pagos
-- recurrente (suscripcion ONE, financiacion proyecto, oficial cumplimiento).
-- Reglas:
--  - Todo negocio recurrente tiene fin contractual (no indefinidos)
--  - Cash basis: cobros se reconocen al recibir, no al devengar
--  - 3 dias de gracia post-fecha cuota antes de marcar vencido
--  - Notificacion cobro_vencido a responsable + dueno + area=admin_finanzas
--  - Estado pausado se reutiliza para negocios vigentes con plan activo
-- ============================================================

-- ── Tabla planes_cobro ────────────────────────────────────
CREATE TABLE planes_cobro (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  negocio_id UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  monto NUMERIC(15,2) NOT NULL CHECK (monto > 0),
  frecuencia TEXT NOT NULL CHECK (frecuencia IN ('mensual','trimestral','anual')),
  fecha_inicio DATE NOT NULL,
  fecha_fin DATE NOT NULL,
  total_cuotas INTEGER NOT NULL CHECK (total_cuotas > 0),
  pasarela TEXT NOT NULL DEFAULT 'manual' CHECK (pasarela IN ('wompi','manual','mixto')),
  referencia_wompi TEXT,
  auto_renovar BOOLEAN NOT NULL DEFAULT false,
  activo BOOLEAN NOT NULL DEFAULT true,
  notas TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT planes_cobro_fechas_ordenadas CHECK (fecha_fin >= fecha_inicio)
);

ALTER TABLE planes_cobro ENABLE ROW LEVEL SECURITY;

CREATE POLICY planes_cobro_ws ON planes_cobro
  FOR ALL USING (workspace_id = current_user_workspace_id());

CREATE INDEX idx_planes_cobro_negocio ON planes_cobro(negocio_id);
CREATE INDEX idx_planes_cobro_activo ON planes_cobro(workspace_id, activo, fecha_fin);

COMMENT ON TABLE planes_cobro IS
  'Planes de pago recurrente ligados a un negocio. Generados al activar BloquePlanRecurrente. Un cron diario crea cobros programados con T+3 dias.';

-- ── cobros: tipo programado + campos para link al plan ────
ALTER TABLE cobros DROP CONSTRAINT cobros_tipo_cobro_check;
ALTER TABLE cobros ADD CONSTRAINT cobros_tipo_cobro_check
  CHECK (tipo_cobro IN ('regular','anticipo','saldo','pago','programado'));

ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS plan_cobro_id UUID REFERENCES planes_cobro(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS numero_cuota INTEGER,
  ADD COLUMN IF NOT EXISTS fecha_esperada DATE,
  ADD COLUMN IF NOT EXISTS vencido BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS vencido_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_cobros_plan_cobro ON cobros(plan_cobro_id) WHERE plan_cobro_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_cobros_programados_pendientes ON cobros(workspace_id, tipo_cobro, vencido, fecha_esperada)
  WHERE tipo_cobro = 'programado';

-- Idempotencia: una sola cuota por (plan, numero_cuota)
CREATE UNIQUE INDEX IF NOT EXISTS idx_cobros_plan_cuota_unique
  ON cobros(plan_cobro_id, numero_cuota)
  WHERE plan_cobro_id IS NOT NULL AND numero_cuota IS NOT NULL;

COMMENT ON COLUMN cobros.tipo_cobro IS
  'regular | anticipo | saldo | pago (multi) | programado (recurrente, generado por cron desde plan_cobro)';
COMMENT ON COLUMN cobros.plan_cobro_id IS
  'Link al plan recurrente que genero este cobro. Solo para tipo_cobro=programado.';
COMMENT ON COLUMN cobros.fecha_esperada IS
  'Fecha esperada de la cuota. fecha (sin _esperada) se llena al confirmar el pago. Si fecha_esperada + 3d < hoy y revisado=false → vencido=true.';

-- ── notificaciones: tipo cobro_vencido + entidad negocio/cobro/plan_cobro ─
ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'inactividad_oportunidad','handoff','asignacion_responsable','asignacion_colaborador',
    'mencion','streak_roto','inactividad_proyecto','proyecto_entregado','proyecto_cerrado',
    'cobro_vencido','cobro_proximo','plan_terminado'
  ));

ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_entidad_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_entidad_tipo_check
  CHECK (entidad_tipo IN ('oportunidad','proyecto','cotizacion','negocio','cobro','plan_cobro'));

-- ── Trigger: cierre automatico al confirmar ultima cuota ──
-- Cuando un cobro programado se marca como cobrado (fecha NOT NULL + revisado=true),
-- chequea si es la ultima cuota del plan. Si lo es y no es auto_renovar → cierra negocio.
CREATE OR REPLACE FUNCTION trg_cobro_programado_completado()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  plan_total INTEGER;
  cobros_confirmados INTEGER;
  plan_auto_renovar BOOLEAN;
  plan_negocio UUID;
BEGIN
  -- Solo aplica a cobros programados que recien se confirmaron
  IF NEW.tipo_cobro <> 'programado' THEN RETURN NEW; END IF;
  IF NEW.plan_cobro_id IS NULL THEN RETURN NEW; END IF;
  IF NEW.fecha IS NULL THEN RETURN NEW; END IF;
  IF OLD.fecha IS NOT NULL THEN RETURN NEW; END IF;  -- ya estaba cobrado

  SELECT total_cuotas, auto_renovar, negocio_id
    INTO plan_total, plan_auto_renovar, plan_negocio
    FROM planes_cobro WHERE id = NEW.plan_cobro_id;

  SELECT COUNT(*) INTO cobros_confirmados
    FROM cobros
    WHERE plan_cobro_id = NEW.plan_cobro_id
      AND fecha IS NOT NULL;

  -- Si se confirmo la ultima cuota y no es auto_renovar → marcar plan inactivo
  -- El cierre del negocio se maneja en app code (usa flujo de etapas)
  IF cobros_confirmados >= plan_total AND NOT plan_auto_renovar THEN
    UPDATE planes_cobro SET activo = false, updated_at = now() WHERE id = NEW.plan_cobro_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cobro_programado_completado ON cobros;
CREATE TRIGGER trg_cobro_programado_completado
  AFTER UPDATE ON cobros
  FOR EACH ROW
  EXECUTE FUNCTION trg_cobro_programado_completado();

COMMENT ON FUNCTION trg_cobro_programado_completado IS
  'Cuando se confirma la ultima cuota de un plan no-renovable, marca el plan como inactivo. El cierre del negocio queda en app code (sugerir renovacion B2).';
