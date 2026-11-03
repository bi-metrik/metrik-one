-- ============================================================
-- 20261028120000 — La factura de una cuota sale SIEMPRE: campana + correo con adjuntos
--
-- POR QUÉ, medido en producción el 2026-10-28: `facturas_cuota` tiene 6 filas y `notificaciones`
-- tiene 0 avisos `factura_cargada` en toda su vida. El aviso vivía en la server action
-- `cargarFacturaCuota` (#1244), y las 6 facturas entraron por SQL, por script o antes del #1244:
-- ninguna pasó por ahí. Mauricio decidió (2026-10-28) que el aviso de la campana Y un correo con
-- la factura adjunta salen siempre, sin importar cómo se registró la factura. El único punto por
-- el que pasan todos los caminos es la tabla, así que el disparador vive en la base.
--
-- QUÉ SE AGREGA:
--   1. `envios_factura_cuota`: la cola y la traza. Una fila por CONTENIDO distinto de la factura
--      (número + huella del PDF + huella del XML). El UNIQUE con NULLS NOT DISTINCT impide encolar
--      dos veces lo mismo: un UPDATE que reescribe los mismos valores, un upsert repetido o el
--      mismo archivo subido otra vez no producen un segundo correo.
--   2. `encolar_envio_factura_cuota()` + `trg_encolar_envio_factura_cuota` en `facturas_cuota`
--      (AFTER INSERT OR UPDATE OF numero, pdf_sha256, xml_sha256): encola y llama por pg_net a la
--      edge function `enviar-factura-cuota` con `{envio_id}`.
--      SIN la guarda de `auth.uid()` de `avisar_documento_cargado()` (20260902000006): aquí se
--      quiere justo lo contrario, que dispare también con SQL y con scripts.
--   3. `reintentar_envios_factura_cuota()` + el job `enviar-factura-cuota-reintentos` (cada 10 min):
--      vuelve a llamar por las filas `pendiente`/`fallido` con menos de 3 intentos, más de 2 min y
--      menos de 7 días de vida, que todavía no mandaron el correo. La ventana de 7 días es el tope
--      duro: si la función no existe (404), `intentos` no sube, y sin tope el job llamaría para
--      siempre.
--
-- SIN BACKFILL: las 6 facturas que ya existen NO se encolan. Una factura de septiembre que le
-- llega hoy al cliente sin contexto se lee como un error. Si se quieren mandar, se encolan a mano
-- (un INSERT en la cola + `select public.disparar_envio_factura_cuota(<id>)`).
--
-- ⚠️ ORDEN DE DESPLIEGUE: la edge function `enviar-factura-cuota` PRIMERO, esta migración después.
--    Con la migración antes que la función, una factura cargada en el intervalo recibe un 404 y la
--    fila queda `pendiente`; el job la recoge en cuanto la función exista (hasta 7 días), así que
--    no se pierde, pero se retrasa. Y la server action deja de llamar a `avisarFacturaCargada` en
--    el mismo PR: con la app nueva y sin esta migración, una carga desde ONE no avisa a nadie.
--    Lo correcto: deploy de la función → esta migración → merge del PR.
--
-- Verificación después de aplicar:
--   select jobname, schedule, active from cron.job where jobname = 'enviar-factura-cuota-reintentos';
--   select tgname from pg_trigger where tgname = 'trg_encolar_envio_factura_cuota';
-- ============================================================

-- ── 1. La cola ──────────────────────────────────────────────────────────────

create table public.envios_factura_cuota (
  id uuid primary key default gen_random_uuid(),
  -- El cobrador (el de la factura).
  workspace_id uuid not null references public.workspaces(id),
  factura_cuota_id uuid not null references public.facturas_cuota(id) on delete cascade,
  plan_cobro_cuota_id uuid not null references public.plan_cobro_cuotas(id) on delete restrict,
  -- La foto del contenido que se encoló. Si la factura cambia antes de que la función corra, esta
  -- fila queda `omitido` (motivo `reemplazada`) y la nueva fila manda.
  numero text not null,
  pdf_sha256 text,
  xml_sha256 text,
  -- pendiente → enviado | omitido | fallido. `rebotado` / `suprimido` los escribe `resend-webhook`
  -- sobre una fila `enviado` (y `fallido` también, si Resend no lo pudo mandar después del 200).
  estado text not null default 'pendiente'
    constraint envios_factura_cuota_estado check
      (estado in ('pendiente', 'enviado', 'omitido', 'fallido', 'rebotado', 'suprimido')),
  intentos integer not null default 0,
  ultimo_error text,
  -- Por qué se omitió el correo (`sin_xml`, `sin_destinatario`…) o el acuse de Resend (`rebote_permanente: …`).
  motivo text,
  aviso_campana_at timestamptz,
  correo_enviado_at timestamptz,
  resend_id text,
  destinos text,
  -- Los acuses de Resend, con las mismas columnas que `avisos_cliente` y `avisos_equipo`.
  entregado_at timestamptz,
  queja_at timestamptz,
  -- Candado de 5 min: dos llamadas a la vez (el trigger y el job) no procesan la misma fila.
  tomado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint envios_factura_cuota_contenido unique nulls not distinct (factura_cuota_id, numero, pdf_sha256, xml_sha256)
);

alter table public.envios_factura_cuota enable row level security;
-- server-only: la escriben el trigger (security definer), la edge function y el webhook de Resend con service_role; nadie la lee desde el navegador.
revoke all on table public.envios_factura_cuota from public, anon, authenticated;

create index idx_envios_factura_cuota_cuota on public.envios_factura_cuota (plan_cobro_cuota_id, created_at);
create index idx_envios_factura_cuota_resend on public.envios_factura_cuota (resend_id) where resend_id is not null;
create index idx_envios_factura_cuota_reintento on public.envios_factura_cuota (created_at)
  where estado in ('pendiente', 'fallido') and correo_enviado_at is null;

comment on table public.envios_factura_cuota is
  'Cola y traza del envío de la factura de una cuota (campana de la persona designada + correo con PDF y XML). La llena el trigger de facturas_cuota; la procesa la edge function enviar-factura-cuota; resend-webhook escribe los acuses por resend_id.';

-- ── 2. La llamada a la función (una sola, para el trigger y para el job) ────

create or replace function public.disparar_envio_factura_cuota(p_envio_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET' limit 1;
  select decrypted_secret into v_url
  from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL' limit 1;
  -- Sin vault (base local, ensayo) la fila queda `pendiente` y no se rompe la escritura de la factura.
  if v_secret is null or v_url is null then return; end if;

  perform net.http_post(
    url  := v_url || '/enviar-factura-cuota',
    body := jsonb_build_object('envio_id', p_envio_id),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_secret
    )
  );
end;
$function$;

comment on function public.disparar_envio_factura_cuota(uuid) is
  'POST por pg_net a la edge function enviar-factura-cuota con {envio_id}. La usan el trigger de facturas_cuota y el job de reintentos.';

revoke execute on function public.disparar_envio_factura_cuota(uuid) from public, anon, authenticated;

-- ── 3. El trigger ───────────────────────────────────────────────────────────

create or replace function public.encolar_envio_factura_cuota()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_envio uuid;
begin
  -- Un UPDATE que no cambió el contenido (otra columna, o los mismos valores reescritos por un
  -- upsert) no es una factura nueva.
  if tg_op = 'UPDATE'
     and new.numero is not distinct from old.numero
     and new.pdf_sha256 is not distinct from old.pdf_sha256
     and new.xml_sha256 is not distinct from old.xml_sha256 then
    return new;
  end if;

  insert into public.envios_factura_cuota
    (workspace_id, factura_cuota_id, plan_cobro_cuota_id, numero, pdf_sha256, xml_sha256)
  values
    (new.workspace_id, new.id, new.plan_cobro_cuota_id, new.numero, new.pdf_sha256, new.xml_sha256)
  on conflict on constraint envios_factura_cuota_contenido do nothing
  returning id into v_envio;

  -- Mismo contenido que uno ya encolado: nada que mandar.
  if v_envio is null then return new; end if;

  perform public.disparar_envio_factura_cuota(v_envio);
  return new;
end;
$function$;

comment on function public.encolar_envio_factura_cuota() is
  'Encola el envío de la factura de una cuota cuando cambia su contenido (número, PDF o XML) y llama a enviar-factura-cuota. Dispara con cualquier camino: app, SQL o script.';

revoke execute on function public.encolar_envio_factura_cuota() from public, anon, authenticated;

drop trigger if exists trg_encolar_envio_factura_cuota on public.facturas_cuota;
create trigger trg_encolar_envio_factura_cuota
after insert or update of numero, pdf_sha256, xml_sha256 on public.facturas_cuota
for each row execute function public.encolar_envio_factura_cuota();

-- ── 4. Los reintentos ───────────────────────────────────────────────────────

create or replace function public.reintentar_envios_factura_cuota()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_id uuid;
  v_n  integer := 0;
begin
  for v_id in
    select e.id
    from public.envios_factura_cuota e
    where e.estado in ('pendiente', 'fallido')
      and e.correo_enviado_at is null
      and e.intentos < 3
      and e.created_at < now() - interval '2 minutes'
      and e.created_at > now() - interval '7 days'
      and (e.tomado_at is null or e.tomado_at < now() - interval '5 minutes')
    order by e.created_at
    limit 50
  loop
    perform public.disparar_envio_factura_cuota(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$function$;

comment on function public.reintentar_envios_factura_cuota() is
  'Vuelve a llamar a enviar-factura-cuota por los envíos pendientes o fallidos (menos de 3 intentos, entre 2 min y 7 días de vida, sin correo enviado). La corre pg_cron cada 10 min.';

revoke execute on function public.reintentar_envios_factura_cuota() from public, anon, authenticated;

select cron.unschedule('enviar-factura-cuota-reintentos')
where exists (select 1 from cron.job where jobname = 'enviar-factura-cuota-reintentos');

select cron.schedule(
  'enviar-factura-cuota-reintentos',
  '*/10 * * * *',
  $cron$select public.reintentar_envios_factura_cuota();$cron$
);
