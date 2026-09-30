-- Registro público de ONE SECOP: la bitácora del autoservicio y las llaves antiabuso.
--
-- Spec: `proyectos/metrik/one/2026-09-28_spec-radar-autogestion-masiva.md`, §3.1 y §0-quater.
--
-- ## Por qué una tabla propia y no una columna en `workspaces` o en `fiscal_profiles`
--
-- Es la primera vez que alguien de AFUERA dispara la creación de filas de tenant. Esta tabla es
-- PRE-tenant: existe antes de que haya workspace, y tiene que seguir existiendo cuando el intento
-- se rechaza (sin workspace que apuntar). Por eso no lleva `workspace_id not null` y por eso no es
-- una columna de `fiscal_profiles`, que además es 1:1 con un workspace que en ese momento no hay.
--
-- La alternativa medida y descartada: un índice único sobre `fiscal_profiles.nit`. Hoy son 19 filas
-- con 8 NIT declarados; el índice le impondría la llave única a TODOS los espacios de Clarity y
-- Valida, que nunca la pidieron, para frenar el abuso de un producto de $15.000. La llave vive
-- donde vive el experimento.
--
-- ## Lo que la tabla NO es
--
-- No es una tabla de tenant: no tiene RLS por workspace porque **nadie con sesión la lee**. Se
-- habilita RLS sin una sola policy (deny-all) y se revocan los grants: la escribe y la lee solo el
-- cliente de servicio, desde la ruta de servidor del registro. Si algún día una pantalla la
-- necesita, se le escribe la policy ahí, no aquí.
--
-- ## Las llaves
--
--   * `identificacion` única **entre los creados**: es el freno del §0-ter. Un intento rechazado o
--     abandonado NO quema el NIT — si quemara, un tercero bloquearía a cualquiera escribiendo su
--     NIT en el formulario y abandonando.
--   * `correo` único entre los creados: un correo = un espacio.
--   * Los índices por `(ip, created_at)` y `(correo_dominio, created_at)` son para el tope por
--     ventana de tiempo, que se cuenta en el servidor sobre TODAS las filas (intentos incluidos):
--     lo que hay que frenar es el script que reintenta, no solo el que logra crear.

-- server-only: la escribe y la lee SOLO la ruta de servidor del registro, con el cliente de
-- servicio. Es pre-tenant (existe antes de que haya workspace y sobrevive al intento rechazado), así
-- que no hay policy por workspace que escribirle, y las llaves antiabuso —qué NIT y qué correo están
-- tomados, cuántos intentos por IP— no se le muestran a nadie con sesión: enseñárselas le diría al
-- que sondea cuál es el tope y qué NIT es cliente nuestro.
create table if not exists public.secop_registros (
  id uuid primary key default gen_random_uuid(),
  -- Tal como lo verificó Auth (el OTP del magic link ya probó que el correo existe).
  correo text not null,
  -- Solo el dominio, en minúsculas. Se guarda derivado para poder indexarlo y topearlo.
  correo_dominio text not null,
  -- Número de identificación NORMALIZADO (solo dígitos, sin DV). `null` en un intento que no
  -- llegó a declararlo. Ver `src/lib/secop-registro/identificacion.ts`: el DV NO se adivina.
  identificacion text,
  -- Lo que vio el servidor en `x-forwarded-for`. Es una señal, no una identidad.
  ip text,
  -- El slug que se pidió y el que quedó. Se guardan los dos porque el servidor puede corregirlo.
  slug_pedido text,
  slug_creado text,
  -- `null` mientras el espacio no exista. `on delete set null`: borrar un espacio no borra la
  -- constancia de que se creó ni libera el NIT sin que alguien lo decida.
  workspace_id uuid references public.workspaces(id) on delete set null,
  estado text not null check (estado in ('intento', 'creado', 'rechazado')),
  -- Por qué se rechazó, en la clave que usa el código (`dominio_desechable`, `tope_ip`, …).
  motivo text,
  created_at timestamptz not null default now(),
  -- Un `creado` sin espacio es una fila que no se puede explicar.
  constraint secop_registros_creado_tiene_espacio
    check (estado <> 'creado' or (workspace_id is not null and slug_creado is not null and identificacion is not null))
);

create unique index if not exists secop_registros_identificacion_creada
  on public.secop_registros (identificacion)
  where estado = 'creado';

create unique index if not exists secop_registros_correo_creado
  on public.secop_registros (lower(correo))
  where estado = 'creado';

create index if not exists secop_registros_ip_fecha on public.secop_registros (ip, created_at desc);
create index if not exists secop_registros_dominio_fecha on public.secop_registros (correo_dominio, created_at desc);

alter table public.secop_registros enable row level security;

-- Deny-all a propósito: ni una policy. En esta base las tablas nuevas nacen concedidas por
-- `alter default privileges`, así que revocar es obligatorio y no decorativo.
revoke all on public.secop_registros from anon, authenticated;
grant all on public.secop_registros to service_role;
