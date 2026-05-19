-- ============================================================
-- 20260519000001_sla_horas_festivos_colombia
-- ============================================================
-- Migra SLA por etapa de dias a HORAS HABILES Colombia (L-V excluyendo
-- festivos). Decision producto 2026-05-19: granularidad por hora habilita
-- alertas mas realistas (cobros vencen en horas, no dias).
--
-- Cambios:
-- 1) etapas_negocio.config_extra.sla_dias → sla_horas
--    Conversion: sla_horas = sla_dias * 24 (1 dia habil = 24h calendario
--    del dia habil, NO horario laboral)
-- 2) Nueva tabla festivos_colombia (fecha PK) + seed 2026 + 2027
-- 3) Funcion SQL horas_habiles_entre(start, end)
-- 4) Vista v_negocios_etapa_vencimiento actualizada para usar la funcion
-- ============================================================

-- ------------------------------------------------------------
-- 1. Tabla festivos_colombia
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.festivos_colombia (
  fecha DATE PRIMARY KEY,
  descripcion TEXT NOT NULL
);

COMMENT ON TABLE public.festivos_colombia IS
  'Festivos oficiales Colombia con Ley Emiliani aplicada (trasladados a lunes). Fuente: calendario oficial DIAN.';

-- Seed 2026 (idempotente con ON CONFLICT)
INSERT INTO public.festivos_colombia (fecha, descripcion) VALUES
  ('2026-01-01', 'Ano Nuevo'),
  ('2026-01-12', 'Dia de los Reyes Magos'),
  ('2026-03-23', 'Dia de San Jose'),
  ('2026-04-02', 'Jueves Santo'),
  ('2026-04-03', 'Viernes Santo'),
  ('2026-05-01', 'Dia del Trabajo'),
  ('2026-05-18', 'Ascension del Senor'),
  ('2026-06-08', 'Corpus Christi'),
  ('2026-06-15', 'Sagrado Corazon'),
  ('2026-06-29', 'San Pedro y San Pablo'),
  ('2026-07-20', 'Dia de la Independencia'),
  ('2026-08-07', 'Batalla de Boyaca'),
  ('2026-08-17', 'Asuncion de la Virgen'),
  ('2026-10-12', 'Dia de la Raza'),
  ('2026-11-02', 'Dia de Todos los Santos'),
  ('2026-11-16', 'Independencia de Cartagena'),
  ('2026-12-08', 'Dia de la Inmaculada Concepcion'),
  ('2026-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- Seed 2027
INSERT INTO public.festivos_colombia (fecha, descripcion) VALUES
  ('2027-01-01', 'Ano Nuevo'),
  ('2027-01-11', 'Dia de los Reyes Magos'),
  ('2027-03-22', 'Dia de San Jose'),
  ('2027-03-25', 'Jueves Santo'),
  ('2027-03-26', 'Viernes Santo'),
  ('2027-05-01', 'Dia del Trabajo'),
  ('2027-05-10', 'Ascension del Senor'),
  ('2027-05-31', 'Corpus Christi'),
  ('2027-06-07', 'Sagrado Corazon'),
  ('2027-07-05', 'San Pedro y San Pablo'),
  ('2027-07-20', 'Dia de la Independencia'),
  ('2027-08-07', 'Batalla de Boyaca'),
  ('2027-08-16', 'Asuncion de la Virgen'),
  ('2027-10-18', 'Dia de la Raza'),
  ('2027-11-01', 'Dia de Todos los Santos'),
  ('2027-11-15', 'Independencia de Cartagena'),
  ('2027-12-08', 'Dia de la Inmaculada Concepcion'),
  ('2027-12-25', 'Navidad')
ON CONFLICT (fecha) DO NOTHING;

-- RLS: tabla publica de lectura (es calendario, no contiene datos sensibles)
ALTER TABLE public.festivos_colombia ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "festivos_colombia_select_all" ON public.festivos_colombia;
CREATE POLICY "festivos_colombia_select_all"
  ON public.festivos_colombia
  FOR SELECT
  TO authenticated
  USING (true);

-- ------------------------------------------------------------
-- 2. Funcion horas_habiles_entre
-- Algoritmo: total horas calendario menos (24 * cantidad de dias
-- sab/dom/festivo en el rango [start, end)).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horas_habiles_entre(
  start_ts TIMESTAMPTZ,
  end_ts TIMESTAMPTZ
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_hours NUMERIC;
  non_business_days INTEGER;
BEGIN
  IF start_ts IS NULL OR end_ts IS NULL OR end_ts <= start_ts THEN
    RETURN 0;
  END IF;

  -- Total horas calendario
  total_hours := EXTRACT(EPOCH FROM (end_ts - start_ts)) / 3600.0;

  -- Contar dias sab/dom/festivo en el rango [start_date, end_date)
  -- Usamos date_trunc('day') para iterar fechas calendario.
  SELECT COUNT(*) INTO non_business_days
  FROM generate_series(
    date_trunc('day', start_ts)::date,
    (date_trunc('day', end_ts)::date) - INTERVAL '1 day',
    INTERVAL '1 day'
  ) AS d
  WHERE EXTRACT(ISODOW FROM d) IN (6, 7)
     OR d::date IN (SELECT fecha FROM public.festivos_colombia);

  RETURN GREATEST(total_hours - (non_business_days * 24), 0);
END;
$$;

COMMENT ON FUNCTION public.horas_habiles_entre(TIMESTAMPTZ, TIMESTAMPTZ) IS
  'Horas habiles entre dos timestamps. Un dia sabado/domingo/festivo cuenta 0h, un dia L-V no-festivo cuenta 24h. Usado para calcular SLA por etapa.';

-- ------------------------------------------------------------
-- 3. Backfill etapas_negocio.config_extra: sla_dias → sla_horas
-- ------------------------------------------------------------
UPDATE public.etapas_negocio
SET config_extra = (
  (config_extra - 'sla_dias')
  || jsonb_build_object('sla_horas', (config_extra->>'sla_dias')::INTEGER * 24)
)
WHERE config_extra ? 'sla_dias'
  AND config_extra->>'sla_dias' IS NOT NULL
  AND (config_extra->>'sla_dias') ~ '^[0-9]+$';

-- Si quedo alguna etapa con sla_dias null/invalido, removerlo
UPDATE public.etapas_negocio
SET config_extra = config_extra - 'sla_dias'
WHERE config_extra ? 'sla_dias';

-- ------------------------------------------------------------
-- 4. Vista v_negocios_etapa_vencimiento usando horas_habiles_entre
-- ------------------------------------------------------------
DROP VIEW IF EXISTS public.v_negocios_etapa_vencimiento;
CREATE VIEW public.v_negocios_etapa_vencimiento AS
SELECT
  n.workspace_id,
  en.linea_id,
  en.id AS etapa_id,
  en.nombre AS etapa_nombre,
  en.orden AS etapa_orden,
  COALESCE((en.config_extra->>'sla_horas')::INTEGER, NULL) AS sla_horas,
  COUNT(n.id) FILTER (WHERE n.estado = 'abierto') AS abiertos,
  COUNT(n.id) FILTER (
    WHERE n.estado = 'abierto'
      AND (en.config_extra->>'sla_horas') IS NOT NULL
      AND (en.config_extra->>'sla_horas')::INTEGER > 0
      AND public.horas_habiles_entre(n.etapa_cambiada_at, NOW())
          > (en.config_extra->>'sla_horas')::INTEGER
  ) AS vencidos
FROM public.etapas_negocio en
LEFT JOIN public.negocios n ON n.etapa_actual_id = en.id
GROUP BY n.workspace_id, en.linea_id, en.id, en.nombre, en.orden, en.config_extra;

COMMENT ON VIEW public.v_negocios_etapa_vencimiento IS
  'Conteo negocios abiertos y vencidos por etapa. Vencido = horas_habiles_entre(etapa_cambiada_at, now()) > sla_horas. Festivos Colombia L-V via festivos_colombia.';
