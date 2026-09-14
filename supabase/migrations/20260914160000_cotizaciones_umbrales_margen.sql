-- Los umbrales de margen de la cotizacion, congelados al nacer.
--
-- La POLITICA vive en `lineas_negocio.config_extra -> 'margen'`, junto a
-- `convencion` y `default_pct` (ver `src/lib/cotizaciones/convencion-margen.ts`).
-- Estas dos columnas son la COPIA que la cotizacion se lleva al crearse, por la
-- misma razon que `convencion_margen`: si el color —y manana el rechazo— se
-- resolviera leyendo la linea en cada render, subir el piso le cambiaria el
-- veredicto a cotizaciones ya enviadas a clientes.
--
-- NULL significa "esta cotizacion no congelo nada": se cae a la politica vigente
-- de su linea. Es lo que traen las 18 cotizaciones que existen hoy, y se deja
-- asi a proposito — congelarlas hacia atras obligaria a inventar que umbral
-- regia el dia en que se crearon, y nadie lo sabe.
--
-- Hoy ninguno de los dos BLOQUEA nada: solo deciden de que color sale un numero
-- en el editor. El rechazo en servidor por debajo del piso llega con los
-- itinerarios (paso 2 del motor de cotizacion de Trappvel).
--
-- DDL puro: dos columnas anulables sin default. No toca una sola fila de datos.

alter table public.cotizaciones
  add column if not exists piso_margen_pct numeric,
  add column if not exists aviso_margen_pct numeric;

comment on column public.cotizaciones.piso_margen_pct is
  'Margen real (%) bajo el cual esta cotizacion se marca en rojo. Copiado de lineas_negocio.config_extra->margen->piso_pct al crearla; NO se resincroniza. NULL = usar la politica vigente de la linea.';

comment on column public.cotizaciones.aviso_margen_pct is
  'Margen real (%) bajo el cual esta cotizacion se marca en ambar. Copiado de lineas_negocio.config_extra->margen->aviso_pct al crearla; NO se resincroniza. NULL = usar la politica vigente de la linea.';
