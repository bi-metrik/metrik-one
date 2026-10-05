-- ¿Quién es el cliente? La búsqueda por NOMBRE en todo el directorio, para el bot de la bandeja.
--
-- Diseño: proyectos/trappvel/clarity/docs/diseno/2026-10-05_diseno-cliente-y-conversacion.md, §3.2 paso 2.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué
-- ─────────────────────────────────────────────────────────────────────────────
--
-- El bot buscaba al cliente SOLO entre los que tienen un viaje abierto: un cliente que vuelve con todos sus
-- viajes cerrados era invisible, y «nuevo viaje» terminaba creando una segunda ficha de alguien que ya
-- estaba. Esta función busca en todos los contactos del workspace, tengan o no viajes abiertos, y trae lo que
-- el bot necesita para MOSTRAR a cada candidato sin enseñar su dato completo: los 4 últimos dígitos del
-- celular, si tiene correo, sus viajes abiertos y el último cerrado.
--
-- La función NO decide nada: es un prefiltro amplio (todas las palabras del nombre dadas están en el del
-- contacto, o se parece por trigramas). Quién es «el mismo» lo decide el código del bot
-- (`_shared/wa-cliente-reglas.ts`), que nunca une por el nombre sin mostrarlo. La llave (celular, correo,
-- usuario) sigue en `buscar_contacto_duplicado`, sin cambios.
--
-- Solo lectura: no toca datos ni índices. `unaccent` y `pg_trgm` ya están instalados en `public`
-- (verificado el 2026-10-05). El universo es un workspace (el más grande tiene ~1.200 contactos): se filtra
-- por `workspace_id` y lo demás se calcula en la fila.
--
-- epoca: no-rompe función nueva de solo lectura; no borra, renombra ni cambia nada que use el código de hoy.

create or replace function buscar_clientes_por_nombre(
  p_workspace_id uuid,
  p_texto        text
)
returns table (
  id            uuid,
  nombre        text,
  cel4          text,
  tiene_correo  boolean,
  tiene_usuario boolean,
  abiertos      jsonb,
  cerrado       jsonb,
  exacto        boolean
)
language sql
stable
security invoker
set search_path = public
as $$
  with entrada as (
    select btrim(regexp_replace(regexp_replace(lower(unaccent(coalesce(p_texto, ''))), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as txt
  ),
  palabras as (
    -- Las palabras que identifican: dos letras o más, sin artículos ni «cliente».
    select array_agg(w) as ws
    from entrada, unnest(string_to_array(entrada.txt, ' ')) as w
    where length(w) >= 2 and w not in ('de', 'del', 'la', 'las', 'los', 'el', 'cliente', 'clienta', 'senor', 'senora', 'sr', 'sra', 'don', 'dona')
  ),
  contactos_ws as (
    select c.id, c.nombre, c.telefono, c.email, c.usuario_whatsapp, c.created_at,
           btrim(regexp_replace(regexp_replace(lower(unaccent(coalesce(c.nombre, ''))), '[^a-z0-9 ]', ' ', 'g'), '\s+', ' ', 'g')) as nom
    from contactos c
    where c.workspace_id = p_workspace_id
  ),
  candidatos as (
    select k.*,
           k.nom = e.txt as es_exacto,
           coalesce((select bool_and(position(' ' || w || ' ' in ' ' || k.nom || ' ') > 0) from unnest(p.ws) as w), false) as todas,
           similarity(k.nom, e.txt) as sim
    from contactos_ws k, entrada e, palabras p
    where e.txt <> '' and p.ws is not null
  )
  select c.id,
         c.nombre,
         case when length(regexp_replace(coalesce(c.telefono, ''), '\D', '', 'g')) >= 4
              then right(regexp_replace(c.telefono, '\D', '', 'g'), 4) end as cel4,
         coalesce(btrim(c.email), '') <> '' as tiene_correo,
         coalesce(btrim(c.usuario_whatsapp), '') <> '' as tiene_usuario,
         coalesce((
           select jsonb_agg(jsonb_build_object('codigo', n.codigo, 'nombre', n.nombre) order by n.created_at desc)
           from negocios n
           where n.workspace_id = p_workspace_id and n.contacto_id = c.id and n.estado = 'abierto'
         ), '[]'::jsonb) as abiertos,
         (
           select jsonb_build_object('codigo', n.codigo, 'nombre', n.nombre)
           from negocios n
           where n.workspace_id = p_workspace_id and n.contacto_id = c.id and n.estado <> 'abierto'
           order by n.updated_at desc nulls last, n.created_at desc
           limit 1
         ) as cerrado,
         c.es_exacto as exacto
  from candidatos c
  where c.es_exacto or c.todas or c.sim >= 0.45
  order by c.es_exacto desc, c.todas desc, c.sim desc, c.created_at asc, c.id asc
  -- Hasta 5: con más, el bot igual pregunta cuál, y el techo evita traerse medio directorio por un nombre corto.
  limit 5;
$$;

comment on function buscar_clientes_por_nombre(uuid, text) is
  'Hasta 5 contactos del workspace cuyo nombre contiene todas las palabras del texto o se le parece (trigramas), tengan o no viajes abiertos, con los 4 ultimos digitos del celular, si tienen correo, sus negocios abiertos y el ultimo cerrado. Prefiltro de solo lectura para el bot de la bandeja: quien decide es _shared/wa-cliente-reglas.ts.';

-- La llama solo el bot (edge function con service_role). Nace ejecutable por PUBLIC (y por ahí por `anon`):
-- se le quita, como a toda función nueva.
revoke all on function buscar_clientes_por_nombre(uuid, text) from public, anon, authenticated;
grant execute on function buscar_clientes_por_nombre(uuid, text) to service_role;
