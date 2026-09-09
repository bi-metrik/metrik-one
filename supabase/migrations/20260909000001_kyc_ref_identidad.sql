-- CCBF — el espejo del expediente aprende quién es la contraparte.
--
-- `kyc_expediente_ref` guardaba estado, etapa, severidad y decisión, pero de la
-- contraparte solo una razón social que además llegaba siempre en null (el
-- webhook de Valida nunca la enviaba). El resultado: una tabla que nadie leía,
-- porque no había forma de pegar ninguna de sus filas a un proveedor concreto.
--
-- Todo el módulo de cumplimiento de ONE cruza contrapartes por la misma llave:
-- (documento_tipo, documento_numero) normalizados — `partesContraparte` en
-- src/lib/compliance/liberaciones.ts. Las liberaciones, las consultas a listas
-- y `compliance_sujetos` ya se encuentran así. El espejo no entraba a ese cruce
-- por no tener documento.
--
-- ── Por qué NO hay `sujeto_id` ────────────────────────────────────────────
--
-- Lo natural parecía una FK a `compliance_sujetos`. No lo es, por el orden en
-- que ocurren las cosas: el expediente casi siempre nace ANTES que la ficha del
-- sujeto (el oficial invita a una contraparte que todavía no está en la base) y
-- a veces nace después. Una FK que se estampa cuando llega el webhook quedaría
-- en null para siempre en el primer caso, y habría que acordarse de rellenarla
-- cuando se cree la ficha — un backfill que nadie recuerda correr.
--
-- Guardando la identidad, la relación se resuelve al leer, en cualquiera de los
-- dos órdenes y sin nada que mantener. Es el mismo criterio que ya aplica esta
-- tabla vecina: `compliance_sujetos` tampoco guarda su estado de cumplimiento,
-- lo deriva.
--
-- ── La normalización va en la base, no solo en la aplicación ──────────────
--
-- El webhook escribe con service_role y el que le manda el cuerpo es otro
-- sistema. Si la normalización dependiera de que quien inserta se acordó de
-- llamarla, un "900.123.456-7" entraría tal cual y no cruzaría con el
-- "9001234567" de la ficha del proveedor, en silencio. Mismo regex que
-- tg_compliance_sujetos_normalizar.

alter table kyc_expediente_ref
  add column if not exists nombre text,
  add column if not exists documento_tipo text,
  add column if not exists documento_numero text;

comment on column kyc_expediente_ref.documento_numero is
  'Normalizado por trigger (sin puntos, guiones ni espacios, en mayúsculas) para cruzar con compliance_sujetos y compliance_liberaciones por claveContraparte.';
comment on column kyc_expediente_ref.nombre is
  'Persona natural. Las jurídicas van en razon_social. Llegan del webhook de Valida, que las deriva del expediente.';

create or replace function tg_kyc_ref_normalizar()
returns trigger language plpgsql as $$
begin
  new.documento_tipo := nullif(upper(btrim(coalesce(new.documento_tipo, ''))), '');
  new.documento_numero := nullif(
    upper(regexp_replace(coalesce(new.documento_numero, ''), '[[:space:]._-]', '', 'g')), '');
  return new;
end;
$$;

revoke execute on function public.tg_kyc_ref_normalizar() from public, anon, authenticated;

drop trigger if exists trg_kyc_ref_normalizar on kyc_expediente_ref;
create trigger trg_kyc_ref_normalizar
  before insert or update on kyc_expediente_ref
  for each row
  execute function tg_kyc_ref_normalizar();

-- El cruce desde la base de sujetos. Parcial: una fila sin documento no cruza
-- con nadie y no tiene por qué ocupar el índice.
create index if not exists idx_kyc_ref_documento
  on kyc_expediente_ref(workspace_id, documento_tipo, documento_numero)
  where documento_numero is not null;
