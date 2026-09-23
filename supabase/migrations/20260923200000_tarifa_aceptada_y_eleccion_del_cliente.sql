-- La Recomendada manda el documento y el cliente escoge su tarifa al aprobar
-- (decisión de Mauricio, 2026-09-22; brief
-- `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-recomendada-y-tarifa-elegida.md`).
--
-- ⚠️ VA ANTES DEL MERGE. El código que la usa:
--   · `aceptarCotizacionNegocio` escribe `cotizaciones.tarifa_aceptada_id` en el MISMO
--     update que el estado, SOLO cuando la cotización tiene tarifas. Sin la columna, esa
--     aprobación falla con 42703 y no aprueba a medias. Una cotización sin tarifas (todo
--     lo que no es Trappvel) no la nombra y no cambia.
--   · `registrarEleccionDelCliente` inserta en `decisiones_combinacion` con `evento`,
--     `recomendada_*` y `tarifas_ofrecidas`. Sin las columnas el insert falla, se anota en
--     la consola y la aprobación sigue (nunca bloquea).
--   · Las lecturas usan `select('*')`: sin la columna llega `undefined` = «nadie eligió».
--
-- Solo DDL aditivo: dos grupos de columnas nuevas, anulables o con default, y un CHECK
-- sobre una columna que nace con el valor que el CHECK admite. No toca una fila existente
-- (al 2026-09-23 `cotizacion_itinerarios` y `decisiones_combinacion` tienen 0 filas en
-- producción).

-- ── 1 · Cuál tarifa escogió el cliente ─────────────────────────────────────────
--
-- Un CAMPO y no un texto: el brief lo pide explícito. Vive en la cotización porque la
-- tarifa es de la cotización, y de ahí sale `negocios.precio_aprobado`.
--
-- `on delete set null`: borrar la tarifa no se lleva la cotización aprobada; se pierde el
-- puntero, no el precio (que ya está en el negocio) ni el hecho (que está copiado en
-- `decisiones_combinacion`).
alter table public.cotizaciones
  add column if not exists tarifa_aceptada_id uuid
    references public.cotizacion_itinerarios(id) on delete set null;

comment on column public.cotizaciones.tarifa_aceptada_id is
  'La tarifa (cotizacion_itinerarios) que el cliente escogio al aprobar. De ella sale negocios.precio_aprobado, aunque no sea la Recomendada: la Recomendada solo manda el TOTAL del documento. NULL = cotizacion sin tarifas, o todavia sin aprobar. Se CONSERVA al corregir una aprobacion (la correccion arregla un item, no cambia lo que el cliente tomo): la siguiente aprobacion vuelve a preguntar y la ofrece marcada.';

-- La llave foránea sin índice obliga a recorrer `cotizaciones` entera cada vez que se
-- borra una tarifa. Parcial: casi todas las filas la tienen en NULL.
create index if not exists idx_cotizaciones_tarifa_aceptada
  on public.cotizaciones (tarifa_aceptada_id)
  where tarifa_aceptada_id is not null;

-- ── 2 · La elección, como dato para el motor ───────────────────────────────────
--
-- `decisiones_combinacion` registraba solo la SALIDA (qué se le ofreció al cliente, una
-- fila por tarifa). La ACEPTACIÓN (qué tomó) es el otro lado del mismo dato y tiene la
-- misma forma —una tarifa con su combinación, sus descartadas, el viaje y quién—, así
-- que va en la misma tabla y se une con la salida por `cotizacion_id`. Lo que las
-- distingue es `evento`, y lo que solo la aceptación lleva: contra cuál se escogió (la
-- Recomendada) y qué más tenía delante.
--
-- ⚠️ `propuesta` sigue siendo la del MOTOR y sigue nula (§3.2.1 R1). La Recomendada no es
-- «la propuesta»: es lo que la agencia le recomendó al cliente, y va en sus columnas.
alter table public.decisiones_combinacion
  add column if not exists evento text not null default 'salida',
  add column if not exists recomendada_itinerario_id uuid
    references public.cotizacion_itinerarios(id) on delete set null,
  add column if not exists recomendada_nombre text,
  add column if not exists precio_recomendada numeric,
  add column if not exists tarifas_ofrecidas jsonb;

alter table public.decisiones_combinacion
  drop constraint if exists decisiones_combinacion_evento_check;
alter table public.decisiones_combinacion
  add constraint decisiones_combinacion_evento_check
  check (evento in ('salida', 'aceptacion'));

comment on column public.decisiones_combinacion.evento is
  'salida = la cotizacion salio al cliente (una fila por tarifa marcada, al generar el PDF). aceptacion = el cliente escogio una tarifa al aprobar (una fila: la escogida, con su combinacion). Las filas anteriores a 2026-09-23 son todas salida.';
comment on column public.decisiones_combinacion.recomendada_itinerario_id is
  'Solo en aceptacion: la tarifa Recomendada de la cotizacion, contra la que el cliente escogio. Igual a itinerario_id cuando el cliente tomo la Recomendada.';
comment on column public.decisiones_combinacion.recomendada_nombre is
  'Solo en aceptacion: como se llamaba la Recomendada, copiado.';
comment on column public.decisiones_combinacion.precio_recomendada is
  'Solo en aceptacion: precio SIN IVA de la Recomendada en ese momento, la misma unidad que precio_elegida.';
comment on column public.decisiones_combinacion.tarifas_ofrecidas is
  'Solo en aceptacion: las tarifas que iban en la propuesta, [{ itinerario_id, nombre, precio }], precio sin IVA y copiado. Es contra que escogio el cliente; descartadas sigue siendo las VARIANTES de la tarifa escogida, con la misma forma que en la salida.';
comment on column public.decisiones_combinacion.salida_at is
  'Cuando ocurrio el evento: en salida, la generacion del documento; en aceptacion, la aprobacion.';

-- ── 3 · `es_principal` deja de decidir ─────────────────────────────────────────
comment on column public.cotizacion_itinerarios.es_principal is
  'INFORMATIVA desde 2026-09-23: la tarifa que manda valor_total y el TOTAL del documento la decide el codigo, no esta columna. Es la llamada «Recomendada» que va en la propuesta (idDelPrincipal en src/lib/cotizaciones/tarifas.ts). Ya no se marca a mano.';
