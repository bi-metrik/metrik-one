-- Cardumen: modo `objetos` — la entrevista vive en el chat y la pagina sirve UN reparto por vez.
--
-- EL PROBLEMA: la mitad web ya esta en produccion. Con `?obj=<id>` la pagina del instrumento
-- (`reframeit.metrik.com.co/adultos` y `/ninos`) muestra UN solo paso de reparto a pantalla
-- completa, hace POST a `cardumen-ingesta` y abre `wa.me` con el texto `Listo <objeto> 50-30-20`
-- prellenado. Del lado del bot no habia nada: el catalogo solo sabia de `modo = 'miniweb'`, que
-- despacha UNA url por estudio y nunca vuelve, y nadie sabia leer ese texto de vuelta. O sea que
-- el modo objeto suelto no se podia usar aunque la pagina ya lo sirviera.
--
-- LA SOLUCION: un modo mas (`objetos`) cuyo `spec` declara la SECUENCIA de objetos. El bot manda
-- el boton de uno, lee el `Listo ...` que vuelve, registra y manda el siguiente. Que el regreso
-- dependa del toque de la persona (y no de un empujon del servidor) es lo que deja a esta
-- secuencia sin necesitar ventana de servicio de 24h ni plantilla aprobada: cada mensaje de ella
-- abre la ventana.
--
-- NO SE TOCA NADA VIVO, a proposito:
--   * `modo = 'chat'` (estudio `navigate`, demo de Grupo Progreso) queda igual;
--   * `modo = 'miniweb'` queda igual, y las DOS filas de instrumento que ya existen
--     (`cardumen-instrumento-adultos` / `-ninos`, palabras `cardumen adultos` / `cardumen ninos`)
--     siguen despachando el instrumento COMPLETO, que es lo que esta evaluando la metodologa del
--     cliente. El modo nuevo entra como filas APARTE con palabras APARTE.
--   * la PK de `cardumen_estudio_triggers` impide que una palabra abra dos estudios, asi que
--     ninguna palabra existente cambia de dueno.
--
-- POR QUE FILAS NUEVAS Y NO LAS MISMAS: una fila tiene UN `modo`. Reusar las filas vivas obligaria
-- a elegir entre el instrumento completo y la secuencia. Con slugs propios, ademas, las dos formas
-- de captura quedan separadas en `cardumen_respuestas.estudio` sin depender de leer el payload.
-- Por eso la url del paso lleva `&e=<slug>` explicito: la pagina, sin `e`, asume el slug del
-- instrumento completo y mezclaria las dos.

-- 1. El modo nuevo entra al CHECK.
alter table public.cardumen_estudios
  drop constraint if exists cardumen_estudios_modo_check;

alter table public.cardumen_estudios
  add constraint cardumen_estudios_modo_check
  check (modo is null or modo in ('chat', 'miniweb', 'flow', 'objetos'));

comment on column public.cardumen_estudios.modo is
  'Via de captura: chat (conversacion por WhatsApp), miniweb (una pagina, una url, no vuelve), flow (WhatsApp Flows), objetos (secuencia de repartos sueltos: el bot manda un boton por paso y lee el texto de vuelta). NULL = comportamiento previo.';

