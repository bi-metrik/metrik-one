-- La captura de la cotización de viaje: la ranura como entidad, el cargo en destino por
-- opción y los tramos del vuelo (Parte B, bloques B1 a B3, del brief
-- `proyectos/trappvel/clarity/docs/diseno/brief-max-captura-cotizacion-2026-09-23.md`,
-- aprobado por Mauricio el 2026-09-23).
--
-- ⚠️ VA ANTES DEL MERGE, con dry-run primero (`DO … RAISE EXCEPTION`). El código del PR
-- aguanta desplegarse ANTES de esta migración: toda lectura usa `select('*')` (las columnas
-- nuevas llegan `undefined` = «sin ranura», «sin cargo propio», «sin tramos») y toda
-- escritura a lo nuevo tolera `42P01`/`42703`/`PGRST204`/`PGRST205` y sigue como antes. Lo
-- único que no se puede hacer sin ella es guardar la ranura como fila: la cotización sigue
-- agrupando por `items.grupo`, que es lo de hoy.
--
-- ## Qué NO cambia, y por qué no puede cambiar ningún precio
--
-- El motor de tarifas sigue agrupando por `items.grupo` (itinerarios.ts). La ranura es la
-- ENTIDAD que la pantalla nombra, ordena y renombra entera; `grupo` queda como su clave
-- derivada y el código lo mantiene sincronizado en cada escritura. El backfill:
--   · NO toca `items.grupo` de ninguna fila: dos grupos que hoy son dos ranuras siguen
--     siendo dos, aunque se escriban parecido («Hotel» y «hotel»).
--   · crea UNA ranura por cada (cotización, grupo recortado) que resuelve al catálogo
--     (vuelo, hotel, actividad, traslado), con la misma gramática de `resolverRanura`;
--   · deja SIN ranura lo que no resuelve (`avianca bog - adz`, `dia-1`, `seguro`): sigue
--     funcionando exactamente como hoy;
--   · pone `opcion_de = null` solo en las líneas que quedaron DENTRO de una ranura. Las
--     opciones son hermanas: con `opcion_de` y su `on delete cascade`, borrar la primera
--     opción se llevaba a las demás.
-- `opcion_de` no decide el total en ninguna parte (la ranura es el grupo desde el
-- 2026-09-14), así que nulearlo no mueve un peso. Lo mide el SELECT de verificación.
--
-- ## R6
-- Al 2026-09-23 las 17 líneas con grupo en producción son todas de Trappvel. Termotech, Arca
-- y WMC no tienen una sola fila que este backfill toque.

-- ── B1 · la ranura ──────────────────────────────────────────────────────────────

create table if not exists public.cotizacion_ranuras (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  cotizacion_id uuid not null references public.cotizaciones(id) on delete cascade,
  -- El tipo del catálogo (`ranuras-pantallazo.ts`, el primer sinónimo de cada uno).
  tipo text not null check (tipo in ('vuelo', 'hotel', 'actividad', 'traslado')),
  -- Cómo se llama de cara a quien cotiza y en el documento: «Hotel en Cancún». NULL = la
  -- ranura se llama como su tipo («Vuelo»).
  nombre text check (nombre is null or length(btrim(nombre)) between 1 and 120),
  -- El ordinal de la segunda ranura del mismo tipo en adelante («Vuelo 2»). Sobrevive al
  -- renombre: perderlo fundiría dos ranuras en una (ver `siguienteGrupoDeTipo`).
  numero integer check (numero is null or numero >= 2),
  orden integer not null default 0,
  created_at timestamptz not null default now()
);

comment on table public.cotizacion_ranuras is
  'Una ranura de la cotizacion de viaje («Hotel en Cancun», «Vuelo 2»): lo que el cliente compra una vez, con sus opciones HERMANAS (items.ranura_id) que compiten por entrar en cada tarifa. items.grupo es su clave derivada y el motor de tarifas sigue agrupando por el.';

create index if not exists idx_cotizacion_ranuras_cotizacion
  on public.cotizacion_ranuras (cotizacion_id, orden);

alter table public.cotizacion_ranuras enable row level security;

drop policy if exists cotizacion_ranuras_workspace on public.cotizacion_ranuras;
create policy cotizacion_ranuras_workspace on public.cotizacion_ranuras
  for all
  using (workspace_id = (select current_user_workspace_id()))
  with check (workspace_id = (select current_user_workspace_id()));

