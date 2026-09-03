-- Tablero de marketing: el gasto que se sincroniza de Meta y las dos vistas que
-- lo cruzan con los leads y con las ventas.
--
-- Origen: spec `proyectos/soena/ve/2026-09-03_spec-tablero-marketing.md`, salida de
-- la reunion con Daniela Jativa del 2026-09-02.
--
-- Lo que esta migracion NO hace, a proposito: encender el modulo `marketing_campanas`
-- en ningun workspace. Eso es escritura sobre una fila de produccion y va aparte, en
-- `proyectos/soena/ve/migrations/PENDIENTE_20260903_modulo_marketing_campanas.sql`,
-- para que lo apruebe quien decide. Aqui solo hay DDL.
--
-- ⚠️ Las dos vistas AGRUPAN POR `campaign_id`, nunca por `campaign_name`. Meta ya
-- renombro una campana viva de SOENA: lo que el payload del lead guarda como
-- `CLIENTES POTENCIALES AGO 2026 PLUS` hoy se llama `CLIENTES POTENCIALES AGO ($100)`.
-- El nombre del payload es una FOTO del momento en que entro el lead; agrupar por el
-- partiria esa campana en dos filas el dia que alguien la vuelva a renombrar, con la
-- mitad del gasto en cada una. El nombre que se pinta es el vigente en Meta
-- (`campana_insights.campaign_name`), con el del payload como respaldo.

-- ── El gasto que Meta reporta ─────────────────────────────────────────────────
--
-- server-only: la escribe la edge function `meta-insights-sync` con la service key y
-- la lee `/tableros` por el cliente de servicio, con el workspace ya resuelto desde la
-- sesion. Ninguna pantalla la consulta con el token del usuario, asi que no lleva grant
-- a `authenticated` ni policy.
--
-- ⚠️ El grano es (campana, MES) y el sync REESCRIBE el mes completo, nunca suma sobre
-- lo que habia: Meta ajusta cifras de dias ya cerrados. Por eso el unique de abajo y el
-- `on conflict do update` de la function. El total de una campana es la suma de sus
-- meses (verificado contra la API: 306.691 + 907.714 = 1.214.405 en la de video).
create table if not exists public.campana_insights (
  id               uuid primary key default gen_random_uuid(),
  workspace_id     uuid not null references public.workspaces(id) on delete cascade,
  campaign_id      text not null,
  campaign_name    text,
  account_id       text,
  status           text,
  mes              date not null,
  spend            numeric(14,2) not null default 0,
  impressions      bigint,
  clicks           bigint,
  -- Las cifras vienen en la moneda de la CUENTA, y SOENA tiene dos cuentas. Sumarlas
  -- sin comprobar que las dos estan en la misma moneda daria un numero sin significado.
  currency         text,
  sincronizado_at  timestamptz not null default now(),
  created_at       timestamptz not null default now()
);

alter table public.campana_insights enable row level security;

create unique index if not exists campana_insights_ws_campana_mes
  on public.campana_insights (workspace_id, campaign_id, mes);

comment on table public.campana_insights is
  'Gasto por campana y mes traido de la Graph API de Meta. Se re-lee, no se acumula.';
comment on column public.campana_insights.mes is
  'Primer dia del mes. Grano fijo: el total de la campana es la suma de sus meses.';


