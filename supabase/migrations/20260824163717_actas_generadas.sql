-- ============================================================
-- 20260824163717 — Tabla actas_generadas
--
-- Persistencia de las actas automaticas generadas por el cron diario
-- (src/app/api/crons/actas-diarias). Da idempotencia por transcript_file_id:
-- el fileId de Google Docs de la transcripcion es unico globalmente en Drive,
-- asi que no hace falta componer la unicidad con workspace_id.
--
-- workspace_id nullable a proposito: el pipeline de lectura (seleccionarDelDia
-- en src/lib/actas/seleccion.ts) opera sobre UN SOLO calendario (el de
-- Mauricio/MeTRIK, via listarReunionesDelDia sin loop por workspace) y esta
-- iteracion NO resuelve a que negocio/workspace pertenece cada reunion
-- (src/lib/actas/cliente.ts existe pero esa vinculacion es un frente aparte,
-- documentado como pendiente "§8bis" — fuera de alcance de este cron). Por
-- eso workspace_id queda NULL en todas las filas por ahora; la columna se deja
-- lista para cuando ese frente se construya.
--
-- server-only: solo el cron de actas la escribe/lee, aun no hay UI que
-- consuma esta tabla con el cliente `authenticated`.
-- ============================================================

CREATE TABLE actas_generadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  transcript_file_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  titulo TEXT,
  fecha_reunion DATE NOT NULL,
  duracion_segundos INTEGER NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('interna', 'externa')),
  resumen TEXT NOT NULL,
  decisiones JSONB NOT NULL DEFAULT '[]',
  compromisos JSONB NOT NULL DEFAULT '[]',
  participantes JSONB NOT NULL DEFAULT '[]',
  modo_envio TEXT NOT NULL CHECK (modo_envio IN ('revision', 'produccion')),
  estado TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'enviada')),
  resend_id TEXT,
  enviado_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE actas_generadas ENABLE ROW LEVEL SECURITY;

-- Idempotencia: el fileId de la transcripcion en Drive es la clave natural.
ALTER TABLE actas_generadas ADD CONSTRAINT actas_generadas_transcript_file_id_key
  UNIQUE (transcript_file_id);

CREATE INDEX idx_actas_generadas_fecha ON actas_generadas(fecha_reunion DESC);
CREATE INDEX idx_actas_generadas_workspace ON actas_generadas(workspace_id)
  WHERE workspace_id IS NOT NULL;

COMMENT ON TABLE actas_generadas IS
  'Actas automaticas generadas por el cron diario a partir de transcripciones de Google Meet. Idempotencia por transcript_file_id (unico global en Drive). Server-only: sin UI aun.';
