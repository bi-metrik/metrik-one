-- Configuración del asistente de VENTAS de Dimpro sobre Chatwoot — ensayo con conocidos, 29-oct. SOLO Messenger.
--
-- NO es una migración: escribe DATOS del workspace dimpro (config_extra.bot_conversacional.chatwoot). La corre la sesión
-- principal con service_role, con el visto de Mauricio, DESPUÉS de la migración 20261029150000 y de la semilla del
-- reglamento (2026-10-29_reglamento-asistente-ventas-ENSAYO.sql).
--
-- Cuenta de Chatwoot 189134 (plan Startups, con API); bandeja «Dimpro Messenger», inbox 151556 (página Ingeniería
-- Dimpro). Messenger entra como canal `otro` del asistente: ventana de 24 h. Instagram queda fuera por ahora.
--
-- Queda APAGADO (`activo: false`). Antes de encenderlo:
--   1. Reemplazar <TERMINOS_URL_DIMPRO> por el link real de términos y política de datos (el bloque se niega a correr con
--      el marcador; sin él, el aviso de bot mostraría el link de ejemplo).
--   2. Secretos de la Edge Function: CHATWOOT_WEBHOOK_SECRET_DIMPRO y CHATWOOT_API_TOKEN_DIMPRO.
--   3. Agent Bot en la cuenta 189134 apuntando a …/functions/v1/chatwoot-agente?ws=dimpro, asignado al inbox 151556.
--   4. Llaves de Bold en la bóveda de dimpro y el webhook de Bold → /api/webhooks/bold/funciones/67f7af44-b5ac-4d5c-aa9e-44954368447c.
-- Encender: update public.workspaces set config_extra = jsonb_set(config_extra, '{bot_conversacional,chatwoot,activo}', 'true')
--           where id = '67f7af44-b5ac-4d5c-aa9e-44954368447c';

do $$
declare
  v_ws constant uuid := '67f7af44-b5ac-4d5c-aa9e-44954368447c';
  v_terminos constant text := '<TERMINOS_URL_DIMPRO>';
  v_chatwoot jsonb;
begin
  if v_terminos like '<%' or v_terminos not like 'https://%' then
    raise exception 'falta el link de términos de Dimpro (reemplaza <TERMINOS_URL_DIMPRO> por un https://…)';
  end if;
  if not exists (select 1 from public.workspaces where id = v_ws and slug = 'dimpro') then
    raise exception 'esta configuración es solo del workspace dimpro';
  end if;

  v_chatwoot := jsonb_build_object(
    'activo', false,
    'dominio', 'ventas',
    'cuenta_id', 189134,
    'api_url', 'https://app.chatwoot.com',
    'inboxes', jsonb_build_array(jsonb_build_object('id', 151556, 'canal', 'otro')),
    'terminos_url', v_terminos,
    'presupuesto_diario_usd', 5
  );

  -- Se suma a lo que ya haya en bot_conversacional (no pisa el bot de WhatsApp ni otras llaves).
  update public.workspaces
     set config_extra = jsonb_set(
           coalesce(config_extra, '{}'::jsonb),
           '{bot_conversacional}',
           coalesce(config_extra->'bot_conversacional', '{}'::jsonb)
             || jsonb_build_object('chatwoot', coalesce(config_extra->'bot_conversacional'->'chatwoot', '{}'::jsonb) || v_chatwoot),
           true)
   where id = v_ws;
end;
$$;
