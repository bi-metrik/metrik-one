-- ============================================================
-- Migration: Seed fiscal_params with 2026 values
-- Spec: [98B] §7.6 — UVT $52,374 parametrizable
-- Date: 2026-03-04
-- ============================================================

-- Clear stale params and insert fresh 2026 values
DELETE FROM fiscal_params WHERE valid_from = '2026-01-01';

INSERT INTO fiscal_params (key, value, description, valid_from) VALUES
  ('uvt',                          52374,   'Unidad de Valor Tributario 2026 (Resolución 000238 dic 2025)',          '2026-01-01'),
  ('iva_general_pct',              19,      'IVA general Colombia',                                                  '2026-01-01'),
  ('iva_reducido_pct',             5,       'IVA reducido (5%) para ciertos servicios',                              '2026-01-01'),
  ('retefuente_honorarios_decl',   11,      'ReteFuente honorarios PN declarante (%)',                               '2026-01-01'),
  ('retefuente_honorarios_no_decl',10,      'ReteFuente honorarios PN no declarante (%)',                            '2026-01-01'),
  ('retefuente_servicios_pj',      4,       'ReteFuente servicios generales PJ (%)',                                 '2026-01-01'),
  ('retefuente_servicios_base_uvt',4,       'Base mínima ReteFuente servicios/honorarios (UVT)',                     '2026-01-01'),
  ('retefuente_compras_pct',       2.5,     'ReteFuente compras (%)',                                                '2026-01-01'),
  ('retefuente_compras_base_uvt',  27,      'Base mínima ReteFuente compras (UVT)',                                  '2026-01-01'),
  ('reteiva_sobre_iva_pct',        15,      'ReteIVA — 15% del IVA facturado',                                      '2026-01-01'),
  ('tope_no_responsable_iva_uvt',  3500,    'Tope para NO ser responsable de IVA (UVT)',                             '2026-01-01'),
  ('tope_rst_uvt',                 100000,  'Tope para Régimen Simple de Tributación (UVT)',                         '2026-01-01'),
  ('ss_base_pct',                  40,      'Seguridad social independientes — base sobre ingresos brutos (%)',      '2026-01-01'),
  ('ss_tarifa_pct',                28.5,    'Seguridad social independientes — tarifa sobre base (salud + pensión)', '2026-01-01'),
  ('ss_efectivo_pct',              11.4,    'Seguridad social independientes — tasa efectiva sobre facturación (%)', '2026-01-01');
