-- Cardumen: modo `objetos` — la entrevista vive en el chat y la pagina sirve UN reparto por vez.
--
-- EL PROBLEMA: la mitad web ya esta en produccion. Con `?obj=<id>` la pagina del instrumento
-- (`reframeit.metrik.com.co/adultos` y `/ninos`) muestra UN solo paso de reparto a pantalla
-- completa, hace POST a `cardumen-ingesta` y abre `wa.me` con el texto `Listo <objeto> 50-30-20`
-- prellenado. Del lado del bot no habia nada: el catalogo solo sabia de `modo = 'miniweb'`, que
-- despacha UNA url por estudio y nunca vuelve, y nadie sabia leer ese texto de vuelta. O sea que
-- el modo objeto suelto no se podia usar aunque la pagina ya lo sirviera.
--
-- LA SOLUCION: un modo mas (`objetos`) cuyo `spec` declara la SECUENCIA DE PASOS del
-- instrumento. El bot conduce la entrevista completa por WhatsApp (opcion unica, micro-narrativa
-- y los repartos) y para cada reparto manda un boton que abre la pagina en ese paso. Que el
-- regreso dependa del toque de la persona (y no de un empujon del servidor) es lo que deja a
-- esta secuencia sin necesitar ventana de servicio de 24h ni plantilla aprobada: cada mensaje de
-- ella abre la ventana.
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
-- a elegir entre el instrumento completo y la entrevista por WhatsApp. Con slugs propios, ademas,
-- las dos formas de captura quedan separadas en `cardumen_respuestas.estudio` sin depender de
-- leer el payload. Por eso la url del paso lleva `&e=<slug>` explicito: la pagina, sin `e`, asume
-- el slug del instrumento completo y mezclaria las dos.

-- 1. El modo nuevo entra al CHECK.
alter table public.cardumen_estudios
  drop constraint if exists cardumen_estudios_modo_check;

alter table public.cardumen_estudios
  add constraint cardumen_estudios_modo_check
  check (modo is null or modo in ('chat', 'miniweb', 'flow', 'objetos'));

comment on column public.cardumen_estudios.modo is
  'Via de captura: chat (conversacion por WhatsApp con entrevistador), miniweb (una pagina, una url, no vuelve), flow (WhatsApp Flows), objetos (el bot conduce la secuencia de pasos del instrumento y la pagina sirve un reparto por vez). NULL = comportamiento previo.';

