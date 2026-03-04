-- ============================================================
-- Migration: Create ref_tarifas_ica table + seed principales ciudades
-- Spec: [98B] §2.11, D79
-- Date: 2026-03-04
-- ============================================================

CREATE TABLE IF NOT EXISTS ref_tarifas_ica (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  municipio TEXT NOT NULL,
  ciiu_desde TEXT NOT NULL DEFAULT '0000',
  ciiu_hasta TEXT NOT NULL DEFAULT '9999',
  tarifa_por_mil NUMERIC(6,2) NOT NULL,
  vigencia_desde DATE NOT NULL DEFAULT '2026-01-01',
  vigencia_hasta DATE,
  fuente TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ref_tarifas_ica_municipio ON ref_tarifas_ica(municipio);

COMMENT ON TABLE ref_tarifas_ica IS 'Tarifas ICA de referencia por municipio y rango CIIU. Spec [98B] §2.11';
COMMENT ON COLUMN ref_tarifas_ica.tarifa_por_mil IS 'Tarifa ICA en por mil (‰). Ej: 9.66 para consultoría en Bogotá.';

-- Seed: Principales ciudades Colombia — tarifa consultoría/servicios profesionales
-- Fuente: Acuerdos municipales vigentes 2026
INSERT INTO ref_tarifas_ica (municipio, ciiu_desde, ciiu_hasta, tarifa_por_mil, vigencia_desde, fuente) VALUES
  ('Bogotá',        '6200', '6399', 9.66,  '2026-01-01', 'Acuerdo 780 de 2020 - Bogotá'),
  ('Bogotá',        '7000', '7499', 9.66,  '2026-01-01', 'Acuerdo 780 de 2020 - Bogotá'),
  ('Bogotá',        '0000', '9999', 9.66,  '2026-01-01', 'Acuerdo 780 de 2020 - Bogotá (general consultoría)'),
  ('Medellín',      '0000', '9999', 9.66,  '2026-01-01', 'Acuerdo 066 de 2017 - Medellín'),
  ('Cali',          '0000', '9999', 10.00, '2026-01-01', 'Acuerdo 0448 de 2019 - Cali'),
  ('Barranquilla',  '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 030 de 2014 - Barranquilla'),
  ('Cartagena',     '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 041 de 2006 - Cartagena'),
  ('Bucaramanga',   '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 044 de 2008 - Bucaramanga'),
  ('Pereira',       '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 029 de 2015 - Pereira'),
  ('Manizales',     '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 0960 de 2019 - Manizales'),
  ('Ibagué',        '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 017 de 2016 - Ibagué'),
  ('Villavicencio', '0000', '9999', 7.00,  '2026-01-01', 'Acuerdo 030 de 2014 - Villavicencio');
