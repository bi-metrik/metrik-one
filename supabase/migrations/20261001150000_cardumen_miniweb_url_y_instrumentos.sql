-- Cardumen: el modo `miniweb` pasa a resolverse por el catalogo, como ya lo hace el chat.
--
-- EL PROBLEMA: `modo = 'miniweb'` existe en el CHECK de `cardumen_estudios` desde el
-- 2026-08-12, pero el webhook nunca lo leyo. Las dos mini-webs vivas se despachan con la
-- palabra HARDCODEADA en TypeScript (`isCardumenTrigger` -> `sendCardumenLink`,
-- `isTurismoTrigger` -> `sendTurismoLink`) y su destino tambien: una constante
-- `CARDUMEN_APP_URL` apuntando a un unico deploy de Vercel. Un instrumento nuevo que vive
-- en otro dominio no se puede publicar sin tocar codigo y redesplegar la funcion.
--
-- LA SOLUCION: una columna `url` en el catalogo. El trigger resuelve la fila (MISMA tabla
-- `cardumen_estudio_triggers` y MISMA normalizacion que el chat), y de la fila sale el
-- destino. Un instrumento nuevo = dos INSERT, sin deploy.
--
-- RETROCOMPATIBLE A PROPOSITO: `isCardumenTrigger`/`sendCardumenLink` y el turismo
-- siguen en pie, sin tocar. La palabra `cardumen` sigue resolviendo al estudio `navigate`
-- (modo chat) y la demo viva de Grupo Progreso no cambia de conducta. El bloque nuevo del
-- webhook va DESPUES del de chat: ninguna palabra existente cambia de dueno porque la PK
-- de `cardumen_estudio_triggers` impide que una palabra abra dos estudios.

alter table public.cardumen_estudios
  add column if not exists url text;

comment on column public.cardumen_estudios.url is
  'Destino del instrumento para modo = miniweb. El webhook le agrega ?p=<telefono>&wa=<telefono>. NULL en modo chat/flow; NULL en modo miniweb = el estudio no se despacha (se loguea y no se responde).';

-- Instrumentos de Reframeit (prototipos). HTML estatico ya en produccion, fuera de este
-- repo. Hoy guardan en el dispositivo; el POST a `cardumen-ingesta` se conecta aparte.
--
-- `spec` queda NULL: es nullable y solo lo usa el modo chat.
insert into public.cardumen_estudios (estudio, nombre, modo, url, activo)
values
  ('cardumen-instrumento-adultos',
   'Cardumen — instrumento adultos (prototipo)',
   'miniweb',
   'https://reframeit.metrik.com.co/adultos',
   true),
  ('cardumen-instrumento-ninos',
   'Cardumen — instrumento niños (prototipo)',
   'miniweb',
   'https://reframeit.metrik.com.co/ninos',
   true)
on conflict (estudio) do update
  set nombre = excluded.nombre,
      modo   = excluded.modo,
      url    = excluded.url,
      activo = excluded.activo;

-- Las palabras se guardan YA normalizadas (minuscula, sin `!¡?¿.,`) porque asi las busca
-- `normalizarTrigger`. La ñ NO se normaliza: `cardumen ninos` y `cardumen niños` son dos
-- palabras distintas para la consulta, asi que van las dos filas.
insert into public.cardumen_estudio_triggers (palabra, estudio) values
  ('cardumen adultos',  'cardumen-instrumento-adultos'),
  ('cardumenadultos',   'cardumen-instrumento-adultos'),
  ('cardumen ninos',    'cardumen-instrumento-ninos'),
  ('cardumen niños',    'cardumen-instrumento-ninos'),
  ('cardumenninos',     'cardumen-instrumento-ninos')
on conflict (palabra) do nothing;
