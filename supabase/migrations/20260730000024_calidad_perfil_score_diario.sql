-- El perfil del agente pasa de un punto por LLAMADA a un punto por DIA.
--
-- La dispersion por llamada no se entendia, y el diagnostico es que el problema
-- no era el dibujo: una llamada suelta no dice nada del agente. Puede salir mal
-- por el cliente que le toco. Lo que se quiere responder es "como viene esta
-- persona", y esa pregunta se contesta con el dia como unidad, no con la
-- llamada.
--
-- ── Que es el score del dia ─────────────────────────────────────────────────
--
--   score = promedio de tecnica del dia  -  penalizacion por criticas
--   penalizacion = min(10, 10 * criticas / llamadas)
--
-- Dos ejes en un numero, y esto merece explicacion porque el producto YA
-- intento algo parecido y lo revirtio: hasta la v4 hubo un semaforo unico que
-- fundia tecnica y banderas, y "agregado a un dia entero dejaba a casi todos en
-- rojo". Por que esto no repite aquel error:
--
--   1. Aquel era un semaforo de TRES estados. Al agregarlo, casi todo caia en
--      el peor y la columna dejaba de ordenar. Este es continuo: conserva el
--      orden entre dias y entre agentes.
--   2. La penalizacion es proporcional y esta CAPADA en 10 puntos sobre 100.
--      Un mal dia de cumplimiento se ve, pero no borra la ejecucion ni manda
--      el score al piso.
--
-- Que la penalizacion sea por TASA (criticas/llamadas) y no por conteo es
-- deliberado: si fuera por conteo, el dia de mas trabajo seria siempre el peor
-- dia, y el score castigaria producir.
--
-- El caso que justifica meter las criticas, con datos reales de Advise (Andres
-- Villamil, 14 de julio): tecnica 67,1 (de sus mejores dias) con 8 criticas en
-- 8 llamadas. Solo con tecnica ese dia se pinta como bueno. Con el score baja a
-- 57,1 y se ve lo que fue: ejecuto bien y expuso a la empresa en cada llamada.
--
-- ── Por que ademas hace falta `suave` ───────────────────────────────────────
--
-- El volumen diario es MUY desigual: el mismo agente va de 1 a 12 llamadas por
-- dia (promedio 5,6). El 12 de julio hizo 2 llamadas y promedio 82, su mejor
-- marca del mes; el 13 hizo 1 y promedio 53. Unir esos puntos dibuja un
-- derrumbe de 29 puntos que NO ocurrio: es azar de dos muestras chicas.
--
-- Por eso cada dia trae tambien `llamadas` (la pantalla dibuja el punto mas
-- grande cuanto mas llamadas tiene, para que se vea cual es confiable) y
-- `suave`: media movil de 7 dias PONDERADA POR LLAMADAS, que es lo mismo que
-- promediar todas las llamadas de la ventana. Un dia de 1 llamada casi no la
-- mueve; uno de 12 la manda.
--
-- La ventana mira hacia atras (dia actual y los 6 previos), no centrada: la
-- linea responde "como viene", y una media centrada usaria dias posteriores
-- para dibujar el punto de hoy.
--
-- Se AMPLIA la funcion con la clave `dias`. `puntos` (una fila por llamada) se
-- CONSERVA: la pantalla lo sigue usando para abrir las llamadas de un dia al
-- hacer clic, y quitarlo romperia el consumidor desplegado.
--
-- ⚠️ DEUDA CONOCIDA, no la paga esta migracion: este perfil resuelve al agente
-- por `agente_nombre = p_agente`, o sea por TEXTO. El ranking ya se corrigio
-- para agrupar por `agente_staff_id` (ver 20260730000021). Con dos homonimos
-- reales, el ranking los separa y este perfil los MEZCLA. Arreglarlo toca el
-- slug de la ruta `/calidad/agente/[slug]`, que es otro frente.