-- 2. Forma del `spec` para modo `objetos` (la lee `leerSpecObjetos` en
--    `supabase/functions/_shared/cardumen/objetos.ts`):
--
--    {
--      "base_url": "https://reframeit.metrik.com.co/adultos",   -- obligatoria, http(s)
--      "encuadre": "<primer mensaje del bot, va con el boton del primer objeto>",
--      "cierre":   "<ultimo mensaje, cierra la sesion>",
--      "objetos":  [ { "id": "<id del paso en el guion>", "titulo": "<etiqueta corta>",
--                      "opciones": <cuantos numeros trae el `Listo ...`> } ]
--    }
--
--    `objetos` es la secuencia, EN ORDEN. `id` tiene que ser el id del paso en el guion del
--    HTML: es lo que viaja en `?obj=` y lo que la pagina escribe en el texto de vuelta.
--    `opciones` no es decorativo: si el numero de porcentajes que llega no coincide, el
--    mensaje viene mutilado y NO se registra (se reenvia el paso).
--
--    Solo entran los pasos de tipo `reparto`: la pagina, en modo objeto, solo sirve esos
--    (`pasoPorId` filtra `t === 'reparto'`). Los pasos narrativos del instrumento
--    (`historia`, `cierre_narrativo`, los `chips` de edad/antiguedad) NO estan aqui porque
--    quien los tendria que hacer es el bot en el chat, y esa mitad todavia no existe.
--
-- 3. TEXTO DEL ENCUADRE: BORRADOR. Dice lo que tiene que decir (que las respuestas se envian
--    al estudio y que el numero de WhatsApp queda ligado como identificador), pero NO es texto
--    legal definitivo: lo revisa Emilio (CLO) antes de que entre una persona real. El de ninos,
--    ademas, necesita decidir quien consiente (menor de edad) — eso tampoco esta resuelto aqui.
insert into public.cardumen_estudios (estudio, nombre, modo, spec, activo)
values
  ('cardumen-objetos-adultos',
   'Cardumen — repartos sueltos, adultos (piloto WhatsApp)',
   'objetos',
   jsonb_build_object(
     'base_url', 'https://reframeit.metrik.com.co/adultos',
     'encuadre', E'🐟 *Cardumen*\n\nToca el botón: se abre una figura y la repartes con el dedo. Son cuatro, una por mensaje, y cada una vuelve sola a este chat.\n\nLo que repartas se envía al estudio y tu número de WhatsApp queda ligado a tus respuestas como identificador. Si no quieres seguir, no toques el botón.\n\nEmpecemos:',
     'cierre', 'Listo, eso era todo. Gracias: tus repartos ya forman parte del cardumen.',
     'objetos', jsonb_build_array(
       jsonb_build_object('id', 'quien_decidio',       'titulo', 'Las tres fuerzas',         'opciones', 3),
       jsonb_build_object('id', 'sentia_vs_esperaban', 'titulo', 'La balanza',               'opciones', 2),
       jsonb_build_object('id', 'semana',              'titulo', 'Tu semana en diez fichas', 'opciones', 5),
       jsonb_build_object('id', 'preocupaciones',      'titulo', 'Lo que te quita el sueño', 'opciones', 8)
     )
   ),
   true),
  ('cardumen-objetos-ninos',
   'Cardumen — repartos sueltos, niños (piloto WhatsApp)',
   'objetos',
   jsonb_build_object(
     'base_url', 'https://reframeit.metrik.com.co/ninos',
     'encuadre', E'🐟 *Cardumen*\n\nToca el botón: se abre un dibujo y lo repartes con el dedo. Son tres, uno por mensaje, y cada uno vuelve solo a este chat.\n\nLo que repartas se envía al estudio y este número de WhatsApp queda ligado a las respuestas como identificador. Si no quieren seguir, no toquen el botón.\n\nEmpecemos:',
     'cierre', '¡Listo! Eso era todo. Gracias por repartir.',
     'objetos', jsonb_build_array(
       jsonb_build_object('id', 'peso_quien',      'titulo', 'El pulpo',     'opciones', 4),
       jsonb_build_object('id', 'como_me_dejo',    'titulo', 'La balanza',   'opciones', 2),
       jsonb_build_object('id', 'donde_tranquilo', 'titulo', 'Las semillas', 'opciones', 3)
     )
   ),
   true)
on conflict (estudio) do update
  set nombre = excluded.nombre,
      modo   = excluded.modo,
      spec   = excluded.spec,
      activo = excluded.activo;

-- 4. Palabras. Se guardan YA normalizadas (minuscula, sin `!¡?¿.,`) porque asi las busca
--    `normalizarTrigger`. La ñ NO se normaliza ahi: `objetos ninos` y `objetos niños` son dos
--    palabras distintas para la consulta, asi que van las dos filas.
--    Ninguna de estas existia: `cardumen`, `cardumen adultos`, `cardumen ninos`,
--    `cardumen niños`, `cardumenadultos`, `cardumenninos`, `cardumen chat`, `cardumenchat`,
--    `trappvel` y variantes siguen apuntando a donde apuntaban.
insert into public.cardumen_estudio_triggers (palabra, estudio) values
  ('objetos adultos', 'cardumen-objetos-adultos'),
  ('objetosadultos',  'cardumen-objetos-adultos'),
  ('repartos',        'cardumen-objetos-adultos'),
  ('objetos ninos',   'cardumen-objetos-ninos'),
  ('objetos niños',   'cardumen-objetos-ninos'),
  ('objetosninos',    'cardumen-objetos-ninos')
on conflict (palabra) do nothing;
