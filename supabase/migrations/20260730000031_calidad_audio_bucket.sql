-- Bucket de paso para el audio que se va a auditar.
--
-- ES UN BUZON, NO UN ARCHIVO. El audio entra aqui solo para no viajar dentro
-- del cuerpo de la peticion (que muere a los 4,5 MB) y se borra en cuanto la
-- transcripcion termina, en el `finally` de la ruta. Lo que se conserva del
-- audio es la transcripcion YA REDACTADA; el audio en claro no.
--
-- Lo que sube y baja lo hace SIEMPRE el servidor con service role, via URL
-- firmada de un solo uso. Por eso este bucket NO lleva ninguna politica de RLS:
-- ni `anon` ni `authenticated` tienen por que tocarlo directamente, y la forma
-- de garantizarlo es no darles la politica que se lo permitiria. Si alguna vez
-- alguien agrega una politica aqui, que sea con una razon escrita al lado.
--
-- El limite de peso se repite en tres sitios a proposito (navegador, este
-- bucket, y la ruta despues de descargar). El del navegador es el que da el
-- mensaje bonito; este es el que de verdad no se puede saltar desde el cliente.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'calidad-audio',
  'calidad-audio',
  false,
  18000000,  -- MAX_BYTES_AUDIO en src/lib/calidad/tope-audio.ts
  array[
    'audio/mpeg',
    'audio/mp3',
    'audio/mp4',
    'audio/m4a',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
    'audio/wave',
    'audio/webm',
    'audio/ogg'
  ]
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
