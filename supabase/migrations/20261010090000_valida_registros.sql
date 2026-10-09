-- Registro autogestionado de Valida: la bitácora del alta, las llaves antiabuso y la marca de origen.
--
-- Spec: `proyectos/metrik/valida/docs/crecimiento-mrr/18-recorrido-baja-friccion.md`, §2.1 y §4 (PR 2).
-- Copia deliberada de `secop_registros` (20260929090000): mismo patrón PRE-tenant, otro producto.
-- No se reusa aquella tabla porque el experimento SECOP se construyó «completamente aparte de Valida»
-- (Mauricio, 2026-09-28) y sus llaves (un NIT, un correo) son de su producto: una empresa puede
-- tener el Radar y Valida a la vez.
--
-- DDL puro: crea una tabla nueva, no toca ninguna existente y no escribe una sola fila.
--
-- ## Lo que guarda además de lo que guardaba SECOP
--
--   * La empresa DECLARADA (razón social, NIT y DV si se escribió, tipo de entidad): sin RUT. Es lo
--     que se estampa en el PDF de la prueba con la marca «PRUEBA: razón social declarada, sin
--     verificar». La verificación con RUT llega al activar el plan (PR 8).
--   * La MARCA DE ORIGEN para la comisión de AFI (decisión B de Mauricio, 2026-10-09): `afi` (por el
--     enlace `?ref=afi`, por un código de AFI o por la respuesta «me recomendó AFI»), `pauta` (UTM de
--     una campaña) o `directo`. Se escribe una vez, en el servidor, y el cliente nunca la edita: esta
--     tabla no tiene policy para nadie con sesión. `origen_fuente` dice CUÁL de las señales decidió,
--     para poder atender un reclamo de AFI dentro de sus 30 días con el dato y no con la memoria.
--   * La PRUEBA que emitió Valida (cliente, consultas, vencimiento). La llave en claro NO: va a Vault.
--   * La ACEPTACIÓN de las Condiciones de la prueba y la Política de Datos: versión, huella SHA-256
--     del texto exacto que se mostró y momento. Las Condiciones aún no existen (Emilio); el registro
--     no se enciende sin ellas.
--   * El PUNTO DE EXTENSIÓN del método de pago (decisión A2: el cliente se registra con método de pago
--     y se le cobra al terminar la prueba, cuando llegue ePayco). `metodo_pago_estado` nace en
--     `no_requerido` para todas las filas: hoy la prueba es sin tarjeta. Solo la referencia que
--     devuelva la pasarela (nunca un número de tarjeta).
--
-- ## Las llaves
--
--   * `identificacion` única ENTRE LOS CREADOS: una prueba por NIT (§5, «abuso de la prueba gratis»).
--     Un intento rechazado o abandonado NO quema el NIT (mismo razonamiento que SECOP).
--   * `correo` único entre los creados: un correo = un espacio de Valida.
--   * `(ip, created_at)` y `(correo_dominio, created_at)` para los topes por ventana, contados sobre
--     TODAS las filas (intentos incluidos).
--
-- ## Limpieza de un espacio de prueba
--
-- Igual que SECOP: el `delete` de `workspaces` FALLA mientras el registro siga en `creado` (el
-- `on delete set null` choca con el CHECK `valida_registros_creado_tiene_espacio`). Primero
-- `update valida_registros set estado = 'rechazado', motivo = 'espacio_limpiado' where workspace_id = ...`
-- y eso LIBERA el NIT.

