-- Indices sobre llaves foraneas de la ruta caliente (abrir un negocio y listar negocios).
--
-- Contexto: el advisor reporta 113 FK sin indice en toda la base. Este cambio NO las cubre
-- todas a proposito: solo las que estan en el camino que recorre un usuario a diario, medidas
-- contra pg_stat_statements (ventana de 3,8 dias, 2026-07-28 → 2026-08-01).
--
--   negocio_bloques.bloque_config_id  el join negocio_bloques ⨝ bloque_configs es la consulta
--                                     mas cara de la vista de detalle: 577 llamadas, 100,8 ms
--                                     de media. `negocio_bloques` es la tabla mas pesada (2,2 MB).
--   negocios.linea_id                 filtro de la lista de negocios y del segmentador de fases.
--   negocios.responsable_id           un `operator` solo ve sus negocios; el filtro corre en
--                                     cada carga de /negocios.
--   activity_log.autor_id             timeline de comentarios del negocio.
--
-- Aditivo y reversible: crear un indice no cambia la forma de ninguna consulta ni el
-- comportamiento del codigo desplegado, asi que es seguro aplicarlo antes del merge
-- (a diferencia de un cambio de forma en una RPC, ver CLAUDE.md).
-- Sin CONCURRENTLY: las tablas son de pocos MB y el bloqueo es instantaneo.

create index if not exists idx_negocio_bloques_bloque_config_id
  on public.negocio_bloques (bloque_config_id);

create index if not exists idx_negocios_linea_id
  on public.negocios (linea_id);

create index if not exists idx_negocios_responsable_id
  on public.negocios (responsable_id);

create index if not exists idx_activity_log_autor_id
  on public.activity_log (autor_id);

-- Rollback:
--   drop index if exists public.idx_negocio_bloques_bloque_config_id;
--   drop index if exists public.idx_negocios_linea_id;
--   drop index if exists public.idx_negocios_responsable_id;
--   drop index if exists public.idx_activity_log_autor_id;
