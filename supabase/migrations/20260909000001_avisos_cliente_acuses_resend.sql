-- ============================================================
-- `avisos_cliente` deja de dar por bueno lo que solo fue aceptado
--
-- EL PROBLEMA QUE CIERRA:
--   `notificar-etapa` escribe `estado = 'enviado'` en cuanto Resend acepta el
--   POST. Eso es cierto y es poco: un rebote llega DESPUES, por el webhook de
--   acuses, y hoy no hay webhook, asi que nunca vuelve. Medido contra produccion
--   el 2026-09-09: los 61 avisos por correo de SOENA desde el 1-sep son 51
--   `enviado` (los 51 con `proveedor_id`) y 10 `omitido`. Los tres que rebotaron
--   —V0326 (`mailbox not found`), V0298 (`mailbox full`) y V0446 (`the email
--   account ... does not exist`)— figuran como `enviado` igual que los 48 que si
--   llegaron. La tabla responde "si le avisamos" sobre tres clientes a los que
--   nadie les aviso, y ese es exactamente el fallo que la tabla nacio para
--   evitar. Su propio comentario ya lo anticipaba: `proveedor_id` "es la llave
--   para ir a buscar el rebote".
--
-- POR QUE `rebotado` Y NO `fallido`:
--   La migracion original declara la distincion con todas las letras: "omitido
--   es trabajo para el equipo, fallido es trabajo para nosotros". `fallido`
--   significa que el proveedor RECHAZO el POST — no salio nada, y lo que hay que
--   revisar es nuestra integracion. Un rebote es el caso contrario: el correo
--   SALIO, viajo, y el buzon del destinatario lo devolvio. Lo que hay que hacer
--   es ir a corregir la direccion del cliente, que es trabajo del EQUIPO.
--   Meterlos en el mismo cajon borraria la unica pregunta que la columna sabe
--   responder: quien tiene que hacer algo.
--
-- POR QUE LA ENTREGA Y LA QUEJA SON COLUMNAS Y NO ESTADOS:
--   · `entregado_at` no es un estado porque no reemplaza a `enviado`: lo
--     confirma. Y sobre todo, porque puede convivir con un rebote — `delivered`
--     de Resend quiere decir que el servidor de correo del destinatario acepto
--     el mensaje, y el buzon puede devolverlo minutos despues. Una fila que diga
--     "entregado 10:00, rebotado 10:02" describe lo que paso; un estado unico
--     obligaria a elegir una de las dos verdades.
--   · `queja_at` (el destinatario lo marco como spam) tampoco toca el estado
--     porque el correo SI llego — de hecho solo se puede marcar como spam algo
--     que llego. Degradarlo a `rebotado` seria afirmar lo contrario.
--
-- ⚠️ Esta migracion es DDL puro: no reescribe una sola fila. Los 51 `enviado`
--    de hoy siguen diciendo `enviado`. Los rebotes historicos los repone el
--    script `scripts/backfill-acuses-resend.ts`, que consulta la API de Resend y
--    por eso no puede vivir en una migracion.
--
-- ⚠️ ORDEN DE DESPLIEGUE: esta migracion PRIMERO, la edge function `resend-webhook`
--    despues, y el endpoint en el panel de Resend de ULTIMAS. Al reves, el webhook
--    intentaria escribir `estado = 'rebotado'` contra un CHECK que todavia lo
--    rechaza (23514) o `entregado_at` contra una columna que no existe (42703),
--    devolveria 5xx y Svix reintentaria durante 10 horas por cada acuse.
-- ============================================================

-- ── 1. `rebotado` entra al vocabulario de `estado` ───────────────────────────
--
-- El CHECK original es anonimo (nacio como `estado text NOT NULL CHECK (...)`
-- dentro del CREATE TABLE), asi que Postgres le puso el nombre que le puso. Se
-- busca por lo que HACE y no por como se llama: un `drop constraint if exists`
-- con el nombre que uno supone es un fallo mudo — si el nombre no coincide, el
-- viejo se queda vivo, el nuevo se agrega al lado, y la tabla sigue rechazando
-- `rebotado` con los dos constraints puestos y la migracion en verde.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select conname
      from pg_constraint
     where conrelid = 'public.avisos_cliente'::regclass
       and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%estado%'
  loop
    execute format('alter table public.avisos_cliente drop constraint %I', r.conname);
    n := n + 1;
  end loop;
  -- Aborta en vez de dejar la tabla a medias. Si aparecen 0 (ya lo tocaron) o 2
  -- (hay otro CHECK que tambien menciona la columna), lo que hay que hacer es
  -- mirar, no adivinar.
  if n <> 1 then
    raise exception
      'Se esperaba exactamente 1 CHECK sobre avisos_cliente.estado y se encontraron %. Abortado sin tocar nada.', n;
  end if;
end $$;

alter table public.avisos_cliente
  add constraint avisos_cliente_estado_check
  check (estado in ('enviado', 'disparado', 'omitido', 'fallido', 'rebotado'));

comment on column public.avisos_cliente.estado is
  'enviado = Resend acepto el POST (SOLO correo). disparado = SOLO WhatsApp, el proveedor recibio el disparo. omitido = la plataforma decidio no mandarlo, con su motivo (trabajo del equipo: falta un dato). fallido = el proveedor rechazo el POST, no salio nada (trabajo nuestro). rebotado = el correo SALIO y el buzon del destinatario lo devolvio, con el detalle en `motivo` (trabajo del equipo: corregir la direccion). La diferencia entre fallido y rebotado es quien tiene que hacer algo.';

-- ── 2. Lo que el acuse confirma, sin tocar el estado ─────────────────────────
alter table public.avisos_cliente
  add column if not exists entregado_at timestamptz,
  add column if not exists queja_at     timestamptz;

comment on column public.avisos_cliente.entregado_at is
  'Cuando el servidor de correo del destinatario confirmo la recepcion (email.delivered de Resend). NO reemplaza a `estado`: lo confirma, y puede convivir con `estado = rebotado` cuando el servidor acepto el mensaje y el buzon lo devolvio despues. Se conserva la PRIMERA confirmacion: un reintento del mismo acuse no corre la fecha.';

comment on column public.avisos_cliente.queja_at is
  'Cuando el destinatario lo marco como spam (email.complained de Resend). NO cambia `estado` a proposito: el correo SI llego —solo se puede marcar como spam algo que llego— y contarlo como no entregado seria falso. Es la senal de que a ese cliente conviene dejar de escribirle.';

-- ── 3. La llave por la que el webhook busca la fila ──────────────────────────
--
-- El acuse de Resend solo trae `data.email_id`, que es lo que guardamos en
-- `proveedor_id`. Sin este indice, cada acuse recorre la tabla entera. Hoy son
-- 118 filas y no se nota; el indice se pone ahora porque despues nadie vuelve.
-- Parcial: las filas `omitido` no tienen `proveedor_id` y no hay por que
-- indexar sus nulos.
create index if not exists avisos_cliente_proveedor_idx
  on public.avisos_cliente (proveedor_id)
  where proveedor_id is not null;

-- Sin cambios de permisos: la tabla ya esta en RLS, `authenticated` solo lee y
-- quien escribe sigue siendo la edge function con `service_role`. Un operador no
-- puede borrar la evidencia de que a su cliente no le llego el correo.
