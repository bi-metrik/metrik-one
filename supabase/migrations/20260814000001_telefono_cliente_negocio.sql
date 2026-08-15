-- Teléfono del CLIENTE de un negocio, normalizado a E.164, con una sola definición
-- para todo el sistema. Hermana de `email_cliente_negocio` (20260813000002) y por la
-- misma razón: sus consumidores viven en runtimes distintos (la edge function corre en
-- Deno y no puede importar de `src/`), y dos copias de esta regla se desincronizarían
-- sin que nadie lo note.
--
-- Precedencia idéntica a la del correo: `contactos.telefono` primero (el dato que el
-- equipo captura y mantiene) y el teléfono del RUT como respaldo.
--
-- ⚠️ El teléfono es TEXTO LIBRE y llega sucio. Medido contra producción el 2026-08-14
-- sobre los 254 negocios abiertos de SOENA: 15 formas distintas conviviendo.
--   · `300 1234567` (93) · `+573001234567` (39) · `3001234567` (19)
--   · `(300) 1234567` (13) · `(300)123-4567` (6)
--   · `3001234567.0` (4)  ← el cargue leyó la celda de Excel como NÚMERO
--   · `+57 +57 300 1234567` (1) ← indicativo duplicado
--   · `@juandavidmoreno`, `@MariAleSantanaV`, `@davidp_99` (3) ← son Instagram, no teléfonos
--
-- De ahí los tres pasos, en este orden y no en otro:
--   1. Cortar en el punto ANTES de quitar los no-dígitos. Al revés, `3001234567.0` se
--      convierte en `30012345670`: once dígitos, un número que no existe.
--   2. Quitar todo lo que no sea dígito.
--   3. Colapsar los `57` iniciales repetidos, para el indicativo duplicado.
--
-- Y solo entonces se exige un móvil colombiano (`3` + 9 dígitos). Un fijo no recibe
-- WhatsApp y un handle de Instagram no es un número: los dos se descartan devolviendo
-- NULL. Quien llame decide qué hacer con eso; lo que no puede es inventarse un
-- destinatario, ni mandarle un aviso del trámite a un desconocido.
--
-- Cobertura resultante en SOENA: 242 de 254 abiertos (95%), contra 170 (67%) por
-- correo. El respaldo del RUT solo salva 1 caso, pero se conserva por simetría con el
-- correo y porque no cuesta nada.

create or replace function public.telefono_cliente_negocio(p_negocio_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with crudo as (
    select
      (select nullif(trim(c.telefono), '')
         from contactos c
        where c.id = n.contacto_id) as del_contacto,
      -- Un negocio puede traer varias filas del bloque (las copias readonly heredadas
      -- viajan con él entre etapas): se toma el primero no vacío, sin depender del
      -- orden en que lleguen.
      (select nullif(trim(nb.data -> 'campos' -> 'telefono' ->> 'value'), '')
         from negocio_bloques nb
         join bloque_configs bc on bc.id = nb.bloque_config_id
        where nb.negocio_id = n.id
          and bc.slug in ('rut', 'rut_solicitante_2')
          and nullif(trim(nb.data -> 'campos' -> 'telefono' ->> 'value'), '') is not null
        limit 1) as del_rut
    from negocios n
    where n.id = p_negocio_id
  ),
  normalizado as (
    select
      nullif(regexp_replace(
        regexp_replace(split_part(del_contacto, '.', 1), '[^0-9]', '', 'g'),
        '^(57)+', ''), '') as contacto,
      nullif(regexp_replace(
        regexp_replace(split_part(del_rut, '.', 1), '[^0-9]', '', 'g'),
        '^(57)+', ''), '') as rut
    from crudo
  )
  select '+57' || coalesce(
    (select contacto from normalizado where contacto ~ '^3[0-9]{9}$'),
    (select rut      from normalizado where rut      ~ '^3[0-9]{9}$')
  )
  from normalizado
  where contacto ~ '^3[0-9]{9}$' or rut ~ '^3[0-9]{9}$';
$function$;

revoke execute on function public.telefono_cliente_negocio(uuid) from public, anon, authenticated;

comment on function public.telefono_cliente_negocio(uuid) is
  'Telefono movil del cliente de un negocio en E.164 (+57...): contactos.telefono y, si falta, el del RUT. Limpia el decimal de Excel y el indicativo duplicado; descarta fijos y textos que no son numeros. NULL si no hay uno valido. Fuente unica para el aviso por WhatsApp.';
