-- =============================================================================
-- Constancia del reproceso en el historial de Valida (2026-10-23)
-- =============================================================================
--
-- Hasta el 2026-10-23 la carga masiva mandaba a Valida el tipo de documento tal cual venía en el
-- XLSX («CEDULA», «PP», «TI»...). Valida respondía 400 y la fila quedaba en `severidad = 'error'`.
-- El script `scripts/valida/reprocesar-tipo-documento.ts` vuelve a consultar esas filas y pone al día
-- la MISMA fila. Su `created_at` sigue siendo el del cargue, pero la consulta a Valida es posterior:
-- sin constancia, el historial diría que ese resultado salió el día del cargue.
--
--   reprocesada_at  cuándo se volvió a consultar (null = nunca).
--   reproceso       motivo, tipo original, si se dedujo, severidad anterior y fecha del reporte.
--
-- Solo agrega dos columnas nulas: no toca filas. La app no las lee ni las escribe; solo el script.
-- Aplicar antes de correr el script con --aplicar (sin ella, el script se niega a escribir).
-- =============================================================================

alter table public.valida_consultas
  add column if not exists reprocesada_at timestamptz,
  add column if not exists reproceso jsonb;

comment on column public.valida_consultas.reprocesada_at is
  'Cuándo se volvió a consultar en Valida esta fila (reproceso de una consulta que quedó en error por un defecto de ONE). null = nunca. created_at sigue siendo el del cargue.';
comment on column public.valida_consultas.reproceso is
  'Constancia del reproceso: {motivo, tipo_original, tipo_inferido, severidad_anterior, fecha_reporte}.';
