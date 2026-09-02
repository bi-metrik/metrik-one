-- Una persona, un contacto: la comprobación de duplicados vive en la base.
--
-- Contexto (medido el 2026-09-02): un solo workspace tenía 46 números de celular
-- repetidos en contactos distintos, con negocios colgando de unos y no de otros.
-- De las cuatro puertas que crean un contacto, solo el webhook de Meta comprobaba
-- si esa persona ya estaba.
--
-- ⚠️ Por qué esto es una función de SQL y no un filtro desde la aplicación:
--
--   1. **El teléfono no se puede comparar como texto.** La columna guarda el
--      formato que llegó, y en producción conviven las dos formas: 647 contactos
--      con indicativo (12 dígitos) y 235 sin él (10). La comparación tiene que
--      normalizar a los últimos 10 dígitos, y eso no se expresa en un filtro de
--      PostgREST.
--   2. **Traer todos los contactos y comparar en memoria tiene techo.** PostgREST
--      corta en 1.000 filas por defecto y SOENA ya tiene 1.003 contactos: el
--      contacto 1.001 nunca se compararía y el duplicado entraría sin síntoma.
--      Es el mismo techo que acababa de perder casos en la cola de facturación.
--
-- Esta función NO impone la regla (no es un constraint): la responde. Hoy no se
-- puede crear un índice único porque los 46 duplicados que ya existen lo harían
-- fallar; hay que fusionarlos primero. Mientras tanto la regla la aplican las
-- puertas, todas contra esta misma respuesta.

-- Índice funcional para que la búsqueda por teléfono normalizado no recorra la
-- tabla. No es único a propósito: hoy hay duplicados y crearlo único fallaría.
create index if not exists idx_contactos_tel10
  on contactos (workspace_id, right(regexp_replace(coalesce(telefono, ''), '\D', '', 'g'), 10))
  where telefono is not null and telefono <> '';

create index if not exists idx_contactos_email_lower
  on contactos (workspace_id, lower(trim(email)))
  where email is not null and email <> '';

create or replace function buscar_contacto_duplicado(
  p_workspace_id uuid,
  p_telefono     text default null,
  p_email        text default null,
  p_excluir_id   uuid default null
)
returns table (id uuid, nombre text, telefono text, email text, motivo text)
language sql
stable
security invoker
set search_path = public
as $$
  with entrada as (
    select
      -- Últimos 10 dígitos = el número nacional colombiano. Menos de 10 dígitos
      -- se toma tal cual (un fijo corto), y sin dígitos queda nulo.
      nullif(
        case when length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) >= 10
             then right(regexp_replace(p_telefono, '\D', '', 'g'), 10)
             else regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')
        end, '') as tel,
      nullif(lower(trim(coalesce(p_email, ''))), '') as mail
  )
  select c.id, c.nombre, c.telefono, c.email,
         -- El teléfono manda cuando chocan los dos: es el dato con el que el
         -- equipo busca y por el que WhatsApp cruza las conversaciones.
         case when e.tel is not null
                   and coalesce(c.telefono, '') <> ''
                   and right(regexp_replace(c.telefono, '\D', '', 'g'), 10) = e.tel
              then 'telefono' else 'email' end as motivo
  from contactos c, entrada e
  where c.workspace_id = p_workspace_id
    and (p_excluir_id is null or c.id <> p_excluir_id)
    and (
      (e.tel  is not null and coalesce(c.telefono, '') <> ''
        and right(regexp_replace(c.telefono, '\D', '', 'g'), 10) = e.tel)
      or
      (e.mail is not null and lower(trim(coalesce(c.email, ''))) = e.mail)
    )
  -- El más antiguo primero: si hay varios, el bueno casi siempre es el que lleva
  -- más tiempo y tiene la historia colgada.
  order by c.created_at asc
  limit 1;
$$;

comment on function buscar_contacto_duplicado is
  'Devuelve el contacto del workspace cuyo telefono (ultimos 10 digitos) o email (minusculas) coincide con los datos dados, o ninguna fila. Fuente unica de la regla "una persona, un contacto" para las cuatro puertas de creacion.';

revoke all on function buscar_contacto_duplicado(uuid, text, text, uuid) from public;
grant execute on function buscar_contacto_duplicado(uuid, text, text, uuid) to authenticated, service_role;
