-- Cierra los dos buckets publicos que quedaban, `ve-documentos` y `gastos-soportes`. Es el
-- Paso C del frente de referencias: el Paso A (#748) dejo el codigo guardando y resolviendo
-- por `one://<bucket>/<path>`, y el Paso B (`20260916020000`, #755) convirtio a referencia
-- las 450 filas que todavia tenian una URL publica guardada (439 de `negocio_bloques` y 11
-- de `gastos`), dejando 0 sin convertir. Hasta aqui el colchon era que el codigo aceptaba
-- las DOS formas; este archivo lo retira, asi que el orden A -> B -> C no es negociable.
--
-- ⚠️ YA CORRIO CONTRA PRODUCCION (2026-09-16) y la fila del ledger ya esta puesta. Este
-- archivo existe para que el repo refleje lo que la base ya hace; el `raise exception`
-- impide que se vuelva a aplicar a ciegas (contra una base donde los buckets ya esten
-- cerrados, `n` da 0 y aborta).
--
-- ⚠️ `gastos-soportes` queda SIN NINGUNA policy de SELECT, y es a proposito: la suya se
-- borro en `20260418000000`, cuando el bucket era publico y no hacia falta. No se repone
-- porque ya nadie lee estos objetos con el cliente de sesion — todo se firma con el cliente
-- de SERVICIO desde `src/lib/almacenamiento/one.ts`, y quien puede pedir la firma lo decide
-- `abrir.ts` (sesion + workspace de la ruta + puerta del negocio), no las policies.
--
-- Revertir es un `update storage.buckets set public = true where id in (...)`, una linea.
-- Lo que NO se revierte solo es el Paso B: las referencias ya convertidas siguen siendo
-- referencias, y el codigo las resuelve igual con el bucket abierto o cerrado.

do $$
declare n int; abiertos int;
begin
  update storage.buckets set public = false
   where id in ('ve-documentos','gastos-soportes') and public = true;
  get diagnostics n = row_count;

  select count(*) into abiertos from storage.buckets
   where id in ('ve-documentos','gastos-soportes') and public = true;

  if n <> 2 or abiertos <> 0 then
    raise exception 'ABORTADA: cerrados=% (esperado 2) abiertos=% (esperado 0)', n, abiertos;
  end if;
end $$;