-- El editor de cotización corre con el cliente authenticated, como `cotizacion_itinerarios`.
grant select, insert, update, delete on public.cotizacion_ranuras to authenticated;

alter table public.items
  add column if not exists ranura_id uuid references public.cotizacion_ranuras(id) on delete set null;

comment on column public.items.ranura_id is
  'La ranura de la que esta linea es una OPCION (hermana de las demas: ninguna es titular). NULL = componente suelto, o linea anterior a las ranuras: ahi manda items.grupo, como siempre.';

create index if not exists idx_items_ranura
  on public.items (ranura_id) where ranura_id is not null;

-- Una línea no puede colgar de la ranura de OTRA cotización. La llave foránea no lo
-- impide (no ve RLS), y una ranura ajena haría que renombrar una movera líneas de otro
-- presupuesto. Con RLS encendida una ranura de otro workspace ni se ve: también rebota.
create or replace function public.items_ranura_de_la_misma_cotizacion()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.ranura_id is not null and not exists (
    select 1 from public.cotizacion_ranuras r
    where r.id = new.ranura_id and r.cotizacion_id = new.cotizacion_id
  ) then
    raise exception 'La ranura % no es de la cotizacion %', new.ranura_id, new.cotizacion_id
      using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Nadie la invoca por RPC: dispararla como trigger no exige EXECUTE (solo crearla).
revoke execute on function public.items_ranura_de_la_misma_cotizacion() from public, anon, authenticated;

drop trigger if exists trg_items_ranura_misma_cotizacion on public.items;
create trigger trg_items_ranura_misma_cotizacion
  before insert or update of ranura_id, cotizacion_id on public.items
  for each row execute function public.items_ranura_de_la_misma_cotizacion();

-- ── B2 · el cargo en destino, por opción ───────────────────────────────────────

alter table public.items
  add column if not exists cargo_destino_valor numeric(14, 2)
    check (cargo_destino_valor is null or cargo_destino_valor > 0),
  add column if not exists cargo_destino_moneda text
    check (cargo_destino_moneda is null or cargo_destino_moneda ~ '^[A-Z]{3}$');

comment on column public.items.cargo_destino_valor is
  'Lo que el viajero paga EN DESTINO por esta opcion (impuestos y tasas de hospedaje), en su moneda local, fuera del precio. Lo escribe la lectura del pantallazo y la correccion de la ficha. NULL = sin cargo propio: el documento lo deriva de la lectura (items.tarifa_pax), como antes.';
comment on column public.items.cargo_destino_moneda is
  'Codigo ISO 4217 del cargo en destino. Va con cargo_destino_valor.';

-- ── B3 · los tramos del vuelo ─────────────────────────────────────────────────────

alter table public.items
  add column if not exists tramos jsonb
    check (tramos is null or jsonb_typeof(tramos) = 'array');

comment on column public.items.tramos is
  'Los trayectos del vuelo (ida y regreso): numero, fecha, salida, llegada, escalas y equipaje, tal como se leyeron (con lo corregido encima). Lo escribe la lectura del pantallazo (tramos-vuelo.ts). NULL = el documento los deriva de la lectura, con la MISMA funcion.';

-- ── Backfill 1 · las ranuras desde `items.grupo` ─────────────────────────────────
--
-- Espejo de `resolverRanura` (src/lib/cotizaciones/ranuras-pantallazo.ts):
--   grupo = tipo [" " numero] [":" nombre], tipo = un sinónimo del catálogo, comparado sin
--   tildes y en minúscula. El grupo ENTERO como sinónimo va primero.
-- Una ranura por (cotización, grupo recortado): es exactamente la clave con la que el motor
-- agrupa hoy (`normalizarGrupo`), así que ninguna ranura se parte ni se funde.
--
-- Idempotente: (a) una línea sin ranura cuyo grupo ya tiene ranura en su cotización se
-- cuelga de esa; (b) solo se crean ranuras para lo que quede sin resolver. Correrla dos
-- veces no crea nada la segunda.
--
-- Tablas temporales SIN `on commit drop`: así funciona igual dentro de una transacción
-- (dry-run) que sentencia por sentencia. Se borran al final.

