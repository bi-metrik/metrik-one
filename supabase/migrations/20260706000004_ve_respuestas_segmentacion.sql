-- Voz de Venezuela — campos de segmentacion demografica (opcionales, recolectados al cierre).
-- Estandar de desagregacion humanitaria (edad/sexo/genero) + zona rural/urbana.
-- Opcionales: la persona responde solo lo que quiera. Server-only (ve_respuestas es RLS + service-role).

alter table public.ve_respuestas
  add column if not exists edad   int,
  add column if not exists sexo   text,
  add column if not exists genero text,   -- genero con el que se identifica (identidad de genero)
  add column if not exists zona   text;   -- 'rural' | 'urbano' | null
