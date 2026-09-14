-- El tablero de marketing gana el corte por ciudad: una columna mas en
-- `v_marketing_negocio`, la seccional que ya vive en `negocios.metadata`.
--
-- Origen: `proyectos/soena/ve/2026-09-14_brief-max-marketing-por-ciudad.md`. Pedido de
-- Mauricio, textual: "necesito otro cambio y es ver en el tablero de marketing por
-- cuidades asi como se ve en el tablero directivo".
--
-- ⚠️ La ciudad NO es un campo de marketing. Es la seccional DIAN, la misma que lee
-- `get_directivo_soena`, y llega con el RUT en Documentacion. Medido contra produccion
-- el 2026-09-14 en SOENA (7dea141d-d4da-483d-a78d-b14ef35500c5): de 99 negocios con
-- campana, **solo 28 tienen seccional, y esos 28 son exactamente las 28 ventas**. Los 71
-- restantes son leads que no llegaron a Documentacion. Por eso el corte por ciudad se
-- aplica solo a lo que tiene ciudad (ventas, honorario y recaudado) y los leads, el
-- gasto, el CPL, el CAC y la conversion se quedan por campana: repartirlos seria
-- inventar una distribucion que nadie midio.
--
-- La columna va cruda, sin canonizar ni agrupar. La agrupacion en las seis columnas del
-- tablero directivo (Bogota, Cali, Medellin, Bucaramanga, Otras ciudades, Sin seccional)
-- la hace `columnaDirectivo` de `src/lib/dian/agrupacion-directivo.ts`, que es la misma
-- funcion que usa la pestana Direccion. Una segunda copia del criterio en SQL dejaria el
-- drill mostrando una lista que no cuadra con el numero del que salio.
--
-- ⚠️ Esto NO reemplaza el corte por seccional del tablero Comercial: ahi siguen tal cual,
-- sin agrupar (decision de Mauricio del 2026-08-22).

-- vista-definer: la vista lee `v_venta_mes_comercial`, que no concede nada a
-- `authenticated` y no filtra por workspace. Se consulta server-side con el cliente de
-- servicio y el workspace ya resuelto desde la sesion; declararla `security_invoker` la
-- dejaria devolviendo vacio para el rol de servicio sin decir por que. Es la misma
-- decision de `20260903000001_marketing_campana.sql`, que la creo asi.

-- ⚠️ `seccional` va de ULTIMA a proposito. `create or replace view` no renombra ni
-- reordena columnas: solo admite AGREGAR al final, y el error de intentarlo apunta a la
-- columna que quedo desalineada por posicion, no a la que uno toco. Las 16 columnas de
-- arriba estan copiadas verbatim de la migracion que creo la vista, y se verifico contra
-- produccion (2026-09-14) que la vista desplegada tiene exactamente esas 16 y ninguna
-- mas: ninguna fila ni ningun criterio existente cambia con esta migracion.
create or replace view public.v_marketing_negocio as
select
  n.workspace_id,
  n.id                                                                as negocio_id,
  n.codigo,
  n.nombre,
  c.nombre                                                            as cliente,
  s.full_name                                                         as comercial,
  e.nombre                                                            as etapa,
  n.estado,
  (date_trunc('month', (n.created_at at time zone 'America/Bogota')))::date as mes_creacion,
  meta.campaign_id,
  a.campana                                                           as campana_payload,
  a.tiene_rastro_meta,
  v.fecha_venta,
  (date_trunc('month', v.fecha_venta))::date                          as mes_venta,
  coalesce(v.honorario_sin_iva, 0)                                    as honorario,
  coalesce(v.honorario_recaudado, 0)                                  as recaudado,
  nullif(trim(n.metadata->>'seccional'), '')                          as seccional
from public.negocios n
left join public.v_negocio_atribucion a on a.negocio_id = n.id
left join lateral (
  select ci.payload->>'campaign_id' as campaign_id
    from public.contacto_interacciones ci
   where ci.contacto_id = n.contacto_id
     and ci.fuente = 'meta'
     and nullif(ci.payload->>'campaign_id', '') is not null
   order by ci.ocurrida_at desc
   limit 1
) meta on true
left join public.v_venta_mes_comercial v on v.negocio_id = n.id
left join public.etapas_negocio e on e.id = n.etapa_actual_id
left join public.v_negocio_comercial vc on vc.negocio_id = n.id
left join public.staff s on s.id = vc.comercial_staff_id
left join public.contactos c on c.id = n.contacto_id;

comment on view public.v_marketing_negocio is
  'Un negocio por fila con la campana que lo trajo y su seccional. Fuente unica de la cifra y del drill.';

-- `create or replace view` conserva la ACL, pero el revoke se repone igual: el grant que
-- una migracion otorga no sobrevive a la siguiente reescritura, y gana la ultima sentencia
-- del ledger, no la que uno recuerde. Repetirlo aqui es barato y deja la decision escrita
-- en el mismo archivo que toca la vista.
revoke all on public.v_marketing_negocio from anon, authenticated;

-- Verificacion al aplicar (no se pudo correr desde la sesion que escribio esto: el
-- clasificador bloqueo la lectura del token de la Management API). Las tres guardas del
-- brief, en una sola consulta:
--
--   select relname, relacl::text, reloptions::text,
--          has_table_privilege('authenticated', 'public.' || relname, 'select') as auth_select,
--          has_table_privilege('anon',          'public.' || relname, 'select') as anon_select
--     from pg_class
--    where relnamespace = 'public'::regnamespace
--      and relname in ('v_marketing_negocio', 'v_marketing_campana');
--
-- Esperado ANTES y DESPUES, identico: `reloptions` null en las dos (hoy no tienen
-- `security_invoker`, asi que el `create or replace` no borra ninguno) y `auth_select` /
-- `anon_select` en false. Si `auth_select` sale true despues, el revoke de arriba no
-- corrio y la vista quedo expuesta.

-- ⚠️⚠️ ORDEN: esta migracion va ANTES del merge del PR, no despues.
-- `getMarketingData` pide `seccional` en su consulta. Contra la vista sin la columna,
-- PostgREST responde 400, `traerTodo` lanza, y ese throw sube por el `Promise.all` de
-- `src/app/(app)/tableros/page.tsx`, que no tiene catch por rama: se cae /tableros
-- entero, no solo la pestana de Marketing. Medido el 2026-09-14: el modulo
-- `marketing_campanas` esta encendido en 1 de los 17 workspaces (soena).
-- Al reves es inofensivo: aplicar esto sin desplegar el codigo solo agrega una columna
-- que todavia nadie consulta.
