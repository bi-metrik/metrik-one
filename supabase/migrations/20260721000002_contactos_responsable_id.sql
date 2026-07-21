-- ============================================================
-- contactos.responsable_id — responsable comercial a nivel de contacto
-- ------------------------------------------------------------
-- Un contacto puede tener un responsable (staff) fijo. Al convertir una
-- interacción del contacto en negocio, el negocio hereda este responsable
-- (crearNegocioDesdeInteraccion): el responsable del contacto tiene prioridad
-- sobre el staff del usuario que convierte. Así, un lead que llega sin dueño
-- puede asignarse una vez a nivel de contacto y todos sus negocios lo heredan.
--
-- FK a staff(id) (misma referencia que negocios.responsable_id). ON DELETE SET
-- NULL: si el staff se elimina, el contacto queda sin responsable, no se borra.
--
-- La tabla contactos ya tiene RLS + policy por workspace + grant a authenticated
-- (es una tabla existente); esta migración solo agrega una columna, no requiere
-- re-declarar RLS/policy/grant.
-- ============================================================

alter table public.contactos
  add column if not exists responsable_id uuid references public.staff(id) on delete set null;

-- Índice para filtrar contactos por responsable dentro del workspace.
create index if not exists idx_contactos_ws_responsable
  on public.contactos (workspace_id, responsable_id);

-- ============================================================
-- ROLLBACK (correr manualmente si hay que revertir):
--
-- drop index if exists public.idx_contactos_ws_responsable;
-- alter table public.contactos drop column if exists responsable_id;
-- ============================================================