-- 2. Forma del `spec` para modo `objetos` (la lee `leerSpecObjetos` en
--    `supabase/functions/_shared/cardumen/objetos.ts`):
--
--    {
--      "base_url": "https://reframeit.metrik.com.co/adultos",   -- obligatoria, http(s)
--      "encuadre": "<primer mensaje del bot, va en mensaje aparte>",
--      "cierre":   "<ultimo mensaje, cierra la sesion>",
--      "pasos": [
--        { "tipo": "chips",   "id": "...", "pregunta": "<LITERAL>", "opciones": ["...","..."] },
--        { "tipo": "relato",  "id": "...", "pregunta": "<LITERAL>" },
--        { "tipo": "reparto", "id": "...", "titulo": "<etiqueta corta>", "opciones": <cuantos> }
--      ]
--    }
--
--    `pasos` es la secuencia, EN ORDEN, y los `id` son los del guion del HTML: es lo que viaja
--    en `?obj=` para un reparto y lo que la pagina escribe en el texto de vuelta.
--
--    LOS ENUNCIADOS SON LITERALES. El bot manda `pregunta` tal cual, palabra por palabra: no la
--    parafrasea, no la adapta y no la genera con un modelo. Si el enunciado cambia entre
--    participantes, las respuestas dejan de ser comparables y el estudio no sirve. Mismo
--    principio que `literal_es` en el spec del modo chat. Un paso narrativo SIN `pregunta`
--    invalida el spec a proposito: preferimos que no despache antes que una pregunta inventada.
--    Cambiar la redaccion = cambiar esta migracion (o el guion del HTML) primero.
--
--    `opciones` del reparto (un numero) no es decorativo: si la cantidad de porcentajes que
--    llega no coincide, el mensaje viene mutilado y NO se registra, se reenvia el paso.
--
--    Los `t:'bot'` del guion (las frases de transicion del instrumento web) NO entran: en el
--    chat el acuse va pegado al boton del reparto siguiente, y mandarlos sueltos seria sumar
--    mensajes sin dato. El relato se guarda VERBATIM y el acuse es neutro: el bot no resume ni
--    le repite la historia a la persona en otras palabras.
--
-- 3. TEXTO DEL ENCUADRE: BORRADOR. Dice lo que tiene que decir (que las respuestas se envian
--    al estudio y que el numero de WhatsApp queda ligado como identificador), pero NO es texto
--    legal definitivo: lo revisa Emilio (CLO) antes de que entre una persona real. El de ninos,
--    ademas, necesita decidir quien consiente (menor de edad) — eso tampoco esta resuelto aqui.
insert into public.cardumen_estudios (estudio, nombre, modo, spec, activo)
values
  ('cardumen-objetos-adultos',
   'Cardumen — entrevista por WhatsApp, adultos (piloto)',
   'objetos',
   jsonb_build_object(
     'base_url', 'https://reframeit.metrik.com.co/adultos',
     'encuadre', E'🐟 *Cardumen*\n\nSon unas preguntas cortas y no hay respuestas correctas. Primero tu historia; después tú mismo la ubicas. Yo no la interpreto.\n\nLo que respondas se envía al estudio y tu número de WhatsApp queda ligado a tus respuestas como identificador. Si no quieres seguir, no respondas.',
     'cierre', 'Listo, eso era todo. Gracias: lo que contaste ya forma parte del cardumen.',
     'pasos', jsonb_build_array(
       jsonb_build_object(
         'tipo', 'chips', 'id', 'antiguedad',
         'pregunta', '¿Cuánto llevas en tu trabajo actual?',
         'opciones', jsonb_build_array('Menos de 1 año', '1 a 3 años', '3 a 7 años', 'Más de 7 años')),
       jsonb_build_object(
         'tipo', 'relato', 'id', 'historia',
         'pregunta', 'Cuéntame una situación reciente del trabajo que de verdad te haya costado. No necesito el contexto completo, solo lo que pasó.'),
       jsonb_build_object('tipo', 'reparto', 'id', 'quien_decidio',       'titulo', 'Las tres fuerzas',         'opciones', 3),
       jsonb_build_object('tipo', 'reparto', 'id', 'sentia_vs_esperaban', 'titulo', 'La balanza',               'opciones', 2),
       jsonb_build_object('tipo', 'reparto', 'id', 'semana',              'titulo', 'Tu semana en diez fichas', 'opciones', 5),
       jsonb_build_object('tipo', 'reparto', 'id', 'preocupaciones',      'titulo', 'Lo que te quita el sueño', 'opciones', 8),
       jsonb_build_object(
         'tipo', 'relato', 'id', 'cierre_narrativo',
         'pregunta', 'Para terminar: si pudieras cambiar una sola cosa de lo que me contaste al principio, ¿cuál sería?')
     )
   ),
   true),
  ('cardumen-objetos-ninos',
   'Cardumen — entrevista por WhatsApp, niños (piloto)',
   'objetos',
   jsonb_build_object(
     'base_url', 'https://reframeit.metrik.com.co/ninos',
     'encuadre', E'🐟 *Cardumen*\n\nSon unas preguntas cortas. No hay respuestas buenas ni malas y nadie te va a calificar.\n\nLo que respondas se envía al estudio y este número de WhatsApp queda ligado a las respuestas como identificador. Si no quieren seguir, no respondan.',
     'cierre', '¡Listo! Eso era todo. Gracias por contármelo.',
     'pasos', jsonb_build_array(
       jsonb_build_object(
         'tipo', 'chips', 'id', 'edad',
         'pregunta', 'Primero, lo más fácil: ¿cuántos años tienes?',
         'opciones', jsonb_build_array('8', '9', '10', '11', '12')),
       jsonb_build_object(
         'tipo', 'relato', 'id', 'historia',
         'pregunta', 'Ahora cuéntame algo que te pasó esta semana y que todavía te acuerdas. Puede ser bueno o puede ser feo.'),
       jsonb_build_object('tipo', 'reparto', 'id', 'peso_quien',      'titulo', 'El pulpo',     'opciones', 4),
       jsonb_build_object('tipo', 'reparto', 'id', 'como_me_dejo',    'titulo', 'La balanza',   'opciones', 2),
       jsonb_build_object('tipo', 'reparto', 'id', 'donde_tranquilo', 'titulo', 'Las semillas', 'opciones', 3),
       jsonb_build_object(
         'tipo', 'chips', 'id', 'le_conte',
         'pregunta', 'Una última: ¿eso que me contaste se lo habías contado a alguien más?',
         'opciones', jsonb_build_array('Sí, a un adulto', 'Sí, a un amigo', 'No, a nadie'))
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
