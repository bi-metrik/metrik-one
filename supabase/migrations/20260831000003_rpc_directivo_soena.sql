-- Tablero directivo de JD (#40-#43): una sola RPC que responde lo que hoy el llena a
-- mano en el Sheet "Directivo SOENA".
--
-- ── Que NO hace esta funcion, y por que ────────────────────────────────────────
--
--   · LEADS POR CIUDAD ❌ — el Sheet parte los leads del mes en Bogota/Cali/Medellin/
--     Bucaramanga/otras. En ONE **no hay de donde sacarlo**: `contactos` no guarda
--     ciudad (sus claves son cedula, origen, id_hubspot, fuente_cargue, status_legacy)
--     y el payload de Meta que se archiva es el aviso del webhook, sin `field_data`.
--     La seccional aparece recien con el RUT, en Documentacion. Se devuelve el TOTAL y
--     las celdas por ciudad no existen: la pantalla pinta raya, no cero.
--
--   · CERTIFICADOS UPME ERRONEOS y DEVOLUCIONES DIAN ❌ — `reproceso_eventos` sigue en
--     0 filas. Es captura manual de Deisy en su cuaderno. Un cero aqui se leeria como
--     "calidad perfecta", que es justo lo que nadie puede afirmar.
--
--   · INVERSION DE MARKETING / CAC ❌ — se teclea desde Meta Ads, no hay integracion.
--
-- ── Agrupacion de ciudades ─────────────────────────────────────────────────────
--
-- La RPC devuelve la seccional CRUDA. Colapsar a las 4 + "otras" que pide JD lo hace
-- quien consume, con `canonizarSeccional` (`src/lib/dian/seccionales.ts`), igual que
-- `get_capacidad_seccional_soena` y `getProcesoPorSeccional`. Copiar el catalogo a SQL
-- crearia una segunda fuente que se desincroniza el dia que la DIAN cambie una.
--
-- ⚠️ Esto NO revierte la decision del 2026-08-22 (el tablero Comercial sigue cortando
-- por seccional DIAN tal cual, sin agrupar). La agrupacion 4+otras es de la vista
-- Direccion, porque es el idioma en que JD lee su Sheet.
--
-- ── El mapeo de las 10 filas de proceso ────────────────────────────────────────
--
-- Aprobado por Mauricio el 2026-08-31. Va por `etapas_negocio.orden`, NO por `numero`:
-- el `numero` visible ya se corrio una vez (entro Revision radicado el 2026-08-18 y
-- corrio +1 los once de arriba) y el motor usa `orden`.
--
-- ⚠️ Precobro (10), Cobro (11) y Entrega (12) NO tienen fila en el Sheet de JD, y las
-- cinco etapas comerciales tampoco. Los casos que esten ahi salen en la fila 11,
-- "Fuera del proceso operativo", para que la matriz sume el total de la cartera en vez
-- de perder casos en silencio.

create or replace function public.get_directivo_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
with guard as (
  select p_workspace_id as id
  where p_workspace_id = current_user_workspace_id()
),
rango as (
  select make_date(p_anio, p_mes, 1) as desde,
         (make_date(p_anio, p_mes, 1) + interval '1 month')::date as hasta
),
-- Fila 11 recoge todo lo que el Sheet no nombra: nada se pierde en el camino.
mapa(fila_orden, fila, etapa_orden) as (
  values
    (1,  'En presentación a UPME',                    array[7]),
    (2,  'A la espera de pago a la UPME',             array[8]),
    (3,  'En evaluación de UPME',                     array[20]),
    (4,  'Certificado UPME expedido',                 array[9]),
    (5,  'En agendamiento DIAN',                      array[17]),
    (6,  'Con cita agendada de la DIAN',              array[16]),
    (7,  'Certificado bancario y elaboración de documentos', array[18]),
    (8,  'Documentos enviados al cliente DIAN',       array[13, 14]),
    (9,  'Documentos aceptados por la DIAN',          array[19]),
    (10, 'Proceso terminado',                         array[15]),
    (11, 'Fuera del proceso operativo',               array[1, 2, 4, 5, 6, 10, 11, 12])
),
-- Cartera abierta de hoy. La matriz es una FOTO, no un flujo del mes: el Sheet
-- tampoco acumula, muestra donde esta parado cada caso.
abiertos as (
  select n.id, n.metadata->>'seccional' as seccional, e.orden as etapa_orden
  from negocios n
  join guard g on n.workspace_id = g.id
  left join etapas_negocio e on e.id = n.etapa_actual_id
  where n.estado = 'abierto'
),
operaciones as (
  select m.fila_orden, m.fila,
         coalesce(a.seccional, '(sin seccional)') as seccional,
         count(a.id) as cantidad
  from mapa m
  left join abiertos a on a.etapa_orden = any(m.etapa_orden)
  group by m.fila_orden, m.fila, coalesce(a.seccional, '(sin seccional)')
  having count(a.id) > 0
),
-- Los completados no tienen etapa viva: entran a "Proceso terminado" por estado.
terminados as (
  select coalesce(n.metadata->>'seccional', '(sin seccional)') as seccional, count(*) as cantidad
  from negocios n join guard g on n.workspace_id = g.id
  where n.estado = 'completado'
  group by 1
),
-- Un lead es un contacto creado en el mes.
leads as (
  select count(*) as n
  from contactos c join guard g on c.workspace_id = g.id
  cross join rango r
  where c.created_at >= r.desde and c.created_at < r.hasta
),
-- Calificado = el negocio SUPERO Validacion (definicion de Mauricio, 2026-08-31:
-- "por ahora arrancamos con eso"). Se lee del timeline, que es donde queda la traza.
calificados as (
  select count(distinct a.entidad_id) as n
  from activity_log a join guard g on a.workspace_id = g.id
  cross join rango r
  where a.tipo = 'cambio_etapa' and a.entidad_tipo = 'negocio'
    and a.valor_anterior ilike '%validaci%'
    and a.created_at >= r.desde and a.created_at < r.hasta
),
-- Venta del mes: la MISMA vista que alimenta el tablero comercial y su drill. Si se
-- reimplementara el criterio aqui, el directivo y el comercial dirian numeros
-- distintos de lo mismo y el equipo le creeria al que le convenga.
ventas as (
  select count(*) as n
  from v_venta_mes_comercial v join guard g on v.workspace_id = g.id
  cross join rango r
  where v.fecha_venta >= r.desde and v.fecha_venta < r.hasta
),
-- Ingresos del mes por tramo. En el Sheet "Ventas totales" es exactamente
-- primer + segundo pago (25.620.168 + 2.432.773 = 28.052.941 en agosto).
pagos as (
  select coalesce(sum(cv.a_tramo1), 0) as primer_pago,
         coalesce(sum(cv.a_tramo2), 0) as segundo_pago
  from v_cobro_valor cv join guard g on cv.workspace_id = g.id
  cross join rango r
  where cv.fecha >= r.desde and cv.fecha < r.hasta
),
-- Citas cuya FECHA cae en el mes. Es la unica fecha limpia que existe: el momento en
-- que se agendo no es recuperable (`completado_at` de los 104 bloques quedo estampado
-- por la migracion de agosto, no por el trabajo real). El Sheet cuenta lo agendado
-- durante el mes; esta cifra cuenta lo que ocurre en el mes, y no son lo mismo.
citas as (
  select coalesce(n.metadata->>'seccional', '(sin seccional)') as seccional,
         count(*) as cantidad
  from negocio_bloques nb
  join bloque_configs bc on bc.id = nb.bloque_config_id and bc.slug = 'fecha_cita_dian'
  join negocios n on n.id = nb.negocio_id
  join guard g on n.workspace_id = g.id
  cross join rango r
  where nullif(nb.data->>'fecha_cita_dian', '') is not null
    and (nb.data->>'fecha_cita_dian')::date >= r.desde
    and (nb.data->>'fecha_cita_dian')::date <  r.hasta
  group by 1
),
metas as (
  select cm.meta_ventas_mensual, cm.meta_leads_mensual,
         cm.meta_leads_calificados_mensual, cm.meta_negocios_mensual
  from config_metas cm join guard g on cm.workspace_id = g.id
  cross join rango r
  where cm.mes = r.desde
)
select jsonb_build_object(
  'comercial', jsonb_build_object(
    'leads_generados',   (select n from leads),
    'leads_calificados', (select n from calificados),
    'negocios_cerrados', (select n from ventas),
    'primer_pago',       (select primer_pago from pagos),
    'segundo_pago',      (select segundo_pago from pagos),
    'ventas_totales',    (select primer_pago + segundo_pago from pagos)
  ),
  'metas', coalesce((select to_jsonb(m) from metas m), '{}'::jsonb),
  'operaciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'fila_orden', o.fila_orden, 'fila', o.fila,
      'seccional', o.seccional, 'cantidad', o.cantidad
    ) order by o.fila_orden, o.seccional)
    from operaciones o), '[]'::jsonb),
  'terminados', coalesce((
    select jsonb_agg(jsonb_build_object('seccional', t.seccional, 'cantidad', t.cantidad))
    from terminados t), '[]'::jsonb),
  'citas', coalesce((
    select jsonb_agg(jsonb_build_object('seccional', c.seccional, 'cantidad', c.cantidad))
    from citas c), '[]'::jsonb)
)
where exists (select 1 from guard);
$function$;

-- Mismo permiso que el resto de RPCs del tablero: nunca `anon`, nunca `public`.
revoke all on function public.get_directivo_soena(uuid, integer, integer) from public, anon;
grant execute on function public.get_directivo_soena(uuid, integer, integer) to authenticated;