-- server-only: la escribe y la lee SOLO la ruta de servidor del registro de Valida, con el cliente de
-- servicio. Es pre-tenant (existe antes del workspace y sobrevive al intento rechazado), y sus llaves
-- antiabuso y la marca de origen no se le muestran a nadie con sesión: le dirían al que sondea qué
-- NIT es cliente nuestro, y al cliente que su origen se puede cambiar.
create table if not exists public.valida_registros (
  id uuid primary key default gen_random_uuid(),

  -- Quién: tal como lo verificó Auth (el código de 8 dígitos ya probó el correo).
  usuario_id uuid,
  correo text not null,
  correo_dominio text not null,
  ip text,

  -- La empresa declarada. `identificacion` NORMALIZADA (solo dígitos, sin DV); el DV solo si se
  -- escribió con guion. El DV NO se adivina (ver `src/lib/secop-registro/identificacion.ts`).
  identificacion text,
  dv text check (dv is null or dv ~ '^[0-9]$'),
  razon_social text,
  tipo_entidad text check (tipo_entidad is null or tipo_entidad in ('cda', 'vigilado_supertransporte', 'otro')),

  -- Marca de origen (comisión AFI). Ver el encabezado.
  origen text not null default 'directo' check (origen in ('afi', 'pauta', 'directo')),
  origen_fuente text not null default 'ninguna'
    check (origen_fuente in ('ref', 'codigo_afi', 'respuesta_afi', 'utm', 'ninguna')),
  -- Lo que llegó crudo, para auditar la marca: `?ref=`, el código escrito, las UTM.
  ref text,
  codigo_afi text,
  recomendado_afi boolean,
  utm jsonb not null default '{}'::jsonb,

  -- El espacio que nació.
  slug_creado text,
  workspace_id uuid references public.workspaces(id) on delete set null,

  -- La prueba que emitió Valida (`POST /api/one/v1/pruebas`).
  valida_cliente_id uuid,
  prueba_consultas integer check (prueba_consultas is null or prueba_consultas > 0),
  prueba_vence_en timestamptz,

  -- Aceptación de las Condiciones de la prueba y de la Política de Datos, con la huella del texto.
  condiciones_version text,
  condiciones_sha256 text check (condiciones_sha256 is null or condiciones_sha256 ~ '^[0-9a-f]{64}$'),
  politica_version text,
  aceptado_at timestamptz,

  -- Punto de extensión del método de pago (ePayco). Hoy siempre `no_requerido`.
  metodo_pago_estado text not null default 'no_requerido'
    check (metodo_pago_estado in ('no_requerido', 'pendiente', 'registrado', 'fallido')),
  metodo_pago_ref text,

  estado text not null check (estado in ('intento', 'creado', 'rechazado')),
  -- Por qué se rechazó, en la clave que usa el código (`dominio_desechable`, `tope_ip`, …).
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Un `creado` tiene espacio, NIT y la aceptación con su huella: sin aceptación no hay prueba.
  constraint valida_registros_creado_tiene_espacio
    check (estado <> 'creado' or (
      workspace_id is not null and slug_creado is not null and identificacion is not null
      and razon_social is not null and aceptado_at is not null and condiciones_sha256 is not null
    )),
  -- `afi` exige una señal de AFI; `directo` no puede venir con una.
  constraint valida_registros_origen_coherente
    check (
      (origen = 'afi' and origen_fuente in ('ref', 'codigo_afi', 'respuesta_afi'))
      or (origen = 'pauta' and origen_fuente = 'utm')
      or (origen = 'directo' and origen_fuente = 'ninguna')
    )
);

create unique index if not exists valida_registros_identificacion_creada
  on public.valida_registros (identificacion)
  where estado = 'creado';

create unique index if not exists valida_registros_correo_creado
  on public.valida_registros (lower(correo))
  where estado = 'creado';

create index if not exists valida_registros_ip_fecha on public.valida_registros (ip, created_at desc);
create index if not exists valida_registros_dominio_fecha on public.valida_registros (correo_dominio, created_at desc);
create index if not exists valida_registros_workspace on public.valida_registros (workspace_id) where workspace_id is not null;

alter table public.valida_registros enable row level security;

-- Deny-all a propósito: ni una policy. Revocar es obligatorio: en esta base las tablas nacían
-- concedidas por `alter default privileges` hasta el 2026-08-10, y se repite por si acaso.
revoke all on public.valida_registros from anon, authenticated;
grant all on public.valida_registros to service_role;
