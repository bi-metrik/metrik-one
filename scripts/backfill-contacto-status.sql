-- Backfill de `contactos.segmento` a los valores nuevos de Status.
--
-- ⚠️ NO es una migración: NO se corre sola. Va DESPUÉS de mergear y desplegar el
-- código nuevo. Si corre antes, la pantalla en producción muestra los valores
-- nuevos en gris (el código desplegado no los conoce) hasta que entre el deploy.
--
-- Reversible: guarda el valor anterior en `custom_data.status_legacy` antes de
-- pisarlo. Para revertir, ver el bloque del final.
--
-- Mapeo (decidido por Mauricio el 2026-07-31):
--   sin_contactar → primer_contacto   ← 319 filas. OJO: son contactos que nadie
--                                       ha llamado; quedan indistinguibles de los
--                                       que ya recibieron una llamada. Decisión
--                                       consciente, ver el PR.
--   contactado    → conectado         ← hubo gestión real sobre el contacto
--   convertido    → conectado         ← tenía negocio en ejecución/cobro
--   inactivo      → descartado

begin;

-- 1. Respaldo del valor anterior (idempotente: no pisa un respaldo existente)
update public.contactos
set custom_data = coalesce(custom_data, '{}'::jsonb)
  || jsonb_build_object('status_legacy', segmento)
where segmento in ('sin_contactar', 'contactado', 'convertido', 'inactivo')
  and not (coalesce(custom_data, '{}'::jsonb) ? 'status_legacy');

-- 2. Traducción
update public.contactos set segmento = 'primer_contacto' where segmento = 'sin_contactar';
update public.contactos set segmento = 'conectado'       where segmento in ('contactado', 'convertido');
update public.contactos set segmento = 'descartado'      where segmento = 'inactivo';

-- 3. Control: debe devolver 0 filas con valores legacy
select segmento, count(*) from public.contactos group by 1 order by 2 desc;

commit;

-- 4. Config del webhook de Meta: el lead nuevo nace en 'primer_contacto'.
--    (SOENA es el único workspace con meta_leads configurado hoy.)
update public.workspaces
set config_extra = jsonb_set(
  config_extra, '{meta_leads,contacto,segmento_inicial}', '"primer_contacto"'
)
where config_extra -> 'meta_leads' -> 'contacto' ? 'segmento_inicial';

-- ── Reversa, si hiciera falta ────────────────────────────────────────────────
-- update public.contactos
-- set segmento = custom_data ->> 'status_legacy',
--     custom_data = custom_data - 'status_legacy'
-- where custom_data ? 'status_legacy';
