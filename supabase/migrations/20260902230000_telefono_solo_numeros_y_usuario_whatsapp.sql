-- El campo teléfono solo acepta números, y el usuario de WhatsApp tiene casa propia.
--
-- Contexto (medido el 2026-09-02, 1.033 contactos en 7 workspaces): 11 filas
-- tenían en `telefono` algo que no es un teléfono. Nueve son usuarios de
-- WhatsApp (`@doritasrg`, `@beatrixes`, `isa.paca`…), una dice literalmente
-- `None`, y una es un número bueno con un carácter invisible pegado al final.
--
-- ⚠️ Por qué esto importa más de lo que parece: el guardián de duplicados
-- (`buscar_contacto_duplicado`, migración 20260902000007) compara teléfono y
-- correo. Un contacto sin ninguno de los dos **no se puede comparar con nada**,
-- así que el guardián lo deja pasar siempre. PAULA FERNANDA PALOMINO CABRERA
-- llegó a tener 4 negocios con "isa.paca" por teléfono. Es el mismo agujero por
-- el que entró la duplicidad que se acaba de limpiar a mano.
--
-- Y no es solo el dedup: con un usuario de WhatsApp en ese campo, ni el enlace
-- de llamada ni el de WhatsApp funcionan. El dato ocupa el lugar del dato bueno.
--
-- Ninguna de las 11 llegó por el webhook de Meta (n_meta = 0 en todas). Meta ya
-- valida su propio campo de teléfono; las puertas que dejaban pasar esto son las
-- manuales. Por eso la regla NO se pone en una puerta: se pone en la tabla, y así
-- la cumplen también las puertas que todavía no están escritas.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. El usuario de WhatsApp tiene dónde vivir
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Sin este campo, rechazar el valor en `telefono` no resuelve nada: la persona
-- que lo escribió ahí lo hizo porque no tenía otro sitio, y lo volvería a hacer.
-- Es un canal de contacto real, no basura.
alter table contactos add column if not exists usuario_whatsapp text;

comment on column contactos.usuario_whatsapp is
  'Usuario/handle de WhatsApp o red social del contacto. Texto libre: NO es un telefono y no entra en la comparacion de duplicados.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. La regla: qué es un teléfono
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Dos funciones y no una, porque son dos preguntas distintas:
--   `limpiar_telefono`  — quita lo que sobra sin cambiar el número.
--   `telefono_valido`   — dice si lo que queda es un teléfono.
--
-- Se separan porque limpiar NUNCA debe rechazar (arregla en silencio lo que es
-- claramente un accidente de copiado) y validar NUNCA debe modificar.

-- Normaliza sin adivinar. Solo arregla accidentes demostrados en producción.
create or replace function limpiar_telefono(p_telefono text)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(
    -- 4. El decimal que dejó Excel al leer la celda como NÚMERO
    --    (`3015377300.0` → `3015377300`, `3167407863.` → `3167407863`). Se
    --    corta DESPUÉS de recortar los bordes, para que un espacio al final no
    --    esconda el punto, y ANTES de contar dígitos: si no, un móvil de 10 se
    --    vuelve uno de 11 que no existe. Medido: 2 filas.
    regexp_replace(
      -- 3. Bordes.
      btrim(
        -- 2. Espacios repetidos, incluidos los que deja el paso anterior.
        regexp_replace(
          -- 1. Caracteres invisibles que viajan al copiar desde WhatsApp o Word:
          --    marcas bidi (U+202A-U+202E, U+2066-U+2069), ancho cero
          --    (U+200B-U+200F) y BOM (U+FEFF) se borran; el espacio duro
          --    (U+00A0) se vuelve espacio normal, que sí es un separador legítimo.
          --    Medido: 1 fila (`+57 3004824023` con un U+202C pegado al final)
          --    que es un teléfono perfectamente bueno y que sin esto rebotaría.
          --    Se escriben con `chr()` y no con escapes: en el archivo son
          --    caracteres invisibles, y un `\u200B` mal interpretado por el motor
          --    dejaría de limpiar sin que nadie lo note. `translate` convierte el
          --    primero (espacio duro) en espacio y BORRA los demás, que es justo
          --    lo que hace cuando la cadena destino es más corta que la origen.
          translate(
            coalesce(p_telefono, ''),
            chr(160)                                                          -- U+00A0 espacio duro
              || chr(8203) || chr(8204) || chr(8205) || chr(8206) || chr(8207) -- U+200B..U+200F ancho cero
              || chr(8234) || chr(8235) || chr(8236) || chr(8237) || chr(8238) -- U+202A..U+202E bidi
              || chr(8294) || chr(8295) || chr(8296) || chr(8297)              -- U+2066..U+2069 aislados
              || chr(65279),                                                   -- U+FEFF BOM
            ' '
          ),
          '\s+', ' ', 'g'
        )
      ),
      '[.,]0*$', ''
    ),
  '');
