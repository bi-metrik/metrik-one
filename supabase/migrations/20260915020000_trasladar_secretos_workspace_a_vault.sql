-- Traslado de las credenciales por workspace a Vault y cierre de la escritura de config_extra.
--
-- TOCA DATOS DE PRODUCCION: copia credenciales a Vault y las borra de
-- workspaces.config_extra. Requiere el "si" de Mauricio antes de aplicarse.
--
-- Prerrequisitos:
--   1. 20260915010000_secretos_workspace_vault.sql aplicada (funciones de Vault).
--   2. El codigo del PR que lee Vault ya desplegado. Si no, al borrar las claves de
--      config_extra Drive, Siigo, Valida y FunnelChat se quedan sin credenciales.
--
-- Medido el 2026-09-14 (claves presentes en config_extra):
--   soena: drive_refresh_token, drive_client_id, drive_client_secret, siigo_username,
--          siigo_access_key, siigo_partner_id, funnelchat.webhook_token
--   afi: drive_refresh_token, drive_client_id, drive_client_secret, valida_api_key
--   alma-afi, cda-caqueta, cda-elcarmen, cda-puertotest, maxitec, metrik: valida_api_key
--
-- SIN tabla de respaldo a proposito: nace con los grants por defecto y dejaria las
-- credenciales en una tabla nueva. El respaldo es Vault, y la migracion aborta antes
-- de borrar si Vault no tiene exactamente lo que habia en config_extra.

do $$
declare
  v_esperadas int;
  v_en_vault int;
  v_restantes int;
begin
  -- 1. Copiar a Vault (crea o reemplaza).
  perform public.guardar_secreto_workspace(c.workspace_id, c.clave, c.valor)
  from (
    select w.id as workspace_id, k.clave, k.valor
    from public.workspaces w
    cross join lateral (values
      ('drive_refresh_token',      w.config_extra->>'drive_refresh_token'),
      ('drive_client_id',          w.config_extra->>'drive_client_id'),
      ('drive_client_secret',      w.config_extra->>'drive_client_secret'),
      ('siigo_username',           w.config_extra->>'siigo_username'),
      ('siigo_access_key',         w.config_extra->>'siigo_access_key'),
      ('siigo_partner_id',         w.config_extra->>'siigo_partner_id'),
      ('valida_api_key',           w.config_extra->>'valida_api_key'),
      ('funnelchat_webhook_token', w.config_extra->'funnelchat'->>'webhook_token')
    ) as k(clave, valor)
    where coalesce(k.valor, '') <> ''
  ) c;

  -- 2. Verificar contra Vault, valor por valor, ANTES de borrar nada.
  select count(*) into v_esperadas
  from public.workspaces w
  cross join lateral (values
    ('drive_refresh_token',      w.config_extra->>'drive_refresh_token'),
    ('drive_client_id',          w.config_extra->>'drive_client_id'),
    ('drive_client_secret',      w.config_extra->>'drive_client_secret'),
    ('siigo_username',           w.config_extra->>'siigo_username'),
    ('siigo_access_key',         w.config_extra->>'siigo_access_key'),
    ('siigo_partner_id',         w.config_extra->>'siigo_partner_id'),
    ('valida_api_key',           w.config_extra->>'valida_api_key'),
    ('funnelchat_webhook_token', w.config_extra->'funnelchat'->>'webhook_token')
  ) as k(clave, valor)
  where coalesce(k.valor, '') <> '';

  select count(*) into v_en_vault
  from public.workspaces w
  cross join lateral (values
    ('drive_refresh_token',      w.config_extra->>'drive_refresh_token'),
    ('drive_client_id',          w.config_extra->>'drive_client_id'),
    ('drive_client_secret',      w.config_extra->>'drive_client_secret'),
    ('siigo_username',           w.config_extra->>'siigo_username'),
    ('siigo_access_key',         w.config_extra->>'siigo_access_key'),
    ('siigo_partner_id',         w.config_extra->>'siigo_partner_id'),
    ('valida_api_key',           w.config_extra->>'valida_api_key'),
    ('funnelchat_webhook_token', w.config_extra->'funnelchat'->>'webhook_token')
  ) as k(clave, valor)
  join vault.decrypted_secrets s
    on s.name = 'ws:' || w.id::text || ':' || k.clave
   and s.decrypted_secret = k.valor
  where coalesce(k.valor, '') <> '';

  if v_esperadas = 0 or v_en_vault <> v_esperadas then
    raise exception 'Traslado abortado: % credenciales en config_extra, % coinciden en Vault', v_esperadas, v_en_vault;
  end if;

  -- 3. Borrar de config_extra. El trigger protect_workspace_drive_config bloquea
  --    quitar las drive_*; esta es exactamente la excepcion para la que existe su escape.
  perform set_config('app.allow_drive_reset', 'true', true);

  update public.workspaces
     set config_extra = (config_extra - array[
           'drive_refresh_token', 'drive_client_id', 'drive_client_secret',
           'siigo_username', 'siigo_access_key', 'siigo_partner_id', 'valida_api_key'
         ]) #- '{funnelchat,webhook_token}'
   where config_extra ?| array[
           'drive_refresh_token', 'drive_client_id', 'drive_client_secret',
           'siigo_username', 'siigo_access_key', 'siigo_partner_id', 'valida_api_key'
         ]
      or coalesce(config_extra->'funnelchat', '{}'::jsonb) ? 'webhook_token';

  select count(*) into v_restantes
  from public.workspaces
  where config_extra ?| array[
          'drive_refresh_token', 'drive_client_id', 'drive_client_secret',
          'siigo_username', 'siigo_access_key', 'siigo_partner_id', 'valida_api_key'
        ]
     or coalesce(config_extra->'funnelchat', '{}'::jsonb) ? 'webhook_token';

  if v_restantes <> 0 then
    raise exception 'Traslado abortado: % workspaces conservan credenciales en config_extra', v_restantes;
  end if;

  raise notice 'Credenciales trasladadas a Vault: %', v_en_vault;
