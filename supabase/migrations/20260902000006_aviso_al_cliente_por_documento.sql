-- El aviso al cliente deja de depender de que el negocio CAMBIE DE ETAPA.
--
-- POR QUE, medido contra produccion (SOENA, linea GIT EV/HEV, 2026-09-02):
--
--   Los dos avisos que existen hoy (certificado UPME y cita DIAN) cuelgan del trigger
--   `trg_avisar_entrada_etapa`, o sea del momento en que el negocio entra a una etapa.
--   Para la FACTURA ese momento no existe:
--
--     · La etapa "Facturacion" esta practicamente muerta: 10 negocios han pasado por
--       ella en toda la vida de la linea, y solo 2 de esos 10 tenian factura cargada.
--     · El bloque `factura_emitida` es `editable_siempre` y su origen vive en Cargue
--       (orden 7), asi que la factura se sube desde CUALQUIER etapa. De los 185 negocios
--       que ya la tienen, la subieron parados en 10 etapas distintas: Seguimiento (47),
--       Anexos (26), Notificacion (22), Documentacion (14), Generacion (8), Cargue (4),
--       Cita (3), Envio (2), Facturacion (2), Entrega (1).
--     · En 142 de esos 185 casos el negocio NUNCA volvio a moverse de etapa despues de
--       que la factura llego.
--
--   O sea: colgarlo de una etapa lo dejaria disparando antes de que la factura exista
--   (y omitiendose con `sin_link`, que no se ve) o no disparando nunca. El evento real
--   es "el documento llego", y eso vive en `negocio_bloques`, no en `negocios`.
--
-- QUE SE AGREGA:
--   1. `avisos_cliente.bloque_config_id` — de que bloque salio el aviso. Sin esto, la
--      traza de un aviso por documento seria indistinguible de uno por etapa.
--   2. `avisar_documento_cargado()` + su trigger: mismo patron que
--      `avisar_entrada_etapa` (pg_net -> edge function `notificar-etapa`), con la
--      configuracion leida del BLOQUE en vez de la etapa.
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migracion PRIMERO, la edge function despues, y la
--    configuracion del workspace (la que declara `avisar_al_cliente` en un bloque) de
--    ULTIMAS. Las tres razones son distintas:
--
--      · La columna antes que la function. La version nueva de `notificar-etapa` escribe
--        `bloque_config_id` en cada fila de `avisos_cliente`, incluidas las de los avisos
--        por etapa. Si la columna no existe el insert falla, y `registrarAviso` no
--        propaga su error a proposito: los avisos seguirian saliendo y se quedarian SIN
--        TRAZA. Eso no se ve por ningun lado.
--      · El trigger puede ir antes que la function porque nace inerte: solo dispara para
--        bloques que declaran `avisar_al_cliente`, y hoy no lo declara ninguno.
--      · La config del workspace de ultimas porque es lo unico que lo arma. Con la
--        function vieja sirviendo, el POST llegaria a una version que ignora
--        `bloque_config_id` y resolveria el copy por la etapa ACTUAL del negocio: al
--        cliente le llegaria el aviso de otra cosa, y eso no se deshace.

-- ── 1. La traza dice de que bloque salio ─────────────────────────────────────
alter table avisos_cliente
  add column if not exists bloque_config_id uuid references bloque_configs(id) on delete set null;

comment on column avisos_cliente.bloque_config_id is
  'Bloque que disparo el aviso, cuando el evento fue "llego el documento" y no "entro a la etapa". NULL en los avisos por etapa.';

-- ── 2. El aviso cuando el documento llega ────────────────────────────────────
create or replace function public.avisar_documento_cargado()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cfg     jsonb;
  v_estado  text;
  v_url     text;
  v_secret  text;
begin
  -- El enlace tiene que NACER en este update. Un re-cargue (url vieja -> url nueva) no
  -- es una novedad para el cliente: es una correccion nuestra, y avisarla dos veces por
  -- el mismo documento se lee como que algo salio mal.
  if coalesce(new.data ->> 'drive_url', '') = '' then return new; end if;
  if coalesce(old.data ->> 'drive_url', '') <> '' then return new; end if;

  -- Opt-in POR BLOQUE. Sin esto, cualquier documento de cualquier workspace empezaria a
  -- escribirle a los clientes el dia que se aplique esta migracion.
  select bc.config_extra -> 'avisar_al_cliente' into v_cfg
  from bloque_configs bc
  where bc.id = new.bloque_config_id;

  if v_cfg is null then return new; end if;
  if not (coalesce((v_cfg ->> 'email')::boolean, false)
       or coalesce((v_cfg ->> 'whatsapp')::boolean, false)) then
    return new;
  end if;

  -- ⚠️ Lo tiene que haber subido una PERSONA desde la plataforma.
  --
  -- Es la guarda que impide el unico fallo grave posible aqui. Medido: de los 185
  -- negocios con factura, 162 llegaron por INSERT de un cargue masivo, ya con el
  -- `drive_url` adentro. El trigger es AFTER UPDATE, asi que un INSERT no lo despierta;
  -- pero un cargue que MODIFIQUE filas existentes si lo haria, y serian ciento y pico
  -- de correos a clientes reales en un solo golpe, sin vuelta atras.
  --
  -- `auth.uid()` sale del JWT de quien hace la peticion: la app escribe con la sesion
  -- del usuario (`createClient()` en `get-workspace-impl`), y un script con la
  -- service_role o un `psql` no tienen `sub`, asi que devuelven null. La suplantacion de
  -- admin tambien escribe con la service_role: ahi no se avisa, y esta bien — una sesion
  -- de soporte no puede escribirle al cliente sin que nadie lo sepa.
  if auth.uid() is null then return new; end if;

  select n.estado into v_estado from negocios n where n.id = new.negocio_id;
  if v_estado is null then return new; end if;
  -- `completado` SI avisa a proposito: la factura suele ser justo lo ultimo que llega,
  -- y en 142 de 185 casos el negocio no volvio a moverse despues de recibirla.
  if v_estado in ('perdido', 'cancelado') then return new; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET' limit 1;
  if v_secret is null then return new; end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL' limit 1;
  if v_url is null then return new; end if;

  perform net.http_post(
    url  := v_url || '/notificar-etapa',
    body := jsonb_build_object(
      'negocio_id', new.negocio_id,
      'bloque_config_id', new.bloque_config_id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )
  );

  return new;
end;
$function$;

comment on function public.avisar_documento_cargado() is
  'Avisa al cliente cuando el documento de un bloque que declara `avisar_al_cliente` llega por primera vez. Opt-in por bloque y solo cuando lo sube una persona.';

-- Es una funcion de TRIGGER: nadie la invoca por RPC y PostgREST ni siquiera expone las
-- que devuelven `trigger`. El revoke va igual porque toda funcion nace ejecutable por
-- PUBLIC y `anon` la alcanza por ahi — el default de la base no lo puede evitar, asi que
-- el revoke explicito es el unico mecanismo (misma tanda que las 48 del PR #249).
revoke execute on function public.avisar_documento_cargado() from public, anon, authenticated;

-- `of data` acota el disparo: cambiar `estado` o `completado_at` no lo despierta.
drop trigger if exists trg_avisar_documento_cargado on negocio_bloques;
create trigger trg_avisar_documento_cargado
after update of data on negocio_bloques
for each row execute function public.avisar_documento_cargado();
