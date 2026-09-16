-- Convierte a referencia `one://<bucket>/<path>` las URLs publicas de Storage que ya
-- estaban guardadas. Es el Paso B del frente que cierra los dos buckets publicos que
-- quedaban: el Paso A (#748) dejo el codigo guardando y resolviendo por referencia, y el
-- Paso C pone `public = false`. En el medio el codigo acepta las DOS formas, asi que
-- convertir no rompe nada en transito.
--
-- ⚠️ YA CORRIO CONTRA PRODUCCION (2026-09-16, con autorizacion explicita) y quedo
-- registrada en `supabase_migrations.schema_migrations`. Este archivo existe para que el
-- repo refleje lo que la base ya hace; el `raise exception` de abajo se encarga de que no
-- se pueda volver a correr ni aplicar a ciegas contra otra base.
--
-- == Por que el reemplazo es sobre el TEXTO del jsonb y no clave por clave ==
--
-- Porque el nombre de la clave no lo pone el codigo: lo pone la configuracion del
-- workspace. Los campos de un bloque salen de `bloque_configs`, asi que cada cliente
-- bautiza el suyo. Medido antes de escribir esto: de las 439 filas, 408 guardaban la URL
-- en `pantallazo_certificacion`, una clave que NO existe en ninguna parte del codigo. Las
-- otras dos vistas fueron `drive_url` (22, nombre heredado que miente: guarda Storage, no
-- Drive) y `_backfill` (9, rastro que no lee nadie). Ir clave por clave habria dejado
-- huecos silenciosos en cualquier workspace que bautizara el campo distinto, y un hueco
-- aqui no se ve: la fila se queda con una URL publica que deja de abrir el dia del Paso C.
--
-- == Por que el patron corta en `?` ==
--
-- Porque `parsearReferenciaOne` RECHAZA cualquier path con `?` (guarda `rutaConEscape`, en
-- `src/lib/almacenamiento/referencia.ts` y su copia de Deno), y 344 de las 443 URLs traian
-- `?v=<epoch>`, el cachebuster del pantallazo. Sin ese corte, 344 documentos habrian
-- quedado con una referencia invalida —o sea inabribles— con el archivo intacto en
-- Storage. Lo atrapo el ensayo, no produccion. El cachebuster ya no hace falta:
-- `/api/archivos/abrir` responde `no-store` y firma distinto cada vez.
--
-- == Por que los conteos van como GUARDA y no como comentario ==
--
-- El 439 y el 11 se midieron contra la base que esta migracion iba a tocar. El
-- `raise exception` vuelve el archivo inservible contra cualquier otra base —y contra esta
-- una segunda vez—, que es justo lo que se le pide a una migracion de datos que reescribe
-- texto: o encuentra el mundo que midio, o no escribe nada. Un comentario con la cifra no
-- detiene a nadie; la guarda si. `restantes` y `malas` cierran las dos direcciones del
-- resultado: que no quede ninguna URL publica sin convertir, y que ninguna referencia
-- nueva tenga una forma que el parser vaya a rechazar despues.
--
-- == Lo que NO hizo falta ==
--
-- Decodificar nada. Medido sobre las 443 URLs: 0 con percent-encoding, 0 con `#`, 0 con
-- barra invertida, 0 con segmento vacio o `.`/`..`. Por eso el path viaja tal cual en `\2`.
--
-- == Estado verificado contra produccion DESPUES de aplicar ==
--
-- 439 bloques y 11 gastos convertidos, 0 URLs publicas restantes, 0 referencias
-- malformadas. De las 149 referencias distintas que quedaron, 146 apuntan a un objeto que
-- existe en `storage.objects`; las 3 que no, tienen la forma correcta
-- (`<workspace>/negocios/.../documento.pdf`), asi que eran enlaces ya muertos ANTES de
-- esta migracion y no un dano de ella.

do $$
declare
  patron constant text := 'https?://[^"]*/storage/v1/object/public/(ve-documentos|gastos-soportes)/([^"?\\]+)(\?[^"]*)?';
  b int; g int; restantes int; malas int;
begin
  update negocio_bloques
     set data = regexp_replace(data::text, patron, 'one://\1/\2', 'g')::jsonb
   where data::text like '%/object/public/ve-documentos/%'
      or data::text like '%/object/public/gastos-soportes/%';
  get diagnostics b = row_count;

  update gastos
     set soporte_url = regexp_replace(soporte_url, patron, 'one://\1/\2', 'g')
   where soporte_url like '%/object/public/gastos-soportes/%'
      or soporte_url like '%/object/public/ve-documentos/%';
  get diagnostics g = row_count;

  select count(*) into restantes from negocio_bloques
   where data::text like '%/object/public/ve-documentos/%' or data::text like '%/object/public/gastos-soportes/%';
  select count(*) into malas from negocio_bloques where data::text ~ 'one://[^"]*[?#\\]';

  if b <> 439 or g <> 11 or restantes <> 0 or malas <> 0 then
    raise exception 'ABORTADA: bloques=% (esperado 439) gastos=% (esperado 11) restantes=% invalidas=%', b, g, restantes, malas;
  end if;
end $$;