end $$;

-- 4. Que no vuelvan a entrar. Reemplaza al trigger que protegia las drive_* en
--    config_extra: ya no tiene nada que proteger ahi.
drop trigger if exists protect_workspace_drive_config_trigger on public.workspaces;
drop function if exists public.protect_workspace_drive_config();

create or replace function public.rechazar_credenciales_en_config_extra()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.config_extra ?| array[
       'drive_refresh_token', 'drive_client_id', 'drive_client_secret',
       'siigo_username', 'siigo_access_key', 'siigo_partner_id', 'valida_api_key'
     ]
     or coalesce(new.config_extra->'funnelchat', '{}'::jsonb) ? 'webhook_token' then
    raise exception 'Las credenciales de un workspace van en Vault (guardar_secreto_workspace), no en config_extra'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$;

revoke all on function public.rechazar_credenciales_en_config_extra() from public, anon, authenticated;

create trigger rechazar_credenciales_en_config_extra
  before insert or update of config_extra on public.workspaces
  for each row execute function public.rechazar_credenciales_en_config_extra();

-- 5. Cerrar la escritura de config_extra para el usuario con sesion.
--    Columnas que la app actualiza con el cliente de sesion (inventario 2026-09-14):
--      mi-negocio/actions.ts  updateBranding          -> logo_url, color_primario, color_secundario
--      mi-negocio/actions.ts  updateEquipoDeclarado   -> equipo_declarado
--      mi-negocio/actions.ts  updateLineaActiva       -> linea_activa_id
--    El resto de escrituras (onboarding, logo por Storage, suscripciones, scripts,
--    RPCs de export y de field_map) usan service_role y no dependen de este grant.
--    INSERT tambien se retira: el unico alta de workspace (onboarding) usa service_role.
revoke insert, update on public.workspaces from authenticated;
grant update (logo_url, color_primario, color_secundario, equipo_declarado, linea_activa_id)
  on public.workspaces to authenticated;