-- ── Un negocio, con la campana que lo trajo ───────────────────────────────────
--
-- Es la definicion UNICA que consumen la cifra de la tabla y el panel lateral que la
-- abre. Escrita dos veces, el drill mostraria una lista que no cuadra con el numero
-- del que salio — la leccion que ya costo `v_venta_mes_comercial`.
--
-- La venta sale de `v_venta_mes_comercial`, que es la definicion canonica de venta del
-- producto; el nombre de la campana, de `v_negocio_atribucion`, que ya resuelve el
-- conflicto entre el origen declarado y el rastro de Meta. El `campaign_id` se deriva
-- con LA MISMA regla que esa vista usa para el nombre (la interaccion de Meta mas
-- reciente del contacto), y se verifico contra produccion el 2026-09-03 que las dos
-- coinciden en los 416 negocios de SOENA: cero desalineados.
--
-- ⚠️ El comercial NO sale de `negocios.responsable_id`: ese campo es el responsable
-- principal DERIVADO y puede apuntar a un operativo. Sale de `v_negocio_comercial`,
-- que es la fuente que el resto del tablero ya usa.
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
  coalesce(v.honorario_recaudado, 0)                                  as recaudado
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
  'Un negocio por fila con la campana que lo trajo. Fuente unica de la cifra y del drill.';


-- ── La campana, mes a mes ─────────────────────────────────────────────────────
--
-- Grano (workspace, campana, mes). Sirve a LAS DOS lentes que la pantalla necesita
-- sin reimplementar nada:
--
--   · lente MES     — se filtra por `mes`. Es la de contabilidad y la que cuadra
--                     contra el Sheet que Daniela lleva a mano.
--   · lente COHORTE — se suman todos los meses de la campana. Es la unica con la que
--                     "que tan rentable es esta campana" tiene respuesta, porque un
--                     lead de julio puede cerrar en septiembre.
--
-- Que la suma de los meses sea exactamente la cohorte no es casualidad: cada hecho
-- cae en UN solo mes. El lead cuenta en el mes de su PRIMERA interaccion con esa
-- campana (medido: 1 contacto de SOENA volvio a escribir el mes siguiente, y sin esta
-- regla se contaria dos veces); la venta, en el mes de `fecha_venta`; el negocio, en
-- el mes en que se creo; el gasto, en el mes que reporta Meta.
--
-- La fila con `campaign_id is null` es "Sin rastro de Meta": las ventas que no dejaron
-- huella. Vive en la misma vista a proposito — calcularla aparte seria una segunda
-- definicion de lo mismo, por negacion. **No significa "no vino de marketing"**:
-- significa que el comercial creo un contacto nuevo en vez de enganchar el que ya
-- existia, y por eso el rastro se perdio.
create or replace view public.v_marketing_campana as
with formularios as (
  select ci.workspace_id,
         ci.payload->>'campaign_id'                                                                   as campaign_id,
         (date_trunc('month', coalesce(ci.ocurrida_at, ci.created_at) at time zone 'America/Bogota'))::date as mes,
         count(*)::bigint                                                                             as formularios,
         min(coalesce(ci.ocurrida_at, ci.created_at))                                                 as primer_lead,
         max(coalesce(ci.ocurrida_at, ci.created_at))                                                 as ultimo_lead
    from public.contacto_interacciones ci
   where ci.fuente = 'meta'
     and nullif(ci.payload->>'campaign_id', '') is not null
   group by 1, 2, 3
),
-- Leads = CONTACTOS distintos, no formularios: dos formularios del mismo numero son
-- una persona. Cada contacto cuenta en el mes de su primera interaccion con la
-- campana, para que los meses particionen la cohorte y sumen exacto.
leads as (
  select p.workspace_id, p.campaign_id,
         (date_trunc('month', p.primera at time zone 'America/Bogota'))::date as mes,
         count(*)::bigint                                                     as leads
    from (
      select ci.workspace_id,
             ci.payload->>'campaign_id'                    as campaign_id,
             ci.contacto_id,
             min(coalesce(ci.ocurrida_at, ci.created_at))  as primera
        from public.contacto_interacciones ci
       where ci.fuente = 'meta'
         and nullif(ci.payload->>'campaign_id', '') is not null
       group by 1, 2, 3
    ) p
   group by 1, 2, 3
),
negocios as (
  select workspace_id, campaign_id, mes_creacion as mes, count(*)::bigint as negocios
    from public.v_marketing_negocio
   group by 1, 2, 3
),
ventas as (
  select workspace_id, campaign_id, mes_venta as mes,
         count(*)::bigint  as ventas,
         sum(honorario)    as honorario,
         sum(recaudado)    as recaudado
    from public.v_marketing_negocio
   where fecha_venta is not null
   group by 1, 2, 3
),
gasto as (
  select workspace_id, campaign_id, mes,
         sum(spend)             as spend,
         sum(impressions)       as impressions,
         sum(clicks)            as clicks,
         max(sincronizado_at)   as sincronizado_at,
         max(campaign_name)     as campaign_name,
         max(account_id)        as account_id,
         max(status)            as status,
         max(currency)          as currency
    from public.campana_insights
   group by 1, 2, 3
),
-- El nombre con el que el lead entro, por si la campana todavia no se ha sincronizado.
nombre_payload as (
  select distinct on (ci.workspace_id, (ci.payload->>'campaign_id'))
         ci.workspace_id,
         ci.payload->>'campaign_id'                as campaign_id,
         nullif(ci.payload->>'campaign_name', '')  as campana
    from public.contacto_interacciones ci
   where ci.fuente = 'meta'
     and nullif(ci.payload->>'campaign_id', '') is not null
   order by ci.workspace_id, (ci.payload->>'campaign_id'), coalesce(ci.ocurrida_at, ci.created_at) desc
),
claves as (
  select workspace_id, campaign_id, mes from formularios
  union select workspace_id, campaign_id, mes from leads
  union select workspace_id, campaign_id, mes from negocios
  union select workspace_id, campaign_id, mes from ventas
  union select workspace_id, campaign_id, mes from gasto
)
select
  k.workspace_id,
  k.campaign_id,
  k.mes,
  coalesce(g.campaign_name, np.campana)      as campana,
  g.account_id,
  g.status,
  g.currency,
  g.sincronizado_at,
  coalesce(g.spend, 0)::numeric(14,2)        as gasto,
  g.impressions,
  g.clicks,
  coalesce(l.leads, 0)                       as leads,
  coalesce(f.formularios, 0)                 as formularios,
  f.primer_lead,
  f.ultimo_lead,
  coalesce(nn.negocios, 0)                   as negocios,
  coalesce(vv.ventas, 0)                     as ventas,
  coalesce(vv.honorario, 0)                  as honorario,
  coalesce(vv.recaudado, 0)                  as recaudado,
  (k.campaign_id is null)                    as sin_rastro
