-- ============================================================
-- Cardumen en el numero de ONE: mensajes, conversaciones, tope de Meta y costo de modelo
-- ------------------------------------------------------------
-- SOLO LECTURA. Se corre por el MCP de Supabase (execute_sql) contra yfjqscvvxetobiidnepa.
-- Mes en hora de Bogota.
--
-- De donde sale cada cosa (la marca la pone `_shared/cardumen/telemetria.ts`):
--   - Mensajes: `wa_envios` con `intent like 'cardumen:%'` (origen sigue siendo 'bot': el
--     CHECK de la tabla no admite 'cardumen'). ONE = todo lo demas.
--   - Tokens: `wa_message_log` con `intent like 'cardumen:%'`, una fila por llamada al modelo.
--     La columna se llama `gemini_model` pero guarda el modelo que haya sido: el motor R1/R2
--     corre en Claude Haiku 4.5 y el lector de Navigate en Gemini 3.1 Flash-Lite.
--
-- ⚠️ Solo cuenta desde el despliegue de este cambio (wa-webhook y cardumen-cron). Antes, los
--    envios de Cardumen estan en `wa_envios` con intent NULL, mezclados con ONE, y no hay
--    forma de separarlos.
-- ⚠️ No entra la transcripcion de audios (wa-transcribe.ts, tambien Gemini): corre en el
--    webhook antes del motor y no devuelve uso. Tampoco el chat de Voz de Venezuela, que es
--    otro motor (`_shared/venezuela/`) sobre el mismo numero y sigue sin marca.
--
-- Tope de Meta: desde el 2026-10-01 los mensajes de SERVICIO (texto libre dentro de la
-- ventana de 24 h) se cobran pasados 1.000 al mes POR NUMERO. Las plantillas se facturan
-- aparte y no cuentan aqui. Se cuentan los envios que Meta acepto (con wamid) y no fallo.
--
-- Precios de modelo (USD por 1M tokens, nivel pago, texto), consultados el 2026-09-24:
--   gemini-3.1-flash-lite  entrada 0,25 · salida 1,50 (salida incluye pensamiento)
--   gemini-2.5-flash-lite  entrada 0,10 · salida 0,40
--     https://ai.google.dev/gemini-api/docs/pricing  ("Last updated 2026-09-24 UTC")
--   claude-haiku-4-5       entrada 1,00 · salida 5,00
--     https://platform.claude.com/docs/en/about-claude/pricing
-- Un modelo que no este en la tabla de precios sale con costo NULL, no con cero.
-- ============================================================

with
precios(modelo, usd_in_1m, usd_out_1m) as (
  values
    ('gemini-3.1-flash-lite', 0.25, 1.50),
    ('gemini-2.5-flash-lite', 0.10, 0.40),
    ('claude-haiku-4-5',      1.00, 5.00)
),

-- Envios de servicio del numero (sin plantillas, sin rechazados ni fallidos).
envios as (
  select
    date_trunc('month', e.created_at at time zone 'America/Bogota')::date as mes,
    e.created_at,
    e.phone,
    case when e.intent like 'cardumen:%' then substr(e.intent, 10) end as estudio
  from public.wa_envios e
  where e.template_name is null
    and e.origen <> 'template'
    and e.wa_message_id is not null
    and e.status not in ('rechazado', 'failed')
),

-- Conversacion = envios de Cardumen al mismo telefono y estudio sin un hueco de mas de
-- 24 h (la ventana de servicio de Meta, la misma que cierra la sesion en el motor).
cardumen as (
  select
    mes, estudio, phone, created_at,
    case
      when lag(created_at) over (partition by estudio, phone order by created_at) is null
        or created_at - lag(created_at) over (partition by estudio, phone order by created_at) > interval '24 hours'
      then 1 else 0
    end as abre
  from envios
  where estudio is not null
),
conversaciones as (
  select
    mes, estudio, phone, created_at,
    sum(abre) over (partition by estudio, phone order by created_at) as n_conv
  from cardumen
),
-- Una conversacion cuenta en el mes en que empezo, aunque cruce el cambio de mes.
por_conversacion as (
  select min(mes) as mes, estudio, phone, n_conv, count(*) as mensajes
  from conversaciones
  group by estudio, phone, n_conv
),

-- Llamadas al modelo de Cardumen.
tokens as (
  select
    date_trunc('month', l.created_at at time zone 'America/Bogota')::date as mes,
    substr(l.intent, 10) as estudio,
    l.gemini_model as modelo,
    count(*) as llamadas,
    sum(coalesce(l.gemini_input_tokens, 0)) as tokens_entrada,
    sum(coalesce(l.gemini_output_tokens, 0)) as tokens_salida,
    round(avg(l.gemini_latency_ms)) as latencia_ms_prom
  from public.wa_message_log l
  where l.intent like 'cardumen:%'
  group by 1, 2, 3
),
costo as (
  select
    t.mes, t.estudio,
    sum(t.llamadas) as llamadas_modelo,
    sum(t.tokens_entrada) as tokens_entrada,
    sum(t.tokens_salida) as tokens_salida,
    -- NULL si algun modelo del estudio no tiene precio: sumar cero seria afirmar que fue gratis.
    case when bool_and(p.modelo is not null)
      then round(sum((t.tokens_entrada * p.usd_in_1m + t.tokens_salida * p.usd_out_1m) / 1e6)::numeric, 4)
    end as costo_modelo_usd,
    string_agg(distinct t.modelo, ', ') as modelos
  from tokens t
  left join precios p on p.modelo = t.modelo
  group by t.mes, t.estudio
),

-- Total del numero (Cardumen + ONE) contra el tope de 1.000.
numero as (
  select
    mes,
    count(*) as servicio_numero,
    count(*) filter (where estudio is not null) as servicio_cardumen,
    count(*) filter (where estudio is null) as servicio_one
  from envios
  group by mes
),

por_estudio as (
  select
    mes, estudio,
    sum(mensajes) as mensajes,
    count(*) as conversaciones,
    round(avg(mensajes), 1) as msj_por_conv_prom,
    percentile_cont(0.9) within group (order by mensajes) as msj_por_conv_p90
  from por_conversacion
  group by mes, estudio
),

-- Llave: todo (mes, estudio) que tenga mensajes o tokens.
claves as (
  select mes, estudio from por_estudio
  union
  select mes, estudio from costo
  union
  -- Meses sin Cardumen igual muestran el total del numero (estudio NULL).
  select mes, null from numero where servicio_cardumen = 0
)

select
  k.mes,
  k.estudio,
  pe.mensajes,
  pe.conversaciones,
  pe.msj_por_conv_prom,
  pe.msj_por_conv_p90,
  c.llamadas_modelo,
  c.tokens_entrada,
  c.tokens_salida,
  c.modelos,
  c.costo_modelo_usd,
  -- Del numero completo (Cardumen + ONE), repetido en cada fila del mes:
  n.servicio_numero,
  n.servicio_cardumen,
  n.servicio_one,
  1000 as tope_gratis,
  greatest(coalesce(n.servicio_numero, 0) - 1000, 0) as excedente_cobrable
from claves k
left join por_estudio pe on pe.mes = k.mes and pe.estudio = k.estudio
left join costo c on c.mes = k.mes and c.estudio = k.estudio
left join numero n on n.mes = k.mes
order by k.mes desc, k.estudio nulls first;
