-- El responsable de un paso del cronograma puede ser una persona del equipo O un texto libre.
--
-- `responsable_id` (FK a staff) ya existía, pero la pantalla ofrecía usuarios (profiles.id)
-- contra una FK a staff.id: ningún guardado pudo pasar nunca, y por eso la columna está
-- vacía en toda la base (medido el 2026-09-14: 0 filas con responsable_id). Esta migración
-- no toca esa columna ni ninguna fila; solo agrega el texto libre para lo que no es del
-- equipo: un contratista, el cliente, «Compras».
--
-- Los dos a la vez no: si un paso tuviera persona y texto, el documento que se le manda al
-- cliente no sabría a quién nombrar. Las filas existentes cumplen el CHECK porque
-- responsable_texto nace nulo en todas.

alter table public.bloque_items
  add column if not exists responsable_texto text;

alter table public.bloque_items
  drop constraint if exists bloque_items_responsable_uno_solo;
alter table public.bloque_items
  add constraint bloque_items_responsable_uno_solo
  check (responsable_id is null or responsable_texto is null);

alter table public.bloque_items
  drop constraint if exists bloque_items_responsable_texto_largo;
alter table public.bloque_items
  add constraint bloque_items_responsable_texto_largo
  check (responsable_texto is null or char_length(responsable_texto) between 1 and 80);

comment on column public.bloque_items.responsable_texto is
  'Responsable que no es del equipo (contratista, cliente). Excluyente con responsable_id.';
