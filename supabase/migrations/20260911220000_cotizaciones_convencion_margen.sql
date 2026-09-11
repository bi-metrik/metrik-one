-- ============================================================================
-- Que significa el numero que alguien escribe en el campo "margen"
--
-- ONE siempre calculo `precio = costo x (1 + m/100)`: un RECARGO sobre el costo.
-- Una agencia de viajes cotiza con divisores, `costo / 0,85`, y cuando escribe 15
-- quiere decir el margen que le queda DENTRO del precio. No es el mismo numero:
-- con un costo de 1.000.000 y un 15 en el campo, la primera formula vende a
-- 1.150.000 (margen real 13,04%) y la segunda a 1.176.471 (margen real 15,00%).
--
-- Casi dos puntos de margen por cotizacion, sin que nada en pantalla lo delate,
-- porque el campo dice 15 en los dos casos.
--
-- Esta migracion hace explicita la convencion en lugar de suponerla.
--
-- ── Por que en `cotizaciones` y no solo en la linea ─────────────────────────
-- La convencion se COPIA a la cotizacion cuando nace, y ahi se queda. Si viviera
-- solo en la linea, reconfigurar la linea le moveria el precio a cotizaciones ya
-- enviadas a clientes en el siguiente recalculo. Una cotizacion emitida no puede
-- cambiar de precio porque alguien toco un parametro despues.
--
-- ── Compatibilidad ──────────────────────────────────────────────────────────
-- NULL significa `markup`, que es como se calculo todo lo anterior. Ninguna
-- cotizacion existente cambia de precio con esta migracion: no se escribe ni una
-- sola fila de datos.
-- ============================================================================

alter table cotizaciones
  add column if not exists convencion_margen text;

alter table cotizaciones
  drop constraint if exists cotizaciones_convencion_margen_check;

alter table cotizaciones
  add constraint cotizaciones_convencion_margen_check
  check (convencion_margen is null or convencion_margen in ('markup', 'sobre_venta'));

comment on column cotizaciones.convencion_margen is
  'Que significa items.margen_porcentaje en esta cotizacion. '
  '"markup": precio = costo x (1 + m/100), recargo sobre el costo. '
  '"sobre_venta": precio = costo / (1 - m/100), margen real dentro del precio. '
  'NULL vale markup, que es como se calculo todo lo anterior a esta columna. '
  'Se copia de lineas_negocio.config_extra->margen->>convencion al crear la '
  'cotizacion y NO se sincroniza despues: una cotizacion emitida no cambia de '
  'precio porque se reconfigure la linea.';

-- ── El margen con el que nace cada item ─────────────────────────────────────
-- Se copia igual que la convencion, y por la misma razon: es el valor con el que
-- nacen los items de ESTA cotizacion. NULL vale 0, que es como nacian antes.

alter table cotizaciones
  add column if not exists margen_default_pct numeric;

alter table cotizaciones
  drop constraint if exists cotizaciones_margen_default_pct_check;

alter table cotizaciones
  add constraint cotizaciones_margen_default_pct_check
  check (margen_default_pct is null or (margen_default_pct >= 0 and margen_default_pct < 100));

comment on column cotizaciones.margen_default_pct is
  'Margen con el que nace cada item nuevo de esta cotizacion, en la convencion '
  'declarada en convencion_margen. Editable item por item despues: el default '
  'ahorra tecleo, no impone el precio. NULL vale 0, como nacian antes. '
  'Se copia de lineas_negocio.config_extra->margen->>default_pct al crear.';

-- ── La linea de negocio declara la convencion y el margen por defecto ────────
-- Vive en el jsonb que ya existe, sin columnas nuevas:
--
--   config_extra -> 'margen' = {"convencion": "sobre_venta", "default_pct": 15}
--
-- `default_pct` es el valor con el que nace cada item nuevo. Editable item por
-- item: el default ahorra tecleo, no impone el precio.
--
-- No se toca ninguna linea existente aqui. Las que no declaren nada siguen en
-- markup con default 0, que es el comportamiento de hoy.
