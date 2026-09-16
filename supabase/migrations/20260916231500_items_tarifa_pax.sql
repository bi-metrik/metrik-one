-- Tarifa por tipo de pasajero en la línea de cotización.
--
-- Diseño: proyectos/trappvel/clarity/docs/diseno/tarifa-por-pasajero.md (§4, §6, CC5).
--
-- Una columna jsonb en `items`, NULL por defecto. Guarda, por línea:
--   · `composicion`: cuántos adultos, niños e infantes cubre la línea cuando no es la del
--     viaje (CC4b: un tour que no toman todos, un proveedor que clasifica distinto a un menor).
--   · `casillas`: lo LEÍDO de cada pantallazo (grupo completo, sin infantes, solo adultos),
--     que es de donde sale cada número (CC5). La imagen NO se guarda.
--   · `confirmada`: el costo por pasajero ya confirmado, en pesos. Lo lee el PDF.
--
-- Por qué jsonb y no tres columnas de conteos más una tabla de lecturas: las casillas son
-- un estado de trabajo de UNA línea, que se reemplaza entero al volver a pegar, y lo que el
-- resto del sistema necesita (el costo) sigue viviendo en `rubros`. Nadie filtra ni agrega
-- por estos campos.
--
-- Compatibilidad: NULL = la línea se comporta exactamente como hoy. Ninguna fila existente
-- se toca. `items` ya tiene RLS y sus grants; una columna nueva los hereda.

alter table public.items
  add column if not exists tarifa_pax jsonb;

comment on column public.items.tarifa_pax is
  'Tarifa por tipo de pasajero: composicion propia de la linea, lecturas de pantallazo por casilla y costo por pasajero confirmado. NULL = sin tarifa por pasajero.';
