-- El guardián de duplicados aprende dos cosas: el usuario de WhatsApp y que un
-- teléfono compartido puede tener varios dueños.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Por qué (medido el 2026-09-07 contra producción)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. **Las 6 interacciones marcadas `posible_duplicado` eran la MISMA persona,
--    las 6.** El webhook de Meta, cuando el teléfono coincide y el correo
--    declarado difiere, decide que son dos personas y crea una ficha nueva. La
--    intención es legítima (en SOENA hay **17 teléfonos compartidos por 39
--    contactos**: familias, y el intermediario que radica). Pero la regla
--    ignoraba el NOMBRE, que estaba ahí y era idéntico:
--
--      · BEATRIZ ELENA DAJUD-FERNANDEZ  bdajud@gmail.com / bdajud@yahoo.com
--      · SILVIA CARDONA                 silviaecardona@ / silviaecardonaa@ (un typo)
--      · DIEGO LÓPEZ                    dos correos de su esposa
--      · JOSÉ EDUARDO CORREDOR TORRES   ecorredor@gmail.com / ecorredort@yahoo.es
--      · FERNANDO ALBARRACIN            el propio / el de Sandra
--      · DIANA LUCIA OCHOA MONTOYA      @icloud.com / @hotmail.com
--
--    Y al revés: de los **17 grupos que comparten teléfono, CERO tienen el
--    nombre repetido**. O sea que la regla nunca protegió a nadie de lo que
--    decía proteger, y creó 6 fichas repetidas que hubo que fusionar a mano.
--    La decisión de enganchar-en-vez-de-crear vive en el webhook (ver
--    `_shared/meta-leads/dedup-lead.ts`); lo que esta migración aporta es el
--    dato con el que decidir.
--
-- 2. **`usuario_whatsapp` no entraba en la comparación.** Es la deuda que
--    dejaron los PRs #507/#511. Cuando el formulario manda un handle en el
--    campo de teléfono, `telefono_utilizable` lo desvía a
--    `contactos.usuario_whatsapp` y el contacto queda sin teléfono: el guardián
--    lo deja pasar SIEMPRE porque no tiene con qué compararlo. Hoy hay **4
--    contactos cuyo único dato de contacto es el handle** (`@juandavidmoreno`,
--    `@AdMarif`, `@JohannaMBS`, `@beatrixes`) y 10 en total con handle. Ninguno
--    repetido todavía — el agujero crece solo, cada vez que el webhook desvíe
--    otro.
--
-- 3. **Un teléfono compartido tiene varios dueños y la función devolvía UNO.**
--    `limit 1` + `order by created_at` devuelve siempre al más antiguo del
--    grupo. Si vuelve a escribir el hijo (que ya tiene ficha) con un correo
--    nuevo, se compara contra la ficha de la MADRE, el nombre no coincide y
--    entra una tercera ficha. El grupo más grande de hoy tiene 5 contactos
--    (teléfono 3208684813). Ahora devuelve hasta 10 candidatos ordenados y
--    quien pregunta elige; el primero sigue siendo el mismo de antes, así que
--    para quien solo quiere saber "¿choca con alguien?" nada cambia.
--
-- ⚠️⚠️ ORDEN DE DESPLIEGUE: esta migración va ANTES de desplegar
-- `meta-leads-webhook`. El webhook nuevo llama la función con
-- `p_usuario_whatsapp`; contra la función vieja eso es PGRST202, el `dedup:`
-- lanza a propósito (ver el webhook: crear a ciegas es peor) y Meta reintenta
-- el lead hasta que la migración esté aplicada. Al revés no pasa nada: la
-- función nueva atiende igual a los cuatro llamadores viejos, que pasan los
-- argumentos por NOMBRE y dejan el parámetro nuevo en su default.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Qué es "el mismo usuario de WhatsApp"
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Función aparte y no una expresión suelta, por lo mismo que `limpiar_telefono`:
-- la usan el índice, el WHERE y el `motivo` de la búsqueda, y una regla escrita
-- tres veces se desincroniza en el primer cambio.
--
-- La arroba se ignora porque no es parte del handle: la gente escribe
-- `@doritasrg` o `doritasrg` según de dónde copie, y son la misma cuenta.
create or replace function usuario_whatsapp_comparable(p_usuario text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(lower(btrim(ltrim(btrim(coalesce(p_usuario, '')), '@'))), '');
$$;

comment on function usuario_whatsapp_comparable is
  'Normaliza un usuario/handle de WhatsApp para compararlo: minusculas, sin espacios de borde y sin la arroba. Fuente unica de la regla para el indice y para buscar_contacto_duplicado.';

-- Mismo criterio que los otros dos índices del guardián: parcial (los contactos
-- sin handle son la mayoría) y NO único, porque hoy no hay duplicados por handle
-- pero tampoco hay quien garantice que no aparezcan antes de la fusión.
create index if not exists idx_contactos_wa_comparable
  on contactos (workspace_id, usuario_whatsapp_comparable(usuario_whatsapp))
  where usuario_whatsapp is not null and usuario_whatsapp <> '';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. El guardián, con tres llaves y varios candidatos
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️⚠️ El `drop` es OBLIGATORIO y no es cosmético.
--
-- `create or replace` con un parámetro más no reemplaza: crea una SEGUNDA
-- función sobrecargada. Y entonces la llamada que hacen hoy los cuatro
-- llamadores viejos —`(p_workspace_id, p_telefono, p_email, p_excluir_id)`—
-- encaja en las dos (la nueva por su default) y Postgres responde
-- `function is not unique`. Eso, en el webhook de Meta, es el veneno conocido:
-- el `dedup:` lanza, el webhook devuelve error, Meta reintenta para siempre y
-- el lead no entra nunca. El tipo de retorno también cambia, que por sí solo ya
-- exige el drop.
drop function if exists buscar_contacto_duplicado(uuid, text, text, uuid);

create function buscar_contacto_duplicado(
  p_workspace_id     uuid,
  p_telefono         text default null,
  p_email            text default null,
  p_excluir_id       uuid default null,
  -- Al final y con default, para que ningún llamador que pase argumentos por
  -- posición se corra de sitio.
  p_usuario_whatsapp text default null
)
returns table (
  id               uuid,
  nombre           text,
  telefono         text,
  email            text,
  usuario_whatsapp text,
  motivo           text
)
language sql
stable
security invoker
set search_path = public
as $$
  with entrada as (
    select
      -- Últimos 10 dígitos = el número nacional colombiano. Menos de 10 dígitos
      -- se toma tal cual (un fijo corto), y sin dígitos queda nulo.
      nullif(
        case when length(regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')) >= 10
             then right(regexp_replace(p_telefono, '\D', '', 'g'), 10)
             else regexp_replace(coalesce(p_telefono, ''), '\D', '', 'g')
        end, '') as tel,
      nullif(lower(trim(coalesce(p_email, ''))), '') as mail,
      usuario_whatsapp_comparable(p_usuario_whatsapp) as wa
  )
  select c.id, c.nombre, c.telefono, c.email, c.usuario_whatsapp,
         -- El teléfono manda cuando chocan varios: es el dato con el que el
         -- equipo busca y por el que WhatsApp cruza las conversaciones. El
         -- handle va último porque es el que menos gente tiene (10 de 1.129).
         case when e.tel is not null
                   and coalesce(c.telefono, '') <> ''
                   and right(regexp_replace(c.telefono, '\D', '', 'g'), 10) = e.tel
              then 'telefono'
              when e.mail is not null
                   and lower(trim(coalesce(c.email, ''))) = e.mail
              then 'email'
              else 'usuario_whatsapp'
         end as motivo
  from contactos c, entrada e
  where c.workspace_id = p_workspace_id
    and (p_excluir_id is null or c.id <> p_excluir_id)
    and (
      (e.tel  is not null and coalesce(c.telefono, '') <> ''
        and right(regexp_replace(c.telefono, '\D', '', 'g'), 10) = e.tel)
      or
      (e.mail is not null and lower(trim(coalesce(c.email, ''))) = e.mail)
      or
      -- Tercera llave. NO se cruza contra `telefono`: un handle que son puros
      -- dígitos (hay uno, `573207323251`) se parece a un teléfono, y compararlo
      -- contra la columna de teléfonos emparejaría a esa persona con quien
      -- tenga ese número, que puede ser cualquiera de su familia. Handle contra
      -- handle, y nada más.
      (e.wa is not null
        and usuario_whatsapp_comparable(c.usuario_whatsapp) = e.wa)
    )
  -- El más antiguo primero: si hay varios, el bueno casi siempre es el que lleva
  -- más tiempo y tiene la historia colgada. `id` desempata porque `created_at`
  -- no es único (los cargues masivos comparten marca de tiempo al segundo) y sin
  -- desempate el orden entre dos candidatos empatados cambia entre corridas.
  order by c.created_at asc, c.id asc
  -- Hasta 10, no 1. Quien solo necesita saber si choca lee la primera fila y ve
  -- exactamente lo que veía antes; quien tiene que decidir CUÁL de los dueños
  -- de un teléfono compartido es la persona del lead necesita la lista. 10
  -- porque el grupo más grande de producción tiene 5 y el techo existe para que
  -- una llave mal normalizada no se traiga el workspace entero.
  limit 10;
$$;

comment on function buscar_contacto_duplicado is
  'Devuelve hasta 10 contactos del workspace cuyo telefono (ultimos 10 digitos), email (minusculas) o usuario de WhatsApp (sin arroba, minusculas) coincide con los datos dados, del mas antiguo al mas nuevo. Fuente unica de la regla "una persona, un contacto" para las puertas de creacion. Quien solo quiera saber si hay choque lee la primera fila.';

revoke all on function buscar_contacto_duplicado(uuid, text, text, uuid, text) from public;
grant execute on function buscar_contacto_duplicado(uuid, text, text, uuid, text) to authenticated, service_role;

-- `create function` sobre una función recién borrada nace con la ACL en blanco:
-- estos grants no son decorativos como en un `create or replace`.
revoke all on function usuario_whatsapp_comparable(text) from public;
grant execute on function usuario_whatsapp_comparable(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. El segundo correo de la misma persona no se pierde
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Cuando el webhook engancha un lead al contacto que ya existe (mismo teléfono,
-- mismo nombre, correo distinto), el correo declarado NO cabe: `contactos.email`
-- ya está ocupado y pisarlo destruiría el dato con el que esa persona se
-- registró la primera vez. Se guarda aparte, con la misma convención que dejó
-- `fusionar_contactos` para lo que el ganador no pudo heredar: una lista en
-- `custom_data`, bajo la llave `emails_alternos`.
--
-- ⚠️ En UN solo statement y con el guard DENTRO del `update`, no en un `if`
-- previo. Los leads llegan en ráfaga cuando arranca una campaña: un
-- leer-modificar-escribir sobre `custom_data` haría que el último escritor borre
-- a los demás, en la misma columna donde vive `origen` (el primer toque, que es
-- lo que atribuye una venta a una campaña). Mismo motivo que
-- `guardar_field_map_formulario`.
--
-- Idempotente por construcción: si el correo ya es el del contacto o ya está en
-- la lista, el `update` no encuentra fila y devuelve false. Reintentar el mismo
-- lead (Meta reintenta) no duplica la entrada ni mueve la fecha del primer
-- avistamiento.
create or replace function registrar_email_alterno(
  p_workspace_id uuid,
  p_contacto_id  uuid,
  p_email        text,
  p_fuente       text default null
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  if v_email is null or p_contacto_id is null then
    return false;
  end if;

  update contactos c
  set custom_data = jsonb_set(
        coalesce(c.custom_data, '{}'::jsonb),
        '{emails_alternos}',
        coalesce(c.custom_data->'emails_alternos', '[]'::jsonb) ||
          jsonb_build_array(jsonb_build_object(
            'email',    v_email,
            'fuente',   p_fuente,
            'visto_en', now()
          )),
        true)
  -- El workspace se exige en el WHERE, no se deduce del contacto: así esto nunca
  -- puede escribirle a otro cliente por un id mal copiado (misma guarda que
  -- `fusionar_contactos`).
  where c.id = p_contacto_id
    and c.workspace_id = p_workspace_id
    -- No es el correo que ya tiene el contacto.
    and lower(btrim(coalesce(c.email, ''))) <> v_email
    -- Y no está ya en la lista.
    and not exists (
      select 1
      from jsonb_array_elements(coalesce(c.custom_data->'emails_alternos', '[]'::jsonb)) x
      where lower(btrim(coalesce(x->>'email', ''))) = v_email
    );

  return found;
end;
$$;

comment on function registrar_email_alterno is
  'Agrega un correo a custom_data.emails_alternos del contacto sin pisar nada mas. Para el segundo correo de una persona que ya tiene ficha (mismo telefono y mismo nombre): el campo email ya esta ocupado y sobrescribirlo destruiria el dato original. Idempotente: no repite un correo que ya este en la lista ni el que ya es el del contacto.';

-- Solo el webhook (service_role) registra correos alternos. `authenticated` no
-- lo necesita: quien edita un contacto desde la app tiene el campo `email` y el
-- historial de la interacción a la vista, y darle una función que escribe
-- `custom_data` a mano abre una puerta que nadie pidió.
revoke all on function registrar_email_alterno(uuid, uuid, text, text) from public;
grant execute on function registrar_email_alterno(uuid, uuid, text, text) to service_role;
