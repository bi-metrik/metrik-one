-- Detección a pedido: letras de otra escritura (no latina) guardadas en ONE, en todos los
-- workspaces. Solo lectura. Acompaña el bloqueo de `src/lib/texto/texto-latino.ts`
-- (2026-10-06: la IA metió В cirílica por B en el RUT de V0121 y el 010 se cayó; el barrido
-- encontró también griego —«ΤΟ», «JOHΝ», «XΕΙ»— y un contacto con el nombre en cirílico).
--
-- Busca letras de escrituras no latinas, no símbolos: griego (U+0370–U+03FF) y cirílico
-- (U+0400–U+052F), que son los que se han visto, más hebreo/árabe, kana y CJK por si acaso.
--
-- Correr con execute_sql (MCP de Supabase) o el editor SQL. No corrige nada: los datos los
-- corrige la persona desde la pantalla, o Mauricio autoriza.

with valores as (
  -- Bloques de negocio: cualquier texto dentro de `data` (raíz y `campos.<slug>.value`).
  select n.workspace_id, 'negocio_bloques' as tabla, n.codigo as referencia,
         bc.nombre as donde, v #>> '{}' as valor
  from negocio_bloques nb
  join negocios n on n.id = nb.negocio_id
  join bloque_configs bc on bc.id = nb.bloque_config_id
  cross join lateral jsonb_path_query(nb.data, 'strict $.**') v
  where jsonb_typeof(v) = 'string'
  union all
  select c.workspace_id, 'contactos', c.id::text, 'nombre/email', concat_ws(' | ', c.nombre, c.email)
  from contactos c
  union all
  select e.workspace_id, 'empresas', e.codigo, 'nombre/documento/contacto',
         concat_ws(' | ', e.nombre, e.numero_documento, e.contacto_nombre, e.contacto_email)
  from empresas e
  union all
  select n.workspace_id, 'negocios', n.codigo, 'nombre', n.nombre
  from negocios n
)
select w.slug, v.tabla, v.referencia, v.donde, v.valor,
       regexp_replace(v.valor, '[^Ͱ-ϿЀ-ԯ֐-ۿ぀-ヿ一-鿿]', '', 'g') as letras
from valores v
join workspaces w on w.id = v.workspace_id
where v.valor ~ '[Ͱ-ϿЀ-ԯ֐-ۿ぀-ヿ一-鿿]'
order by w.slug, v.tabla, v.referencia;
