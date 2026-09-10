-- Compliance — el correo de la contraparte en la ficha del sujeto.
--
-- Por qué hace falta una columna y no basta el archivo del cargue.
--
-- Invitar a una contraparte a abrir su expediente CCBF necesita un correo, y
-- hasta ahora ese dato solo existía dentro del formulario que el oficial
-- llenaba a mano, uno por uno. Si el correo viajara solo en el archivo del
-- cargue, invitar a alguien un mes después de haberlo cargado obligaría a
-- volver a buscar el archivo, y reinvitar a quien no contestó sería imposible
-- sin el Excel original. El dato tiene que vivir donde vive el tercero.
--
-- Por qué nullable y sin `check` de formato:
--
--   - Nullable porque la enorme mayoría de la base ya está cargada sin correo,
--     y un `not null` obligaría a inventar direcciones para poder migrar.
--   - Sin regex en la base porque la validación de forma ya está en
--     `correoValido` (src/lib/compliance/solicitud-vinculacion.ts) y duplicarla
--     en dos idiomas garantiza que un día difieran. Lo que SÍ va acá es la
--     normalización, porque el correo llega por varias vías —formulario,
--     cargue masivo, y mañana una integración— y si dependiera de que quien
--     escribe se acordó de normalizar, "Juan@X.com" y "juan@x.com" serían dos
--     contactos distintos del mismo tercero.

alter table compliance_sujetos
  add column if not exists correo text;

comment on column compliance_sujetos.correo is
  'Correo de contacto de la contraparte. Es a donde sale el enlace personal del expediente CCBF. Normalizado por trigger a minúsculas sin espacios.';

create or replace function tg_compliance_sujetos_normalizar()
returns trigger language plpgsql as $$
begin
  new.documento_tipo := upper(btrim(new.documento_tipo));
  new.documento_numero := upper(regexp_replace(new.documento_numero, '[[:space:]._-]', '', 'g'));
  new.nombre := btrim(new.nombre);
  -- `nullif` y no solo `lower`: una cadena vacía que llega de un Excel es
  -- ausencia de correo, no un correo vacío. Guardarla haría que la pantalla
  -- mostrara al tercero como invitable y la invitación fallara después.
  new.correo := nullif(lower(btrim(coalesce(new.correo, ''))), '');
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.tg_compliance_sujetos_normalizar() from public, anon, authenticated;