-- (a) Líneas nuevas de un grupo que ya tiene ranura.
update public.items i
set ranura_id = hermana.ranura_id
from public.items hermana
where i.ranura_id is null
  and i.grupo is not null
  and coalesce(i.es_ajuste, false) = false
  and hermana.ranura_id is not null
  and hermana.cotizacion_id = i.cotizacion_id
  and btrim(hermana.grupo, E' \t\r\n') = btrim(i.grupo, E' \t\r\n');

-- (b) Lo que queda: se resuelve con la gramática.
drop table if exists _ranuras_backfill;
create temporary table _ranuras_backfill as
with sinonimos(clave, tipo) as (
  values
    ('vuelo', 'vuelo'), ('vuelos', 'vuelo'), ('aereo', 'vuelo'), ('tiquete', 'vuelo'), ('tiquetes', 'vuelo'),
    ('hotel', 'hotel'), ('hoteles', 'hotel'), ('alojamiento', 'hotel'), ('hospedaje', 'hotel'),
    ('actividad', 'actividad'), ('actividades', 'actividad'), ('tour', 'actividad'), ('tours', 'actividad'),
    ('excursion', 'actividad'),
    ('traslado', 'traslado'), ('traslados', 'traslado'), ('transfer', 'traslado'), ('transfers', 'traslado'),
    ('transporte', 'traslado')
),
lineas as (
  select
    i.id,
    i.cotizacion_id,
    c.workspace_id,
    coalesce(i.orden, 0) as orden,
    btrim(i.grupo, E' \t\r\n') as grupo
  from public.items i
  join public.cotizaciones c on c.id = i.cotizacion_id
  where i.grupo is not null
    and btrim(i.grupo, E' \t\r\n') <> ''
    and i.ranura_id is null
    and coalesce(i.es_ajuste, false) = false
),
partes as (
  select
    l.*,
    case when position(':' in l.grupo) > 0
      then btrim(substr(l.grupo, 1, position(':' in l.grupo) - 1), E' \t\r\n')
      else l.grupo end as cabeza,
    case when position(':' in l.grupo) > 0
      then btrim(substr(l.grupo, position(':' in l.grupo) + 1), E' \t\r\n')
      else '' end as libre
  from lineas l
),
resueltas as (
  select
    p.id, p.cotizacion_id, p.workspace_id, p.orden, p.grupo,
    coalesce(directa.tipo, gramatica.tipo) as tipo,
    case when directa.tipo is not null then null else gramatica.numero end as numero,
    case when directa.tipo is not null or p.libre = '' then null else p.libre end as nombre
  from partes p
  left join sinonimos directa
    on directa.clave = lower(translate(p.grupo, 'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç',
                                                'aaaaeeeeiiiioooouuuuncaaaaeeeeiiiioooouuuunc'))
  left join lateral (
    select
      s.tipo,
      case when x.m is null then null else x.m[2]::int end as numero
    from (select regexp_match(p.cabeza, '^(.+?)\s+(\d+)$') as m) x
    join sinonimos s
      on s.clave = lower(translate(btrim(coalesce(x.m[1], p.cabeza), E' \t\r\n'),
                                   'ÁÀÄÂÉÈËÊÍÌÏÎÓÒÖÔÚÙÜÛÑÇáàäâéèëêíìïîóòöôúùüûñç',
                                   'aaaaeeeeiiiioooouuuuncaaaaeeeeiiiioooouuuunc'))
    where p.cabeza <> ''
  ) gramatica on true
)
select * from resueltas where tipo is not null;

-- El id de cada ranura nueva se decide ANTES de insertarla: así cada línea se cuelga de la
-- suya por (cotización, grupo), sin tener que reconocerla después por sus columnas.
drop table if exists _ranuras_nuevas;
create temporary table _ranuras_nuevas as
select
  gen_random_uuid() as ranura_id,
  b.workspace_id,
  b.cotizacion_id,
  b.grupo,
  min(b.tipo) as tipo,
  min(b.nombre) as nombre,
  -- `numero` < 2 no es ordinal (la primera va sin número): el CHECK lo rechazaría.
  case when min(b.numero) >= 2 then min(b.numero) else null end as numero,
  min(b.orden) as orden
from _ranuras_backfill b
group by b.workspace_id, b.cotizacion_id, b.grupo;

insert into public.cotizacion_ranuras (id, workspace_id, cotizacion_id, tipo, nombre, numero, orden)
select ranura_id, workspace_id, cotizacion_id, tipo, nombre, numero, orden
from _ranuras_nuevas;

