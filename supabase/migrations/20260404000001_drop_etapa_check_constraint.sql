-- Eliminar el CHECK constraint hardcodeado en oportunidades.etapa
-- que solo permitia: lead_nuevo, contacto_inicial, discovery_hecha,
-- propuesta_enviada, negociacion, ganada, perdida.
-- Ahora las etapas son configurables por workspace via workspace_stages.

ALTER TABLE oportunidades DROP CONSTRAINT IF EXISTS oportunidades_etapa_check;
