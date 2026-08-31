-- Las metas del mes que hoy JD teclea en el Sheet "Directivo SOENA" pasan a la base.
--
-- `config_metas` ya existia con las dos metas de plata (ventas y recaudo) y estaba
-- VACIA en SOENA (0 filas, medido 2026-08-31). El Sheet lleva otras tres metas de
-- CANTIDAD que no tenian donde vivir: leads, leads calificados y negocios cerrados.
--
-- Se agregan como columnas nullable de la tabla generica, no como tabla nueva de
-- SOENA: son las mismas tres metas que cualquier linea comercial querria fijar, y
-- una tabla `metas_directivo_soena` seria la segunda fuente de la misma pregunta.
-- Nullable a proposito: un workspace que no fije la meta muestra "sin meta", que no
-- es lo mismo que una meta de cero.

alter table config_metas
  add column if not exists meta_leads_mensual              integer,
  add column if not exists meta_leads_calificados_mensual  integer,
  add column if not exists meta_negocios_mensual           integer;

comment on column config_metas.meta_leads_mensual is
  'Meta de leads generados en el mes. NULL = el workspace no la fijo (distinto de 0).';
comment on column config_metas.meta_leads_calificados_mensual is
  'Meta de leads calificados. En SOENA calificado = el negocio SUPERO la etapa Validacion.';
comment on column config_metas.meta_negocios_mensual is
  'Meta de negocios cerrados (ventas) en el mes.';

-- Metas de agosto 2026, copiadas del Sheet de JD tal cual las tiene el (fila META).
-- `meta_recaudo_mensual` va NULL: el Sheet no declara meta de recaudo, y ponerle la
-- de ventas seria inventarle un numero que nadie fijo.
insert into config_metas (
  workspace_id, mes,
  meta_ventas_mensual, meta_recaudo_mensual,
  meta_leads_mensual, meta_leads_calificados_mensual, meta_negocios_mensual
)
select '7dea141d-d4da-483d-a78d-b14ef35500c5'::uuid, date '2026-08-01',
       48614400, null, 800, 600, 100
where not exists (
  select 1 from config_metas
  where workspace_id = '7dea141d-d4da-483d-a78d-b14ef35500c5'::uuid and mes = date '2026-08-01'
);
