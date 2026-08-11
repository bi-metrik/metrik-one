-- Cardumen: la vista publica pasa a LISTA BLANCA por estudio y por clave.
--
-- POR QUE (medido el 2026-08-11 contra produccion, no leido del codigo):
--
-- 1. `v_cardumen_live` NO filtraba por estudio: `select ... from cardumen_respuestas`
--    completo. Todo estudio nuevo nacia visible en la vista que alimenta el teatro
--    publico. Es el mismo defecto que este repo ya documento con los grants: un
--    default que concede no es una convencion, es una intencion.
--
-- 2. Su anonimizacion (`payload - 'narrative'`) NO limpia el formato que tiene los
--    datos. Conteo de claves de payload por estudio:
--      - `turismo`  151 respuestas (mini-web): claves `answers`, `collection_mode`,
--        `source`. **Ninguna se llama `narrative`**, asi que el `-` no quitaba nada
--        y las 151 narrativas viajaban completas dentro de `answers`.
--      - `fede`       3 respuestas (chat R1/R2): ahi si existe `narrative`, pero
--        `capaA[*].verbatim` y `capaB[*].quote` son CITAS TEXTUALES y quedaban dentro.
--    O sea que la unica limpieza que hacia la vista era la que menos falta hacia.
--
-- 3. Entra material identificable. El estudio `trappvel-equipo` son DOS personas del
--    equipo de un cliente, a cada una se le prometio que aprueba que se comparte, y
--    con n=2 un verbatim identifica a quien lo dijo.
--
-- DISENO: lista blanca en dos niveles, porque una lista negra obliga a adivinar que
-- clave guarda texto libre en cada formato, y ya fallo una vez.
--   (a) el estudio se declara `publicable`;
--   (b) se declara QUE claves del payload son publicables (`claves_publicas`).
-- Un estudio que no esta en la tabla, o que no declara claves, NO sale. El default
-- es no publicar.
--
-- SEGURIDAD SIN CAMBIOS: `v_cardumen_live` sigue siendo la misma vista (owner
-- postgres, sin `security_invoker`), asi que resuelve el join y la funcion con los
-- permisos del owner y no hace falta conceder nada a `anon` sobre las tablas nuevas.
--
-- IMPACTO HOY: la vista queda devolviendo CERO filas, y eso no rompe nada.
-- Verificado: ningun consumidor la referencia en el repo de ONE (solo comentarios de
-- migraciones), y el teatro en produccion (spike-teatro) lee un snapshot estatico en
-- `data/`, no esta vista. El pipeline vivo todavia no esta cableado. Cuando se cablee,
-- publicar un estudio es un INSERT declarado, no un olvido.

