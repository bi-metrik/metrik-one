-- La propuesta del pantallazo, persistida (R-P1 del motor de cotizacion de Trappvel,
-- `proyectos/trappvel/clarity/docs/diseno/motor-cotizacion.md` seccion 3).
--
-- ANTES: lo que el modelo leia de la captura vivia solo en la pantalla y se escribia
-- unicamente al confirmar. Recargar la pagina descartaba la propuesta y habia que
-- volver a pegar la captura.
--
-- ⚠️⚠️ ESTA COLUMNA NO SE PUEDE APLICAR SOLA.
--
-- Un rubro con `sugerido = true` lo suma `calcularCascada` como cualquier otro:
-- quedaria dentro del costo sin que nadie lo haya confirmado, que es exactamente lo
-- que R-P1 prohibe. La columna y el filtro van en el MISMO movimiento. El filtro vive
-- en `src/lib/cotizaciones/rubros-sugeridos.ts` y lo aplican los cinco que leen
-- rubros: `recalcularTotales`, `contextoDeCotizacion` (y con el toda la cascada y los
-- itinerarios), el editor, el PDF (a traves de `cotizaciones.valor_total`) y el
-- presupuesto de Ejecucion.
--
-- ORDEN DE APLICACION: esta migracion va ANTES del merge, no despues.
--   · Aplicada primero: la columna nace con `false` en las 61 filas existentes, nadie
--     la escribe todavia y ninguna lectura cambia. Cero riesgo.
--   · Aplicada despues: el codigo nuevo ya estaria leyendo `rubros` esperando la
--     columna, y aunque todas las consultas usan `rubros(*)` a proposito para no
--     depender de ella, el insert del pantallazo si la nombra y fallaria.
--
-- `sugerido` ausente cuenta como CONFIRMADO en el codigo (`esConfirmado`), a proposito:
-- es lo que llega de cualquier consulta que no pida la columna, y tratarlo como
-- sugerido dejaria el costo de toda cotizacion en CERO — un fallo mudo del peor tipo,
-- porque un margen del 100% se ve como una buena noticia.

alter table public.rubros
  add column if not exists sugerido boolean not null default false;

comment on column public.rubros.sugerido is
  'Rubro propuesto por la lectura de un pantallazo y todavia sin confirmar por una persona. NO entra al costo hasta que sea false. El filtro unico vive en src/lib/cotizaciones/rubros-sugeridos.ts.';

-- Indice PARCIAL: las filas sugeridas son una minoria efimera (se confirman o se
-- descartan), y las consultas que las tocan siempre filtran por item.
create index if not exists idx_rubros_sugerido
  on public.rubros (item_id)
  where sugerido;

-- `rubros` no cambia de politicas ni de grants: ya existia y los tiene. Esta migracion
-- solo agrega una columna y un indice.