from claves k
left join formularios f  on f.workspace_id  = k.workspace_id and f.campaign_id  is not distinct from k.campaign_id and f.mes  = k.mes
left join leads l        on l.workspace_id  = k.workspace_id and l.campaign_id  is not distinct from k.campaign_id and l.mes  = k.mes
left join negocios nn    on nn.workspace_id = k.workspace_id and nn.campaign_id is not distinct from k.campaign_id and nn.mes = k.mes
left join ventas vv      on vv.workspace_id = k.workspace_id and vv.campaign_id is not distinct from k.campaign_id and vv.mes = k.mes
left join gasto g        on g.workspace_id  = k.workspace_id and g.campaign_id  is not distinct from k.campaign_id and g.mes  = k.mes
left join nombre_payload np on np.workspace_id = k.workspace_id and np.campaign_id is not distinct from k.campaign_id;

comment on view public.v_marketing_campana is
  'Campana x mes: leads, negocios, ventas, recaudo y gasto. La lente MES filtra por mes; la COHORTE suma los meses.';

-- Las dos vistas leen `v_venta_mes_comercial`, que no concede nada a `authenticated`
-- y no filtra por workspace: exponerlas al cliente dejaria las ventas de todos los
-- workspaces al alcance de cualquier sesion. Se consultan server-side con el cliente
-- de servicio, con el workspace ya resuelto desde la sesion.
revoke all on public.v_marketing_negocio from anon, authenticated;
revoke all on public.v_marketing_campana from anon, authenticated;
