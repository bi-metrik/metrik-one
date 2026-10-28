-- «Paquete de bloqueo» como sexto tipo de ranura de la cotización de viaje (Trappvel, brief del
-- 2026-10-27 `proyectos/trappvel/clarity/briefs/2026-10-27_brief-max-bloqueo.md`).
--
-- Un viaje en BLOQUEO se cotiza por paquetes: cada opción es UN paquete del operador (hotel + vuelo
-- en fechas cerradas, un valor por persona). Las opciones son hermanas en una ranura, como las de
-- siempre, y compiten por entrar en cada tarifa.
--
-- ADITIVA: solo amplía el CHECK de `cotizacion_ranuras.tipo` con 'paquete'. No toca ninguna fila:
-- las cinco palabras de antes siguen valiendo, y ninguna fila existente puede tener 'paquete' (el
-- CHECK de hoy lo impide). Mismo patrón que `20261013140000_cotizacion_ranuras_tipo_otro.sql`.
--
-- Quién escribe 'paquete': solo «+ Paquete» de la cotización por pasos de un viaje en bloqueo, detrás
-- de `config_extra.cotizacion_por_pasos` (el servidor lo exige). Sin esta migración, crear la ranura
-- falla con 23514 y el código sigue sin ranura: la línea queda con su `items.grupo`, que es lo que
-- decide el total, como cuando la tabla no existía.

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
  check (tipo in ('vuelo', 'hotel', 'actividad', 'traslado', 'otro', 'paquete'));

comment on column public.cotizacion_ranuras.tipo is
  'El tipo del catalogo (ranuras-pantallazo.ts, el primer sinonimo de cada uno): vuelo, hotel, actividad, traslado, otro («Otro servicio») o paquete («Paquete de bloqueo»: hotel + vuelo de un operador, un valor por persona). Otro y paquete solo los escribe la cotizacion por pasos.';
