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

-- `bloque_definitions.tipo` tiene un CHECK con la lista cerrada de tipos. Un bloque
-- nuevo no existe hasta que su tipo entra ahí: el insert de abajo rebota con 23514.
alter table bloque_definitions drop constraint if exists bloque_definitions_tipo_check;
alter table bloque_definitions add constraint bloque_definitions_tipo_check check (
  tipo = any (array[
    'datos', 'documentos', 'documento', 'cotizacion', 'cobros', 'checklist',
    'checklist_soporte', 'equipo', 'aprobacion', 'cronograma', 'resumen_financiero',
    'ejecucion', 'historial', 'formulario', 'plan_recurrente', 'historial_valida',
    'propuesta_economica', 'guia_devolucion', 'facturacion', 'contacto',
    'movimientos', 'resultado'
  ])
);

insert into bloque_definitions (codigo, tipo, nombre, descripcion, is_visualization, can_be_gate, supports_array_items, default_estado, icon_name)
values
  ('B30', 'movimientos', 'Movimientos',
   'Entradas y salidas del negocio en una sola vista: cobros recibidos y esperados, gastos por categoria con detalle y horas del equipo',
   false, false, false, 'editable', 'ArrowLeftRight'),
  ('B31', 'resultado', 'Resultado',
   'Utilidad y margen del negocio medidos contra el precio aprobado, con el presupuesto ejecutado por rubro. La caja va aparte',
   true, false, false, 'visible', 'BarChart3')
on conflict do nothing;
