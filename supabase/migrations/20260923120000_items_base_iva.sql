-- Sobre qué va el IVA de una línea de cotización.
--
-- Brief: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-22-iva-sobre-el-ingreso-propio.md
-- Regla fiscal: la «Respuesta de Felipe (22-sep)» de ese brief. El mecanismo vive en
-- src/lib/fiscal/iva-cotizacion.ts.
--
-- Una agencia que vende a nombre de terceros pone IVA solo sobre lo que se queda (precio −
-- lo que le paga al tercero). La base de la cotización la declara el WORKSPACE en
-- `config_extra.iva_cotizacion.base`; esta columna es la excepción por LÍNEA:
--
--   · 'ingreso_propio': a nombre de un tercero. IVA sobre precio − costo del tercero.
--   · 'valor_completo': servicio que la agencia presta con recursos propios. IVA sobre el
--                       precio entero.
--   · 'sin_iva':        comisionable (venta = costo): la comisión se le factura al
--                       proveedor en otro documento. Hacia el viajero, $0.
--   · NULL:             sigue al workspace.
--
-- Compatibilidad: NULL en todas las filas existentes, y NULL no cambia nada. Solo cuenta
-- donde el workspace declara `ingreso_propio`; en los demás nadie la lee. `items` ya tiene
-- RLS y sus grants de tabla (sin grants por columna), así que la columna nueva los hereda.
--
-- DDL puro: no toca datos.

alter table public.items
  add column if not exists base_iva text;

alter table public.items
  drop constraint if exists items_base_iva_valida;

alter table public.items
  add constraint items_base_iva_valida
  check (base_iva is null or base_iva in ('ingreso_propio', 'valor_completo', 'sin_iva'));

comment on column public.items.base_iva is
  'Sobre qué va el IVA de la línea cuando el workspace liquida el IVA sobre el ingreso propio: ingreso_propio (a nombre de un tercero), valor_completo (servicio propio) o sin_iva (comisionable). NULL = sigue al workspace.';

-- Vuelta atrás:
-- alter table public.items drop constraint if exists items_base_iva_valida;
-- alter table public.items drop column if exists base_iva;