-- 1. Catalogo de estudios publicables ------------------------------------------------
create table if not exists public.cardumen_estudios (
  estudio          text primary key,
  publicable       boolean not null default false,
  claves_publicas  text[]  not null default '{}',
  nota             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.cardumen_estudios is
  'Cardumen: que estudios pueden salir en la vista publica y con que claves de payload. Default: no publicable.';
comment on column public.cardumen_estudios.claves_publicas is
  'Claves del payload que SI se publican. Admite un nivel de anidamiento con punto: "answers.Q3". Vacio = no se publica nada.';

alter table public.cardumen_estudios enable row level security;

-- server-only: catalogo de control que solo consume la vista (owner postgres) y los
-- scripts de MeTRIK con service_role. Ningun cliente lo lee ni lo escribe.
revoke all on public.cardumen_estudios from anon, authenticated;

-- 2. Poda de texto de la persona, a cualquier profundidad (segunda capa) --------------
--
-- POR QUE hace falta ademas de la lista blanca: la lista blanca declara CLAVES, y una
-- clave declarada puede traer citas textuales adentro. Comprobado en el ensayo: al
-- declarar `capaA` (nivel 1) para el estudio `fede`, el payload salio con el `verbatim`
-- completo de las 10 dimensiones. Declarar la clave equivocada es un error de una sola
-- palabra; esta poda lo hace inofensivo.
--
-- Es lista negra, y a proposito: aqui la lista negra es correcta porque el formato de
-- R2 nombra siempre igual los campos que guardan las palabras de la persona.
create or replace function public.cardumen_poda_textual(v jsonb)
returns jsonb
language plpgsql
immutable
set search_path = public
as $$
declare
  -- Campos que contienen texto de la persona en el formato de R2 / la mini-web.
  -- Ampliar aqui si aparece un formato nuevo con otro nombre.
  prohibidas text[] := array[
    'verbatim',          -- CapaAPlacement.verbatim: cita que ancla la colocacion
    'quote',             -- capaB[].quote: cita textual
    'micro_narrative',   -- capaB[].micro_narrative: sintesis del por que, en sus palabras
    'narrative',         -- narrativa completa
    'closing',           -- respuestas a las preguntas de cierre
    'raw_history',       -- respaldo de la conversacion cuando R2 falla
    'reflexivity_log',   -- notas del entrevistador, turno por turno
    'history'            -- transcripcion
  ];
begin
  return case jsonb_typeof(v)
    when 'object' then coalesce((
      select jsonb_object_agg(e.k, public.cardumen_poda_textual(e.val))
      from jsonb_each(v) as e(k, val)
      where not (e.k = any (prohibidas))
    ), '{}'::jsonb)
    when 'array' then coalesce((
      select jsonb_agg(public.cardumen_poda_textual(el))
      from jsonb_array_elements(v) el
    ), '[]'::jsonb)
    else v
  end;
end;
$$;

comment on function public.cardumen_poda_textual(jsonb) is
  'Quita, a cualquier profundidad, los campos que contienen texto de la persona (verbatim, quote, micro_narrative, narrative, closing, historial). Segunda capa sobre la lista blanca.';

revoke execute on function public.cardumen_poda_textual(jsonb) from public, anon, authenticated;

-- 3. Limpieza del payload por lista blanca -------------------------------------------
create or replace function public.cardumen_payload_publico(p jsonb, claves text[])
returns jsonb
language sql
immutable
set search_path = public
as $$
  with partes as (
    select split_part(k, '.', 1) as raiz,
           nullif(split_part(k, '.', 2), '') as hoja
    from unnest(coalesce(claves, '{}')) as k
  ),
  -- claves de primer nivel; si de esa misma raiz tambien se declaro una subclave,
  -- manda la subclave (declarar "answers" y "answers.Q3" a la vez publicaria todo
  -- answers, que es justo lo que la lista blanca viene a evitar).
  planas as (
    select raiz, p -> raiz as valor
    from partes
    where hoja is null
      and raiz not in (select raiz from partes where hoja is not null)
  ),
  -- claves "raiz.hoja", reagrupadas bajo su raiz para que el payload conserve su forma
  anidadas as (
    select raiz,
           jsonb_object_agg(hoja, p -> raiz -> hoja)
             filter (where p -> raiz -> hoja is not null) as valor
    from partes
    where hoja is not null
    group by raiz
  )
  select public.cardumen_poda_textual(
    coalesce(jsonb_object_agg(raiz, valor), '{}'::jsonb)
  )
  from (select raiz, valor from planas union all select raiz, valor from anidadas) t
  where valor is not null;
$$;

comment on function public.cardumen_payload_publico(jsonb, text[]) is
  'Devuelve solo las claves declaradas del payload (lista blanca; soporta "a.b" para un nivel) y despues poda el texto de la persona a cualquier profundidad. Lo que no se declara no sale, y lo declarado sale sin citas.';

-- La funcion solo la invoca la vista (owner postgres). Convencion de ONE: revocar
-- EXECUTE a PUBLIC explicitamente, porque el default de PostgreSQL lo concede y
-- `ALTER DEFAULT PRIVILEGES` no lo alcanza.
revoke execute on function public.cardumen_payload_publico(jsonb, text[]) from public, anon, authenticated;

-- 4. La vista, ahora con lista blanca -------------------------------------------------
drop view if exists public.v_cardumen_live;

create view public.v_cardumen_live as
select
  r.id,
  r.estudio,
  r.created_at,
  r.lang,
  public.cardumen_payload_publico(r.payload, e.claves_publicas) as payload
from public.cardumen_respuestas r
join public.cardumen_estudios e
  on e.estudio = r.estudio
 and e.publicable
where e.claves_publicas <> '{}';

comment on view public.v_cardumen_live is
  'Vista publica de Cardumen. Solo estudios declarados publicables, y solo las claves de payload declaradas. Un estudio nuevo NO sale hasta declararlo.';

-- 5. Registro de los estudios que ya existen, todos SIN publicar ----------------------
-- Quedan inventariados para que se vea que existen y que estan sin publicar; publicarlos
-- es una decision de Saga (owner de Cardumen) y exige declarar las claves.
insert into public.cardumen_estudios (estudio, publicable, claves_publicas, nota)
values
  ('turismo',          false, '{}', 'Araucania, mini-web (151 respuestas). La narrativa vive dentro de answers: al publicar, declarar solo las claves de triadas/diadas.'),
  ('fede',             false, '{}', 'FEDE, chat R1/R2 (3 respuestas de prueba). capaA[*].verbatim y capaB[*].quote son citas textuales: no publicarlas.'),
  ('araucania-turismo',false, '{}', 'Slug del study-spec del chat para Araucania.'),
  ('trappvel-equipo',  false, '{}', 'PRIVADO POR DISENO. n=2, equipo de un cliente, con compromiso de validacion previa por cada persona. Nunca publicable.')
on conflict (estudio) do nothing;