update public.items i
set ranura_id = n.ranura_id
from _ranuras_backfill b
join _ranuras_nuevas n on n.cotizacion_id = b.cotizacion_id and n.grupo = b.grupo
where i.id = b.id
  and i.ranura_id is null;

drop table if exists _ranuras_nuevas;
drop table if exists _ranuras_backfill;

-- Las opciones son hermanas: ninguna cuelga de otra (ver la cabecera).
update public.items
set opcion_de = null
where ranura_id is not null
  and opcion_de is not null;

-- ── Backfill 2 · el cargo en destino desde la lectura ─────────────────────────────
--
-- Espejo conservador de `cargoDeLectura` (src/lib/cotizaciones/cargo-destino.ts): la
-- lectura del pantallazo (`tarifa_pax.casillas`, la del grupo completo o la primera que
-- haya) con la corrección de la ficha encima. Una corrección vacía BORRA el dato, igual que
-- `aplicarCorrecciones`. La moneda es la del cargo, sin caer a la de la captura (el
-- documento tampoco la supone). El monto pasa por la regla de `parseMontoCop`, pero SOLO en
-- las formas sin ambigüedad; cualquier otra queda en NULL y el documento la sigue derivando
-- de la lectura con el normalizador de verdad. Idempotente: solo llena lo que está en NULL.

with lecturas as (
  select
    i.id,
    coalesce(i.tarifa_pax -> 'casillas' -> 'grupo_completo',
             i.tarifa_pax -> 'casillas' -> 'sin_infantes',
             i.tarifa_pax -> 'casillas' -> 'solo_adultos') as casilla,
    case when jsonb_typeof(i.tarifa_pax -> 'correcciones') = 'object'
      then i.tarifa_pax -> 'correcciones' else '{}'::jsonb end as corr
  from public.items i
  where i.tarifa_pax is not null
    and i.cargo_destino_valor is null
),
crudos as (
  select
    l.id,
    case when l.corr ? 'impuestos_destino_valor'
      then nullif(btrim(l.corr -> 'impuestos_destino_valor' ->> 'valor'), '')
      else (select btrim(regexp_replace(c ->> 'valor', '\s*\(del viaje\)$', ''))
            from jsonb_array_elements(case when jsonb_typeof(l.casilla -> 'campos') = 'array'
                                           then l.casilla -> 'campos' else '[]'::jsonb end) c
            where c ->> 'label' = 'Impuestos en destino' limit 1)
    end as valor,
    upper(btrim(
      case when l.corr ? 'impuestos_destino_moneda'
        then nullif(btrim(l.corr -> 'impuestos_destino_moneda' ->> 'valor'), '')
        else (select regexp_replace(c ->> 'valor', '\s*\(del viaje\)$', '')
              from jsonb_array_elements(case when jsonb_typeof(l.casilla -> 'campos') = 'array'
                                             then l.casilla -> 'campos' else '[]'::jsonb end) c
              where c ->> 'label' = 'Moneda de los impuestos en destino' limit 1)
      end
    )) as moneda
  from lecturas l
),
montos as (
  select
    id,
    moneda,
    case
      when valor ~ '^\d+$' then valor::numeric
      when valor ~ '^\d{1,3}(\.\d{3})+$' then replace(valor, '.', '')::numeric
      when valor ~ '^\d{1,3}(,\d{3})+$' then replace(valor, ',', '')::numeric
      when valor ~ '^\d+[.,]\d{1,2}$' then replace(valor, ',', '.')::numeric
      else null
    end as valor
  from crudos
  where valor is not null
)
update public.items i
set cargo_destino_valor = m.valor,
    cargo_destino_moneda = case when m.moneda ~ '^[A-Z]{3}$' then m.moneda else null end
from montos m
where i.id = m.id
  and m.valor is not null
  and m.valor > 0
  and i.cargo_destino_valor is null;

-- ── Backfill 3 · los tramos: NO se hace en SQL, a propósito ──────────────────────
--
-- Repartir los números de vuelo entre ida y regreso («9459, 4867, 9842, 9488» con una
-- escala) es la regla de `numerosDeVuelo`, y copiarla aquí es tener dos versiones de una
-- regla que imprime el documento. `items.tramos` nace NULL en las líneas existentes y el
-- código los deriva de la MISMA lectura con la MISMA función que los escribe al leer
-- (`tramosDeLinea`): el documento sale idéntico. Se llenan solos al volver a leer o al
-- corregir la ficha.
