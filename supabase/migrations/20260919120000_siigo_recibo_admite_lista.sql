-- `cobros.siigo_recibo` pasa a admitir DOS formas, y el comentario lo tiene que decir.
--
-- QUE CAMBIA: nada en la estructura. La columna ya es `jsonb` y sigue siendolo. Lo que
-- cambia es que desde el recibo por concepto (2026-09-19) puede guardar un ARREGLO de
-- marcas, una por componente, ademas del objeto unico de siempre.
--
-- POR QUE ES UNA MIGRACION Y NO UN COMENTARIO EN EL CODIGO: hay un consumidor en SQL.
-- `mis_cobros_de_servicio` (modulo Valida API, `20260916180000`) lee la marca con
-- `c.siigo_recibo ->> 'numero'`, y ese operador sobre un arreglo devuelve **NULL sin dar
-- error**. Quien escriba el proximo consumidor en SQL tiene que encontrarse la
-- advertencia donde va a mirar, que es el catalogo, no un archivo de TypeScript.
--
-- POR QUE ESE CONSUMIDOR NO SE ROMPE HOY: una linea que no declara
-- `config_extra.siigo.recibo_por_concepto` sigue escribiendo el OBJETO, byte por byte
-- como antes. Ninguna linea de la base lo declara (medido el 2026-09-19), y la de
-- `valida` no va a declararlo: sus recibos se cargan a mano y son uno solo.
--
-- NO TOCA UN SOLO DATO: es un `comment on`. Las 17 marcas existentes (16 en `soena`,
-- 1 en `metrik`, contadas el 2026-09-19) se quedan exactamente como estan.

comment on column public.cobros.siigo_recibo is
  'Marca del recibo de caja del cobro. DOS formas: objeto unico (acusa el TOTAL del pago, '
  'es la forma historica y la que sigue escribiendo toda linea sin recibo_por_concepto) o '
  'ARREGLO de marcas, una por componente (honorario / pasante), cuando la linea declara '
  'config_extra.siigo.recibo_por_concepto. '
  'ADVERTENCIA para consumidores en SQL: siigo_recibo ->> ''numero'' devuelve NULL sobre el '
  'arreglo, sin error. Para cubrir las dos formas hay que normalizar antes de leer, con '
  'case jsonb_typeof(siigo_recibo) when ''array'' then siigo_recibo else '
  'jsonb_build_array(siigo_recibo) end, y recorrer con jsonb_array_elements. '
  'En TypeScript el criterio unico es recibosDelCobro() de '
  'src/lib/siigo/recibo-componentes.ts. '
  'Reemplaza a negocios.metadata.siigo_recibo, que solo admitia uno por negocio.';
