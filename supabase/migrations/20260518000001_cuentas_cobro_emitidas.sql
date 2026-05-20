-- ============================================================
-- 20260518000001 — Cuentas de cobro emitidas + planillas PILA por periodo
--
-- Contexto: Mauricio persona natural emite mensualmente cuentas de cobro
-- a clientes recurrentes (SOENA, AFI). Esta tabla es el "espejo PDF"
-- del flujo de cobros — agrupa N cobros programados de la misma empresa
-- pagadora en una sola cuenta numerada CC-YYYY-MM-NNN, con PDF en Drive,
-- aprobacion humana, envio via Resend, y trazabilidad de pago.
--
-- Decisiones canonicas:
--  - Numeracion CC-YYYY-MM-NNN consecutiva por workspace + año-mes
--  - Agrupacion por empresa pagadora (un mismo cliente con N negocios = 1 cuenta)
--  - Vencimiento estandarizado dia 15 (decision 2026-05-16)
--  - Aprobacion humana obligatoria antes de enviar email
--  - Planilla PILA del periodo se referencia automaticamente como soporte
--
-- Refs:
--  - cerebro/conceptos/cobros-recurrentes-metrik.md
--  - cerebro/reglas/cuenta-cobro-persona-natural-mauricio.md
--  - cerebro/decisiones/2026-05-16_dia-15-vencimiento-cuentas-cobro-mensuales.md
-- ============================================================

-- ── Enum estado cuenta de cobro ─────────────────────────────
CREATE TYPE cuenta_cobro_estado AS ENUM (
  'borrador',                       -- generada manualmente, no emitida aun
  'emitida_pendiente_aprobacion',   -- generada por cron o action, esperando aprobacion humana
  'aprobada_lista_envio',           -- aprobada, lista para envio (caso especial: envio fallo y queda en cola)
  'enviada',                        -- email enviado al cliente, esperando pago
  'pagada',                         -- pago recibido, sin conciliar contable
  'conciliada',                     -- pago conciliado contablemente, ciclo cerrado
  'anulada'                         -- cancelada (regenerada por error, etc.)
);

-- ── Tabla planillas_pila_periodo ────────────────────────────
-- La PILA es del titular (persona natural), no del cliente.
-- Se carga UNA vez por mes y aplica a todas las cuentas emitidas ese mes.
CREATE TABLE planillas_pila_periodo (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  año INTEGER NOT NULL CHECK (año >= 2026 AND año <= 2100),
  mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),
  file_drive_id TEXT NOT NULL,
  file_drive_url TEXT NOT NULL,
  monto_aportado NUMERIC(15,2),
  uploaded_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notas TEXT,
  CONSTRAINT planillas_pila_unique_periodo UNIQUE (workspace_id, año, mes)
);

ALTER TABLE planillas_pila_periodo ENABLE ROW LEVEL SECURITY;

CREATE POLICY planillas_pila_periodo_ws ON planillas_pila_periodo
  FOR ALL USING (workspace_id = current_user_workspace_id());

CREATE INDEX idx_planillas_pila_ws_año_mes ON planillas_pila_periodo(workspace_id, año, mes);

COMMENT ON TABLE planillas_pila_periodo IS
  'Planilla PILA del titular (persona natural emisora). Una por mes por workspace. Se referencia automaticamente desde cuentas_cobro_emitidas del mismo periodo como soporte de aportes a seguridad social (Decreto 1273/2018 + Art. 244 Ley 1955/2019).';

-- ── Tabla cuentas_cobro_emitidas ────────────────────────────
CREATE TABLE cuentas_cobro_emitidas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  -- Numeracion canonica
  numero TEXT NOT NULL,                          -- CC-YYYY-MM-NNN consecutivo
  año INTEGER NOT NULL CHECK (año >= 2026 AND año <= 2100),
  mes INTEGER NOT NULL CHECK (mes >= 1 AND mes <= 12),

  -- Pagador (empresa cliente)
  empresa_id_pagador UUID NOT NULL REFERENCES empresas(id) ON DELETE RESTRICT,

  -- Cobros agrupados en esta cuenta (uno o varios planes de la misma empresa)
  cobros_ids UUID[] NOT NULL CHECK (array_length(cobros_ids, 1) > 0),

  -- Valor total (suma de los cobros agrupados, snapshot al momento de emitir)
  monto_total NUMERIC(15,2) NOT NULL CHECK (monto_total > 0),

  -- Documento generado
  pdf_drive_id TEXT,
  pdf_drive_url TEXT,

  -- Planilla PILA referenciada (puede ser NULL si no se ha cargado aun)
  planilla_pila_id UUID REFERENCES planillas_pila_periodo(id) ON DELETE SET NULL,

  -- Estado y trazabilidad
  estado cuenta_cobro_estado NOT NULL DEFAULT 'emitida_pendiente_aprobacion',
  fecha_emision DATE NOT NULL DEFAULT CURRENT_DATE,
  fecha_vencimiento DATE NOT NULL,

  -- Aprobacion humana
  aprobado_por UUID REFERENCES profiles(id) ON DELETE SET NULL,
  aprobado_at TIMESTAMPTZ,

  -- Envio email
  email_destinatarios TEXT[],
  email_enviado_at TIMESTAMPTZ,
  email_resend_id TEXT,                          -- ID retornado por Resend para tracking

  -- Pago confirmado (snapshot al marcar pagada)
  pagado_at TIMESTAMPTZ,

  -- Conciliacion contable (snapshot al marcar conciliada)
  conciliado_at TIMESTAMPTZ,

  -- Misc
  notas TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT cuentas_cobro_numero_unique UNIQUE (workspace_id, numero)
);

