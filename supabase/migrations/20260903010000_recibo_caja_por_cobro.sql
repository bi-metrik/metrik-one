-- ============================================================================
-- El recibo de caja pasa a colgar del COBRO, no del negocio.
--
-- Decision de Mauricio (2026-09-03): la factura y el recibo de caja son documentos
-- independientes. La factura se emite por el valor pactado de los honorarios; el
-- recibo de caja confirma que el cliente le entrego dinero a SOENA. Cada entrega
-- lleva su recibo, sin condicion cruzada entre los dos documentos.
--
-- POR QUE LA MARCA NO PODIA SEGUIR EN `negocios.metadata.siigo_recibo`:
--   Medido sobre produccion el 2026-09-02: de 306 negocios con cobros, 74 (el 24%)
--   ya recibieron mas de un pago. Una marca por negocio hace que el segundo pago
--   devuelva `ya_emitido` y no emita nunca, y `ya_emitido` no se ve como error:
--   se lee como exito. Los recibos del 24% se perderian en silencio.
--
-- ESTA MIGRACION NO TOCA NINGUN DATO. Agrega una columna que nace en NULL y la
-- config de la linea. No hay backfill, y es deliberado: hay 383 cobros historicos
-- sin recibo, y emitirlos consumiria esa numeracion de golpe en la contabilidad
-- real de SOENA, sin vuelta atras.
-- ============================================================================

-- ── 1. La marca, una por cobro ──────────────────────────────────────────────
alter table public.cobros
  add column if not exists siigo_recibo jsonb;

comment on column public.cobros.siigo_recibo is
  'Recibo de caja emitido en Siigo por ESTE cobro: {numero, siigo_id, valor, archivo_url, at, por}. '
  'NULL = sin recibo. Es la marca de idempotencia: si trae numero, no se vuelve a emitir. '
  'Reemplaza a negocios.metadata.siigo_recibo, que solo admitia uno por negocio.';

-- Busca los cobros pendientes de recibo sin barrer la tabla entera.
create index if not exists cobros_sin_recibo_idx
  on public.cobros (workspace_id, created_at)
  where siigo_recibo is null;

-- ── 2. La emision automatica es opt-in POR LINEA ────────────────────────────
-- No hay trigger sobre `cobros`, y es deliberado: la tabla es MIXTA a nivel producto.
-- En SOENA sus 383 filas son plata recibida (todas con external_ref, ninguna con plan
-- ni fecha esperada), pero en los workspaces `metrik` y `advise` hay cuentas por cobrar
-- generadas por un plan de pagos (47 y 3 filas con plan_cobro_id). Un disparo ciego por
-- insert les emitiria recibos de caja por plata que nadie ha entregado, en su
-- contabilidad real y sin vuelta atras.
--
-- La emision la llama el codigo de los caminos que SI son plata recibida, leyendo
-- `lineas_negocio.config_extra.siigo.recibo_automatico`. Una linea que no lo declara no
-- cambia en nada. La config de SOENA va en su propia migracion de workspace
-- (`proyectos/soena/ve/migrations/`), no aca.

-- ── 3. El aviso al cliente para documentos que emite ONE ────────────────────
-- `trg_avisar_documento_cargado` exige `auth.uid() is not null`, y esa guarda es la
-- que evito que el `commit` accidental del 2026-09-02 sobre V0412 le escribiera a 185
-- clientes. Pero `archivar-documento.ts` archiva con el service role, asi que TODO
-- documento que emite ONE (la factura contra Siigo, y ahora el recibo) se archiva sin
-- sesion y el trigger se devuelve. Hoy la factura que emite ONE no le avisa a nadie.
--
-- La salida NO es aflojar la guarda: es que el codigo que emite pida el aviso de
-- forma explicita. Esta funcion es ese pedido. Hace lo mismo que el trigger, con las
-- mismas comprobaciones de opt-in y de estado del negocio, pero sin la de `auth.uid()`,
-- porque aca el llamador no es un update anonimo: es el codigo que acaba de asentar un
-- documento y sabe cual es.
--
-- ⚠️ Solo `service_role`. Expuesta a `anon` seria exactamente el envio masivo que la
-- guarda del trigger existe para impedir.
create or replace function public.avisar_documento_al_cliente(
  p_negocio_id uuid,
  p_bloque_config_id uuid
) returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_cfg    jsonb;
  v_estado text;
  v_url    text;
  v_secret text;
begin
  -- Opt-in POR BLOQUE, igual que el trigger.
  select bc.config_extra -> 'avisar_al_cliente' into v_cfg
  from bloque_configs bc
  where bc.id = p_bloque_config_id;

  if v_cfg is null then return false; end if;
  if not (coalesce((v_cfg ->> 'email')::boolean, false)
       or coalesce((v_cfg ->> 'whatsapp')::boolean, false)) then
    return false;
  end if;

  select n.estado into v_estado from negocios n where n.id = p_negocio_id;
  if v_estado is null then return false; end if;
  if v_estado in ('perdido', 'cancelado') then return false; end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET' limit 1;
  if v_secret is null then return false; end if;

  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL' limit 1;
  if v_url is null then return false; end if;

  perform net.http_post(
    url  := v_url || '/notificar-etapa',
    body := jsonb_build_object(
      'negocio_id', p_negocio_id,
      'bloque_config_id', p_bloque_config_id
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )
  );

  return true;
end;
$function$;

revoke all on function public.avisar_documento_al_cliente(uuid, uuid) from public;
revoke all on function public.avisar_documento_al_cliente(uuid, uuid) from anon;
revoke all on function public.avisar_documento_al_cliente(uuid, uuid) from authenticated;
grant execute on function public.avisar_documento_al_cliente(uuid, uuid) to service_role;

comment on function public.avisar_documento_al_cliente(uuid, uuid) is
  'Pide el aviso al cliente por un documento que emitio ONE. Existe porque el trigger '
  'trg_avisar_documento_cargado exige auth.uid(), que el service role no tiene. Solo service_role.';
