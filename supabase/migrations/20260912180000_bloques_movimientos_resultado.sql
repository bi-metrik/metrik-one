-- ============================================================
-- Dos bloques de plata en vez de tres.
--
-- Cobros, Ejecución y Resumen financiero respondían la misma pregunta desde tres
-- tarjetas distintas. El corte que queda es movimiento contra resultado:
--
--   · Movimientos  → qué entró y qué salió, con el detalle abrible.
--   · Resultado    → cuánto deja el negocio, contra presupuesto y contra precio.
--
-- Los tres bloques viejos siguen existiendo y ningún workspace los pierde: esta
-- migración solo AGREGA el catálogo. Quién usa cuál se decide por workspace, en la
-- configuración de sus etapas.
-- ============================================================

insert into bloque_definitions (codigo, tipo, nombre, descripcion, is_visualization, can_be_gate, supports_array_items, default_estado, icon_name)
values
  ('B30', 'movimientos', 'Movimientos',
   'Entradas y salidas del negocio en una sola vista: cobros recibidos y esperados, gastos por categoria con detalle y horas del equipo',
   false, false, false, 'editable', 'ArrowLeftRight'),
  ('B31', 'resultado', 'Resultado',
   'Utilidad y margen del negocio medidos contra el precio aprobado, con el presupuesto ejecutado por rubro. La caja va aparte',
   true, false, false, 'visible', 'BarChart3')
on conflict do nothing;
