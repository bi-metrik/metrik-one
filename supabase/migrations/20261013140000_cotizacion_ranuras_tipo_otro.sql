-- «Otro servicio» como quinto tipo de ranura de la cotización de viaje (asistencia médica,
-- seguro de viaje, tarjeta de turismo, equipaje adicional). Diseño de Noor, Paso 1,
-- «Escribirlo a mano», y §11; brief C1–C6 del 2026-10-12. Autorizada por Mauricio el
-- 2026-10-13.
--
-- ADITIVA: solo amplía el CHECK de `cotizacion_ranuras.tipo` con 'otro'. No toca ninguna
-- fila: las cuatro palabras de antes siguen valiendo, y ninguna fila existente puede tener
-- 'otro' (el CHECK de hoy lo impide). El tipo se escribe como en el resto del código
-- (`TIPOS_RANURA`, `TIPOS_SERVICIO`, la vista por pasos): 'otro'.
--
-- Quién escribe 'otro': solo «✎ Escríbelo a mano» de la cotización por pasos y el «Es otro
-- servicio» de la bandeja por pasos, las dos detrás de `config_extra.cotizacion_por_pasos`.
-- Con el interruptor apagado el servidor las rechaza sin escribir (N5). Sin esta migración,
-- crear la ranura 'otro' falla con 23514 y el código sigue sin ranura (la línea queda con su
-- `items.grupo`, que es lo que decide el total), como cuando la tabla no existía.
--
-- El CHECK nació sin nombre propio en `20260923233000_cotizacion_ranuras_y_captura.sql`
-- (Postgres lo llama `cotizacion_ranuras_tipo_check`). Se busca por su definición en vez de
-- suponer el nombre, y el nuevo queda con nombre explícito.

do $$
declare
  restriccion record;
begin
  for restriccion in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.cotizacion_ranuras'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%tipo%'
      and pg_get_constraintdef(c.oid) ilike '%traslado%'
  loop
    execute format('alter table public.cotizacion_ranuras drop constraint %I', restriccion.conname);
  end loop;
end;
$$;

alter table public.cotizacion_ranuras
  add constraint cotizacion_ranuras_tipo_check
  check (tipo in ('vuelo', 'hotel', 'actividad', 'traslado', 'otro'));

comment on column public.cotizacion_ranuras.tipo is
  'El tipo del catalogo (ranuras-pantallazo.ts, el primer sinonimo de cada uno): vuelo, hotel, actividad, traslado u otro («Otro servicio»: asistencia medica, seguro, tarjeta de turismo, equipaje). Otro solo lo escribe la cotizacion por pasos.';
