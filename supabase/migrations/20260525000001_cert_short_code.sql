-- Codigo corto para el QR de certificacion.
-- El UUID hace una URL larga -> QR muy denso (modulos ~0.43mm en lamina 25mm).
-- Un codigo corto baja la densidad (~0.57mm) para marcado laser confiable.
-- Alfabeto sin caracteres ambiguos (0/O/1/I/L). Globalmente unico (la ruta /c/[code]
-- no lleva workspace; se resuelve el workspace desde la fila).

create or replace function gen_cert_short_code()
returns text language sql volatile as $$
  select string_agg(
    substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', (floor(random() * 31) + 1)::int, 1),
    ''
  )
  from generate_series(1, 8);
$$;

alter table cert_lotes add column if not exists short_code text;

update cert_lotes set short_code = gen_cert_short_code() where short_code is null;

alter table cert_lotes alter column short_code set default gen_cert_short_code();

create unique index if not exists idx_cert_lotes_short_code on cert_lotes(short_code);
