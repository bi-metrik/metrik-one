-- ============================================================
-- La inactividad pasa a contarse en dias HABILES
--
-- ## EL DEFECTO
--
-- `diasSinActividad` se calculaba en los crons como
-- `(now - ultimaActividad) / 86.400.000`: dias de CALENDARIO. El resto de ONE mide
-- con `horas_habiles_entre`, que descuenta 24 h por cada sabado, domingo y festivo de
-- `festivos_colombia`. Dos relojes distintos para la misma pregunta, y el de la
-- inactividad es el unico que cuenta el fin de semana como trabajo no hecho.
--
-- El umbral de venta son 3 dias. Un negocio trabajado el VIERNES cumple ese umbral el
-- LUNES sin que haya pasado un solo dia habil.
--
-- Medido en produccion el 2026-09-01 (un martes):
--   - El dia de ultima actividad mas frecuente entre los negocios abiertos en venta es
--     el **viernes 2026-08-28**, y **163** de ellos tuvieron su ultima actividad entre
--     ese viernes y el sabado. Todos disparan hoy por el fin de semana.
--   - En venta: **351 de 373 abiertos** superan el umbral con el reloj de calendario;
--     con dias habiles son **180**. Dejan de disparar **171**.
--   - En ejecucion: 48 -> 46.
--   - La diferencia media entre los dos relojes es de **6,6 dias** y llega a 36.
--
-- No es un ajuste fino: es la mitad de los avisos de venta, y son avisos que reclaman
-- trabajo por dias en los que la oficina estaba cerrada.
--
-- ## LA CORRECCION
--
-- El calculo se va a SQL, junto a la definicion de actividad que la migracion anterior
-- unifico. `negocios_ultima_actividad` gana la columna `dias_habiles` y los crons dejan
-- de hacer aritmetica de fechas: piden el numero y comparan. Un solo reloj y un solo
-- lugar donde vive.
--
-- POR QUE `horas_habiles_entre` Y NO `dias_habiles_entre`: la primera es la que sostiene
-- el SLA de etapa de todo el producto y opera sobre marcas de tiempo (una actividad
-- ocurre a una hora concreta); la segunda cuenta dias de calendario habil y existe para
-- plazos legales, donde el dia inicial no cuenta. Aca la pregunta es "cuanto tiempo
-- laborable lleva quieto", que es la primera. La conversion a dias usa el mismo criterio
-- que `sla_horas`: **24 horas habiles = 1 dia habil**.
--
-- ## LOS UMBRALES NO CAMBIAN, Y ESO ES EL PUNTO
--
-- Siguen siendo 3 en venta y 2 en ejecucion, y el escalamiento sigue en 3/5/7/15. Lo
-- que cambia es que ahora significan lo que siempre dijeron: dias de trabajo. En
-- calendario eso alarga cada umbral alrededor de un 40%, y el aviso de los 15 dias
-- ("¿cerrar como perdido?") pasa a caer cerca de las tres semanas corridas. Es
-- deliberado: ese aviso pregunta si el negocio se abandono, y un puente festivo no es
-- abandono.
--
-- ⚠️ LIMITE CONOCIDO: `festivos_colombia` solo tiene 2026 y 2027. Para un negocio cuya
-- ultima actividad sea anterior a 2026, los festivos de ese anio se cuentan como
-- habiles y el numero sale un poco alto. Da igual para un umbral de 3 dias sobre un
-- caso que lleva meses quieto, pero conviene saberlo antes de reusar esta columna para
-- otra cosa.
--
-- Esta migracion no toca ninguna fila de datos.
-- ============================================================

-- `returns table` no admite columnas nuevas con `create or replace` (Postgres lo trata
-- como cambio de tipo de retorno), asi que hay que soltarla y volverla a crear. Va en
-- una sola transaccion, que es como corre toda migracion de Supabase: no hay instante
-- en que la funcion no exista.
--
-- La columna se AGREGA, no reemplaza a ninguna: `ultima_actividad` sigue ahi y con el
-- mismo significado, asi que el codigo ya desplegado sigue leyendo lo que leia.

drop function if exists public.negocios_ultima_actividad(uuid[]);

create function public.negocios_ultima_actividad(p_ids uuid[])
returns table (
  negocio_id uuid,
  ultima_actividad timestamptz,
  dias_habiles integer
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    n.id,
    ultima_actividad_negocio(n.id),
    floor(horas_habiles_entre(ultima_actividad_negocio(n.id), now()) / 24)::integer
  from negocios n
  where n.id = any(p_ids);
$$;

comment on function public.negocios_ultima_actividad(uuid[]) is
  'Por cada negocio: cuando se gestiono por ultima vez y cuantos DIAS HABILES lleva '
  'quieto (horas_habiles_entre / 24, el mismo criterio de sla_horas). La usan los crons '
  'de inactividad, que ya no hacen aritmetica de fechas: el reloj vive aca y en ningun '
  'otro lado, igual que la definicion de actividad.';

revoke execute on function public.negocios_ultima_actividad(uuid[]) from public, anon, authenticated;
grant execute on function public.negocios_ultima_actividad(uuid[]) to service_role;
