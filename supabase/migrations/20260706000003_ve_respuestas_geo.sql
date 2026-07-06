-- Voz de Venezuela — geolocalizacion opcional del testimonio.
-- Cuando la persona comparte su ubicacion por WhatsApp, se guarda la coordenada.
-- Nota de proteccion: los registros con `crisis` NO guardan coordenada (no difundible);
-- ratificacion de politica de datos pendiente con Juanita (instrumento) y Emilio (gate).

alter table public.ve_respuestas
  add column if not exists lat numeric,
  add column if not exists lng numeric,
  add column if not exists ubicacion_fuente text; -- 'gps' | 'texto' | null