ALTER TABLE cuentas_cobro_emitidas ENABLE ROW LEVEL SECURITY;

CREATE POLICY cuentas_cobro_emitidas_ws ON cuentas_cobro_emitidas
  FOR ALL USING (workspace_id = current_user_workspace_id());

CREATE INDEX idx_cuentas_cobro_ws_periodo ON cuentas_cobro_emitidas(workspace_id, año DESC, mes DESC);
CREATE INDEX idx_cuentas_cobro_estado ON cuentas_cobro_emitidas(workspace_id, estado);
CREATE INDEX idx_cuentas_cobro_empresa ON cuentas_cobro_emitidas(empresa_id_pagador);
CREATE INDEX idx_cuentas_cobro_cobros_gin ON cuentas_cobro_emitidas USING GIN (cobros_ids);

COMMENT ON TABLE cuentas_cobro_emitidas IS
  'Cuentas de cobro emitidas mensualmente. Espejo PDF del flujo de cobros. Agrupa N cobros programados de la misma empresa pagadora en una sola cuenta numerada. Vive en workspace con modules.cobros_recurrentes=true.';

COMMENT ON COLUMN cuentas_cobro_emitidas.cobros_ids IS
  'Array de cobros.id incluidos en esta cuenta. Permite agrupar cobros de varios negocios de la misma empresa. Indexado GIN para queries WHERE id = ANY(cobros_ids).';

COMMENT ON COLUMN cuentas_cobro_emitidas.numero IS
  'Numero canonico CC-YYYY-MM-NNN consecutivo por workspace + año + mes. Generado por function generate_cuenta_cobro_numero().';

-- ── Function: numero consecutivo CC-YYYY-MM-NNN ─────────────
CREATE OR REPLACE FUNCTION generate_cuenta_cobro_numero(
  p_workspace_id UUID,
  p_año INTEGER,
  p_mes INTEGER
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  next_n INTEGER;
  numero TEXT;
BEGIN
  -- Lock advisory para evitar race conditions cuando el cron emite varias en paralelo
  PERFORM pg_advisory_xact_lock(
    hashtext('cuenta_cobro_numero:' || p_workspace_id::text || ':' || p_año || ':' || p_mes)
  );

  SELECT COALESCE(MAX(
    NULLIF(regexp_replace(numero, '^CC-\d{4}-\d{2}-', ''), '')::INTEGER
  ), 0) + 1
    INTO next_n
    FROM cuentas_cobro_emitidas
    WHERE workspace_id = p_workspace_id
      AND año = p_año
      AND mes = p_mes;

  numero := 'CC-' || p_año::text || '-' || LPAD(p_mes::text, 2, '0') || '-' || LPAD(next_n::text, 3, '0');

  RETURN numero;
END;
$$;

COMMENT ON FUNCTION generate_cuenta_cobro_numero IS
  'Genera numero consecutivo CC-YYYY-MM-NNN para una cuenta de cobro nueva. Usa advisory lock para idempotencia bajo concurrencia (cron + emision manual).';

-- ── Trigger: auto-asignar numero al insertar si viene NULL ──
CREATE OR REPLACE FUNCTION trg_cuenta_cobro_numero_auto()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.numero IS NULL OR NEW.numero = '' THEN
    NEW.numero := generate_cuenta_cobro_numero(NEW.workspace_id, NEW.año, NEW.mes);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuenta_cobro_numero_auto ON cuentas_cobro_emitidas;
CREATE TRIGGER trg_cuenta_cobro_numero_auto
  BEFORE INSERT ON cuentas_cobro_emitidas
  FOR EACH ROW
  EXECUTE FUNCTION trg_cuenta_cobro_numero_auto();

-- ── Trigger: updated_at automatico ──────────────────────────
CREATE OR REPLACE FUNCTION trg_cuentas_cobro_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cuentas_cobro_updated_at ON cuentas_cobro_emitidas;
CREATE TRIGGER trg_cuentas_cobro_updated_at
  BEFORE UPDATE ON cuentas_cobro_emitidas
  FOR EACH ROW
  EXECUTE FUNCTION trg_cuentas_cobro_updated_at();

-- ── Notificaciones: nuevos tipos para flujo aprobacion ──────
-- Extiende el CHECK existente (que ya incluye cobro_vencido, cobro_proximo, plan_terminado de migration 20260504100001)
ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_tipo_check
  CHECK (tipo IN (
    'inactividad_oportunidad','handoff','asignacion_responsable','asignacion_colaborador',
    'mencion','streak_roto','inactividad_proyecto','proyecto_entregado','proyecto_cerrado',
    'cobro_vencido','cobro_proximo','plan_terminado',
    'cuenta_cobro_pendiente_aprobacion','cuenta_cobro_enviada','cuenta_cobro_envio_fallo'
  ));

ALTER TABLE notificaciones DROP CONSTRAINT notificaciones_entidad_tipo_check;
ALTER TABLE notificaciones ADD CONSTRAINT notificaciones_entidad_tipo_check
  CHECK (entidad_tipo IN (
    'oportunidad','proyecto','cotizacion','negocio','cobro','plan_cobro',
    'cuenta_cobro'
  ));