$$;

comment on function limpiar_telefono is
  'Quita de un telefono los caracteres invisibles, el decimal que deja Excel y los espacios repetidos. No cambia el numero ni rechaza nada: para eso esta telefono_valido.';

-- ¿Esto es un teléfono?
--
-- Charset: dígitos y los separadores de formato que la gente sí escribe.
-- Cualquier letra, `@`, `_` o `/` lo descalifica, que es exactamente el caso de
-- los 9 usuarios de WhatsApp y del literal `None`.
--
-- Rango: de 7 a 15 dígitos. 7 es el fijo más corto que se marca en Colombia.
-- 15 es el techo de E.164, el estándar internacional de numeración: por encima
-- de eso no hay teléfono en el mundo, solo un indicativo pegado dos veces.
create or replace function telefono_valido(p_telefono text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case
    when p_telefono is null or btrim(p_telefono) = '' then true  -- sin teléfono es válido
    when p_telefono !~ '^[0-9 ()+.,-]+$' then false
    else length(regexp_replace(p_telefono, '\D', '', 'g')) between 7 and 15
  end;
$$;

comment on function telefono_valido is
  'True si el texto es un telefono: solo digitos y separadores de formato, entre 7 y 15 digitos. Nulo o vacio es valido (no tener telefono se permite). Fuente unica de la regla para todas las puertas.';

-- Las dos preguntas de arriba en una sola respuesta: "de este texto, ¿qué me
-- sirve como teléfono?". Devuelve el número limpio, o nulo si no era un teléfono.
--
-- Existe para el webhook de Meta, que necesita DECIDIR antes de insertar. Un lead
-- cuyo teléfono trae un usuario de WhatsApp no puede simplemente reventar: el
-- trigger lo rechazaría, el webhook devolvería error y Meta reintentaría ese lead
-- para siempre sin que entre nunca. Perder un lead es peor que guardar el dato en
-- otro campo. Con esto el webhook pregunta primero y lo manda a `usuario_whatsapp`.
--
-- Preguntar a la base y no repetir la regla en Deno es lo que evita la segunda
-- verdad: `limpiar_telefono` y `telefono_valido` siguen siendo las únicas.
create or replace function telefono_utilizable(p_telefono text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when telefono_valido(limpiar_telefono(p_telefono))
              then limpiar_telefono(p_telefono)
         end;
$$;

comment on function telefono_utilizable is
  'Devuelve el telefono limpio si es un telefono, o null si no lo es. Para quien necesita decidir antes de insertar (webhook de Meta) en vez de chocar con el trigger.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Las 11 filas que ya están mal
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Se corrigen ANTES de poner el guardián, porque si no el guardián no deja
-- editar ningún otro campo de esas fichas.

-- Copia de seguridad de lo que se va a tocar. Se conserva.
create table if not exists backup_telefono_no_numerico_20260902 as
  select id, workspace_id, nombre, telefono, email, now() as respaldado_en
  from contactos
  where telefono is not null and telefono <> ''
    and not telefono_valido(limpiar_telefono(telefono));

-- 3.a El número bueno con basura invisible: se limpia y se queda donde está.
update contactos
set telefono = limpiar_telefono(telefono)
where telefono is not null
  and limpiar_telefono(telefono) is distinct from telefono
  and telefono_valido(limpiar_telefono(telefono));

-- 3.b El usuario de WhatsApp se muda al campo nuevo. No se pierde: es el único
--     canal por el que a varias de estas personas se les puede escribir.
update contactos
set usuario_whatsapp = coalesce(usuario_whatsapp, btrim(regexp_replace(telefono, '^\+?\d*\s*', ''))),
    telefono = null
where telefono is not null and telefono <> ''
  and not telefono_valido(limpiar_telefono(telefono))
  -- Tiene pinta de handle: trae letras. `+57 @AdMarif` entra aquí y se queda
  -- con `@AdMarif`, sin el indicativo suelto que alguien tecleó por costumbre.
  and telefono ~ '[A-Za-z]'
  and lower(btrim(telefono)) <> 'none';

-- 3.c El resto (el literal `None`, y cualquier cosa sin letras que tampoco sea
--     teléfono) se vacía. No hay nada que conservar y la copia queda arriba.
update contactos
set telefono = null
where telefono is not null and telefono <> ''
  and not telefono_valido(limpiar_telefono(telefono));

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. El guardián
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ Por qué un trigger y no un `check`:
--
--   1. **Una sola verdad.** Un `check` que llame a `telefono_valido` rompe la
--      restauración de un dump: pg_dump escribe las restricciones junto al
--      CREATE TABLE, antes de las funciones. Un trigger se crea DESPUÉS de los
--      datos, así que puede llamar a la función sin ese riesgo. La alternativa
--      era repetir la expresión regular dentro del `check`, y una regla escrita
--      dos veces se desincroniza en el primer cambio.
--   2. **Limpia y valida en el mismo paso.** El `check` solo puede rechazar;
--      esto además arregla el carácter invisible antes de juzgar, así que un
--      número bueno copiado de WhatsApp entra en vez de rebotar.
--
-- Solo se mete cuando el teléfono cambia: así una fila vieja con datos raros
-- (las hay: dos con el indicativo tecleado dos veces) no bloquea la edición del
-- nombre o del correo. La regla aplica a lo que se escribe, no a lo que ya está.
create or replace function contactos_telefono_guardian()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and new.telefono is not distinct from old.telefono then
    return new;
  end if;

  new.telefono := limpiar_telefono(new.telefono);

  if not telefono_valido(new.telefono) then
    raise exception
      'El telefono solo admite numeros: "%" no lo es. Si es un usuario de WhatsApp, va en el campo Usuario de WhatsApp.',
      new.telefono
      using errcode = '23514';
  end if;

  new.usuario_whatsapp := nullif(btrim(new.usuario_whatsapp), '');

  return new;
end;
$$;

comment on function contactos_telefono_guardian is
  'Limpia el telefono y rechaza lo que no sea un numero, en toda escritura sobre contactos. La regla vive aqui y no en cada puerta para que la cumplan tambien las puertas que aun no existen.';

drop trigger if exists trg_contactos_telefono_guardian on contactos;
create trigger trg_contactos_telefono_guardian
  before insert or update on contactos
  for each row
  execute function contactos_telefono_guardian();

revoke all on function limpiar_telefono(text) from public;
revoke all on function telefono_valido(text) from public;
revoke all on function telefono_utilizable(text) from public;
grant execute on function limpiar_telefono(text) to authenticated, service_role;
grant execute on function telefono_valido(text) to authenticated, service_role;
grant execute on function telefono_utilizable(text) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Fusionar dos contactos no puede perder el campo nuevo
-- ─────────────────────────────────────────────────────────────────────────────
--
-- `fusionar_contactos` (migración 20260902000009) hereda del perdedor los campos
-- que al ganador le faltan. Nació antes que `usuario_whatsapp`. Se reescribe
-- entera, con una sola línea añadida, en vez de parchearla: una función que se
-- edita a trozos deja de poder leerse de arriba abajo, y esta borra un contacto.
create or replace function fusionar_contactos(
  p_workspace_id uuid,
  p_ganador uuid,
  p_perdedor uuid
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = public
as $$
declare
  v_ganador   contactos%rowtype;
  v_perdedor  contactos%rowtype;
  v_tablas_fk int;
  v_resumen   jsonb;
begin
  if p_ganador = p_perdedor then
    raise exception 'Ganador y perdedor son el mismo contacto (%)', p_ganador;
  end if;

  -- El workspace se exige en el WHERE, no se deduce del contacto: así una
  -- fusión nunca puede cruzar dos clientes por un id mal copiado.
  select * into v_ganador  from contactos where id = p_ganador  and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Contacto ganador % no existe en el workspace %', p_ganador, p_workspace_id;
  end if;
  select * into v_perdedor from contactos where id = p_perdedor and workspace_id = p_workspace_id;
  if not found then
    raise exception 'Contacto perdedor % no existe en el workspace %', p_perdedor, p_workspace_id;
  end if;

  -- Guardia contra la tabla nueva que nadie enumeró. Cuenta cuántas columnas de
  -- `public` referencian `contactos.id`; si aparece una más que las 10 conocidas,
  -- la fusión se detiene en vez de dejar filas apuntando a un contacto borrado.
  select count(*) into v_tablas_fk
  from pg_constraint c
  where c.contype = 'f'
    and c.confrelid = 'public.contactos'::regclass
    and c.connamespace = 'public'::regnamespace;
  if v_tablas_fk <> 10 then
    raise exception
      'Hay % referencias a contactos.id y esta función solo repunta 10. Actualizar fusionar_contactos antes de usarla.',
      v_tablas_fk;
  end if;

  -- Historial y actividad
  update contacto_interacciones set contacto_id = p_ganador where contacto_id = p_perdedor;
  update meta_leads_eventos     set contacto_id = p_ganador where contacto_id = p_perdedor;
  update funnelchat_eventos     set contacto_id = p_ganador where contacto_id = p_perdedor;
  update cs_chat_sessions       set contacto_id = p_ganador where contacto_id = p_perdedor;
  update cs_escalamientos       set contacto_id = p_ganador where contacto_id = p_perdedor;
  -- Negocio y estructura
  update negocios      set contacto_id = p_ganador where contacto_id = p_perdedor;
  update oportunidades set contacto_id = p_ganador where contacto_id = p_perdedor;
  update proyectos     set contacto_id = p_ganador where contacto_id = p_perdedor;
  update empresas      set contacto_id = p_ganador where contacto_id = p_perdedor;
  -- Autorreferencia: el perdedor podía ser el promotor de alguien más.
  update contactos set fuente_promotor_id = p_ganador where fuente_promotor_id = p_perdedor;

  -- El ganador se queda con lo que tenga; lo que le falte lo hereda del perdedor.
  -- Nunca al revés: un dato presente no se pisa con otro, porque no hay forma de
  -- saber cuál de los dos es el bueno y sobrescribir sí destruye.
  update contactos set
    telefono = coalesce(v_ganador.telefono, v_perdedor.telefono),
    email    = coalesce(v_ganador.email,    v_perdedor.email),
    -- Nacio despues que esta funcion (migracion 20260902230000). Sin esta linea,
    -- fusionar perderia el usuario de WhatsApp justo en las fichas que menos
    -- datos tienen (sin telefono ni correo), que son las que mas se duplican.
    usuario_whatsapp = coalesce(v_ganador.usuario_whatsapp, v_perdedor.usuario_whatsapp),
    -- Entre dos nombres reales gana el del ganador. El marcador del webhook no
    -- es un nombre: si el ganador lo trae, cede ante cualquier nombre de verdad.
    nombre   = case
                 when upper(trim(v_ganador.nombre)) = 'LEAD SIN NOMBRE'
                  and upper(trim(coalesce(v_perdedor.nombre,''))) <> 'LEAD SIN NOMBRE'
                 then v_perdedor.nombre
                 else v_ganador.nombre
               end,
    fuente_adquisicion = coalesce(v_ganador.fuente_adquisicion, v_perdedor.fuente_adquisicion),
    fuente_detalle     = coalesce(v_ganador.fuente_detalle,     v_perdedor.fuente_detalle),
    segmento           = coalesce(v_ganador.segmento,           v_perdedor.segmento),
    -- El origen de primer toque del más antiguo de los dos es el verdadero.
    custom_data = coalesce(v_ganador.custom_data, '{}'::jsonb)
      || case
           when coalesce(v_ganador.custom_data->'origen', 'null'::jsonb) = 'null'::jsonb
                and v_perdedor.custom_data ? 'origen'
           then jsonb_build_object('origen', v_perdedor.custom_data->'origen')
           else '{}'::jsonb
         end
      -- Rastro de la fusión. Lo que el ganador ya tenía y no pudo heredarse (un
      -- correo distinto, otro teléfono) queda aquí y no se pierde.
      || jsonb_build_object('fusiones',
           coalesce(v_ganador.custom_data->'fusiones', '[]'::jsonb) ||
           jsonb_build_array(jsonb_build_object(
             'contacto_id', p_perdedor,
             'nombre',      v_perdedor.nombre,
             'telefono',    v_perdedor.telefono,
             'email',       v_perdedor.email,
             'creado_en',   v_perdedor.created_at,
             'fusionado_en', now()
           ))),
    updated_at = now()
  where id = p_ganador;

  delete from contactos where id = p_perdedor and workspace_id = p_workspace_id;
  if not found then
    -- RLS o una FK sin repuntar. Sin esto la fusión "terminaría" dejando los dos
    -- contactos vivos y los datos ya movidos al ganador.
    raise exception 'No se pudo borrar el contacto perdedor %', p_perdedor;
  end if;

  select jsonb_build_object(
    'ganador', p_ganador,
    'perdedor', p_perdedor,
    'nombre', c.nombre,
    'telefono', c.telefono,
    'email', c.email,
    'interacciones', (select count(*) from contacto_interacciones i where i.contacto_id = p_ganador),
    'negocios',      (select count(*) from negocios n where n.contacto_id = p_ganador)
  ) into v_resumen
  from contactos c where c.id = p_ganador;

  return v_resumen;
end;
$$;


comment on function fusionar_contactos is
  'Mueve todo lo que cuelga del contacto perdedor al ganador, completa los campos vacios del ganador (incluido usuario_whatsapp), deja constancia en custom_data.fusiones y borra el perdedor. Falla si aparecen tablas nuevas que apunten a contactos.id.';

revoke all on function fusionar_contactos(uuid, uuid, uuid) from public;
grant execute on function fusionar_contactos(uuid, uuid, uuid) to authenticated;