create or replace function public.get_calidad_perfil_agente(
  p_workspace_id uuid,
  p_agente       text,
  p_desde        date,
  p_hasta        date
)
returns jsonb
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select
      l.id, l.cliente_ref, l.fecha_hora,
      (l.fecha_hora at time zone 'America/Bogota')::date as dia,
      l.puntaje_tecnico, l.semaforo, l.cerro_venta, l.detalle_completo, l.monto_usd,
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
  -- Criticas POR DIA, para el score diario.
  criticas_dia as (
    select b.dia, count(*) as n
    from calidad_llamadas_hallazgos h
    join base b on b.id = h.llamada_id
    where h.eje = 'cumplimiento' and h.severidad = 'critica'
    group by b.dia
  ),
  dia_agg as (
    select
      b.dia,
      count(*)                             as llamadas,
      round(avg(b.puntaje_tecnico), 1)     as tecnica,
      coalesce(max(c.n), 0)::int           as criticas,
      count(*) filter (where b.cerro_venta) as cierres
    from base b
    left join criticas_dia c on c.dia = b.dia
    group by b.dia
  ),
  dia_score as (
    select
      d.*,
      -- Capada en 10: un mal dia de cumplimiento se ve, no arrasa.
      round(least(10.0, 10.0 * d.criticas / d.llamadas), 1)                     as penalizacion,
      round(greatest(0, d.tecnica - least(10.0, 10.0 * d.criticas / d.llamadas)), 1) as score
    from dia_agg d
  ),
  -- Media movil de 7 dias ponderada por llamadas = promedio de todas las
  -- llamadas de la ventana. Se calcula aqui y no en la pantalla para que la
  -- linea y los puntos salgan de la misma fuente.
  dia_suave as (
    select
      s.*,
      round(
        sum(s.score * s.llamadas) over w / nullif(sum(s.llamadas) over w, 0)
      , 1) as suave
    from dia_score s
    window w as (order by s.dia range between interval '6 days' preceding and current row)
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
    -- La serie que dibuja la pantalla: un punto por dia.
    'dias', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'dia',          dia,
          'llamadas',     llamadas,
          'tecnica',      tecnica,
          'criticas',     criticas,
          'cierres',      cierres,
          'penalizacion', penalizacion,
          'score',        score,
          'suave',        suave
        ) order by dia
      ) from dia_suave
    ), '[]'::jsonb),
    -- Se conserva: alimenta el detalle de las llamadas de un dia.
    'puntos', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', id, 'ref', cliente_ref,
          'fecha', to_char(fecha_hora at time zone 'America/Bogota', 'YYYY-MM-DD"T"HH24:MI'),
          'dia', dia, 'tecnica', puntaje_tecnico, 'semaforo', semaforo,
          'cerroVenta', cerro_venta, 'detalle', detalle_completo
        ) order by fecha_hora
      ) from base
    ), '[]'::jsonb),
    -- La tendencia se calcula ahora sobre el SCORE DIARIO ponderado por
    -- llamadas, no sobre la llamada suelta: es la recta de la serie que se ve.
    -- Antes regresionaba punto-por-llamada, asi que la recta y el dibujo
    -- hablaban de cosas distintas.
    'tendencia', (
      select jsonb_build_object(
        'n',         coalesce(count(*), 0),
        'porSemana', case when count(*) >= 3
                          then round((regr_slope(score, extract(epoch from dia) / 86400.0) * 7)::numeric, 1)
                          else null end,
        't', case
               when count(*) >= 3
                and regr_sxx(score, extract(epoch from dia) / 86400.0) > 0
                and (regr_syy(score, extract(epoch from dia) / 86400.0)
                     - regr_slope(score, extract(epoch from dia) / 86400.0)
                     * regr_slope(score, extract(epoch from dia) / 86400.0)
                     * regr_sxx(score, extract(epoch from dia) / 86400.0)) > 0
               then round((
                 regr_slope(score, extract(epoch from dia) / 86400.0) / sqrt(
                   (regr_syy(score, extract(epoch from dia) / 86400.0)
                    - regr_slope(score, extract(epoch from dia) / 86400.0)
                    * regr_slope(score, extract(epoch from dia) / 86400.0)
                    * regr_sxx(score, extract(epoch from dia) / 86400.0))
                   / ((count(*) - 2) * regr_sxx(score, extract(epoch from dia) / 86400.0))
                 ))::numeric, 2)
               else null
             end,
        'primeraMitad', round(avg(score) filter (where dia <  (p_desde + (p_hasta - p_desde) / 2))),
        'segundaMitad', round(avg(score) filter (where dia >= (p_desde + (p_hasta - p_desde) / 2)))
      ) from dia_score
    ),
    'bloques', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'orden', orden, 'nombre', nombre,
          'promedio', round(promedio, 1), 'maximo', maximo,
          'enJuego', round(maximo - promedio, 1),
          'pctLogro', case when maximo > 0 then round(100.0 * promedio / maximo) else 0 end,
          'llamadas', llamadas
        ) order by (maximo - promedio) desc, orden
      ) from (
        select b.orden, min(b.nombre) as nombre, avg(b.puntaje) as promedio,
               max(b.puntaje_max) as maximo, count(*) as llamadas
        from calidad_llamadas_bloques b
        join base ba on ba.id = b.llamada_id
        group by b.orden
      ) bl
    ), '[]'::jsonb)
  );
$function$;
