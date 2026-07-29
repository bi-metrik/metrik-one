-- Perfil de agente: como viene, hacia donde va y donde entrenar.
--
-- La pantalla responde dos preguntas, y las dos salen de aqui:
--
--   ¿este agente esta mejorando o empeorando?  → `puntos` + `tendencia`
--   ¿que tiene que hacer para subir?           → `bloques`
--
-- LOS DOS EJES NO SE PROMEDIAN, tampoco aqui. El score es el `puntaje_tecnico`
-- que ya existe (0-100); el cumplimiento viaja aparte, por llamada, para que la
-- pantalla lo pinte como color del punto. Meterlo dentro del score seria
-- fabricar un numero que no significa nada: una llamada de 84 con una bandera
-- critica no es "una de 70".
--
-- LA TENDENCIA SALE DEL DATO, no de un umbral escrito a mano. Se calcula la
-- regresion del puntaje contra el tiempo y se compara la pendiente con SU
-- PROPIO error estandar (el estadistico t). Un umbral fijo del tipo "si sube
-- mas de 3 puntos va al alza" es una opinion disfrazada: 3 puntos son mucho en
-- un agente parejo y ruido en uno errativo. Con el t, "al alza" significa que
-- la subida es mayor que la dispersion del propio agente, que es lo unico que
-- se puede afirmar de verdad.
create or replace function public.get_calidad_perfil_agente(
  p_workspace_id uuid,
  p_agente       text,
  p_desde        date,
  p_hasta        date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      l.id,
      l.cliente_ref,
      l.fecha_hora,
      (l.fecha_hora at time zone 'America/Bogota')::date as dia,
      l.puntaje_tecnico,
      l.semaforo,
      l.cerro_venta,
      l.detalle_completo,
      -- Eje X de la regresion: dias desde el inicio del periodo.
      extract(epoch from (l.fecha_hora at time zone 'America/Bogota')) / 86400.0 as x
    from calidad_llamadas l
    where l.workspace_id = p_workspace_id
      and l.agente_nombre = p_agente
      and (l.fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  ),
  criticas as (
    select count(*) as n
    from calidad_llamadas_hallazgos h
    join base b on b.id = h.llamada_id
    where h.eje = 'cumplimiento' and h.severidad = 'critica'
  ),
  reg as (
    -- regr_* ignora filas nulas y necesita al menos 3 puntos para que el error
    -- estandar tenga sentido (n-2 en el denominador).
    select
      regr_slope(puntaje_tecnico, x)  as pendiente,
      regr_count(puntaje_tecnico, x)  as n,
      regr_sxx(puntaje_tecnico, x)    as sxx,
      regr_syy(puntaje_tecnico, x)    as syy
    from base
  ),
  mitades as (
    -- Comparacion de mitades, para decirlo en palabras humanas ("subio 6
    -- puntos"). Es el mismo hecho que la pendiente, contado de otra forma.
    select
      avg(puntaje_tecnico) filter (where dia <  (p_desde + (p_hasta - p_desde) / 2)) as primera,
      avg(puntaje_tecnico) filter (where dia >= (p_desde + (p_hasta - p_desde) / 2)) as segunda
    from base
  ),
  bloques as (
    select
      b.orden,
      min(b.nombre)             as nombre,
      avg(b.puntaje)            as promedio,
      max(b.puntaje_max)        as maximo,
      count(*)                  as llamadas
    from calidad_llamadas_bloques b
    join base ba on ba.id = b.llamada_id
    group by b.orden
  )
  select jsonb_build_object(
    'agente', p_agente,
    'desde', p_desde,
    'hasta', p_hasta,

    'kpis', (
      select jsonb_build_object(
        'llamadas',  count(*),
        'tecnica',   coalesce(round(avg(puntaje_tecnico)), 0),
        'cierres',   count(*) filter (where cerro_venta),
        -- Lo vendido sale de `monto_usd` de las MISMAS llamadas, que es de
        -- donde lo saca el ranking del muro. Un agente comercial se mide
        -- tambien por lo que cierra; sin esta cifra el perfil parece un
        -- expediente de auditoria y no el panorama de su desempeño.
        'vendidoUsd', coalesce(sum(monto_usd) filter (where cerro_venta), 0),
        'pctCierre', case when count(*) > 0
                          then round(100.0 * count(*) filter (where cerro_venta) / count(*))
                          else 0 end,
        'criticas',  (select n from criticas),
        'verde',     count(*) filter (where semaforo = 'verde'),
        'amarillo',  count(*) filter (where semaforo = 'amarillo'),
        'rojo',      count(*) filter (where semaforo = 'rojo')
      ) from base
    ),

    -- Una llamada = un punto. Sin agrupar por dia: promediar el dia esconde
    -- justo lo que la dispersion tiene que mostrar, que es cuanto varia el
    -- mismo agente entre una llamada y la siguiente.
    'puntos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',        id,
          'ref',       cliente_ref,
          'fecha',     to_char(fecha_hora at time zone 'America/Bogota', 'YYYY-MM-DD"T"HH24:MI'),
          'dia',       dia,
          'tecnica',   puntaje_tecnico,
          'semaforo',  semaforo,
          'cerroVenta', cerro_venta,
          'detalle',   detalle_completo
        ) order by fecha_hora
      ) from base
    ), '[]'::jsonb),

    'tendencia', (
      select jsonb_build_object(
        'n', coalesce(r.n, 0),
        -- Puntos por semana: "0,4 al dia" no se le dice a nadie.
        'porSemana', case when r.n >= 3 then round((r.pendiente * 7)::numeric, 1) else null end,
        -- t = pendiente / error estandar. |t| >= 2 ≈ 95% de confianza.
        't', case
               when r.n >= 3 and r.sxx > 0 and (r.syy - r.pendiente * r.pendiente * r.sxx) > 0
               then round(
                      (r.pendiente / sqrt(
                        (r.syy - r.pendiente * r.pendiente * r.sxx) / ((r.n - 2) * r.sxx)
                      ))::numeric, 2)
               -- Ajuste perfecto (sin residuo): la pendiente es lo que es.
               when r.n >= 3 and r.sxx > 0 then null
               else null
             end,
        'primeraMitad', (select round(primera) from mitades),
        'segundaMitad', (select round(segunda) from mitades)
      ) from reg r
    ),

    -- Ordenados por PUNTOS EN JUEGO (maximo - promedio), no por porcentaje de
    -- logro: subir Descubrimiento de 18 a 25 vale 7 puntos del score y subir
    -- Cierre de 6 a 10 vale 4, aunque el segundo se vea "peor" en porcentaje.
    -- La recomendacion tiene que ir donde mas score hay que ganar.
    'bloques', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orden',      orden,
          'nombre',     nombre,
          'promedio',   round(promedio, 1),
          'maximo',     maximo,
          'enJuego',    round(maximo - promedio, 1),
          'pctLogro',   case when maximo > 0 then round(100.0 * promedio / maximo) else 0 end,
          'llamadas',   llamadas
        ) order by (maximo - promedio) desc, orden
      ) from bloques
    ), '[]'::jsonb)
  );
$$;

revoke execute on function public.get_calidad_perfil_agente(uuid, text, date, date) from public;
revoke execute on function public.get_calidad_perfil_agente(uuid, text, date, date) from anon;
grant  execute on function public.get_calidad_perfil_agente(uuid, text, date, date) to authenticated;
grant  execute on function public.get_calidad_perfil_agente(uuid, text, date, date) to service_role;

-- Indice para el perfil: el filtro es (workspace, agente, fecha).
create index if not exists idx_calidad_llamadas_ws_agente_fecha
  on public.calidad_llamadas(workspace_id, agente_nombre, fecha_hora desc);
