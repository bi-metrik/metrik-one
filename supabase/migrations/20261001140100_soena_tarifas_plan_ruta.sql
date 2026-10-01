-- ============================================================
-- SOENA · tarifas fijas por plan y ruta del servicio «Gestion IT EV/HEV»
-- ============================================================
--
-- Carga la versión 1 de tarifas (brief 2026-10-01, pedido por Mauricio). Valores con
-- IVA, como los maneja SOENA:
--
--                 Completo (100%)   Solo UPME (50%)   Solo DIAN (80%)
--   Plan 1          $910.000          $455.000         no se ofrece
--   Plan 2          $682.500          $341.250          $546.000
--
-- Las casillas no se guardan: salen de `valor del plan × % de la ruta`. Lo que se guarda
-- es el valor de cada plan, el % de cada ruta y la casilla Plan 1 + Solo DIAN marcada
-- como «no se ofrece» (queda abierta para encenderla desde Configuración).
--
-- Tope de descuento del comercial: 25 % sobre el valor de la casilla. Vive en la versión
-- de tarifas, NO en `bloque_configs.config_extra.cap_descuento_pct` (que sigue en 100):
-- los negocios anteriores conservan su esquema (precio estándar + descuento manual) y su
-- tope de siempre.
--
-- Vigencia: negocios CREADOS desde el 2026-10-01 (Bogotá) cuya propuesta todavía no se
-- haya emitido. Una propuesta ya emitida con el esquema anterior no cambia sola de
-- esquema (ver `decidirEsquema` en `src/lib/propuesta/tarifas.ts`).
--
-- Las rutas son los valores de «¿Qué contrató el cliente?» (`servicio_contratado.servicio`),
-- que es lo que la propuesta ya lee como ruta del negocio.
--
-- ## Re-aplicable
--
--   - Si la versión 1 ya existe con este mismo contenido: no hace nada.
--   - Si existe con OTRO contenido (alguien la editó en Configuración y guardó otra), se
--     detiene: esta migración no pisa una tarifa que el cliente ya administró.
--   - Si el servicio, el workspace o las rutas no son los esperados, se detiene.
--
-- Depende de `20261001140000_servicio_tarifas_versiones.sql`.
--
-- ## Verificación después de aplicar (solo lectura)
--
--   select version, vigente_desde, planes, rutas, no_ofrece, cap_descuento_pct
--     from public.servicio_tarifas_versiones
--    where servicio_id = '3d74c1a2-e6a3-4013-b006-4447851d90a4';
--     -> 1 fila, versión 1, vigente desde 2026-10-01, cap 25.00
-- ============================================================

do $$
declare
  v_ws        constant uuid := '7dea141d-d4da-483d-a78d-b14ef35500c5';  -- SOENA
  v_servicio  constant uuid := '3d74c1a2-e6a3-4013-b006-4447851d90a4';  -- Gestion IT EV/HEV
  v_planes    constant jsonb := '[
    {"n": 1, "nombre": "Plan 1 (tarifa plena)", "valor": 910000},
    {"n": 2, "nombre": "Plan 2 (pago anticipado)", "valor": 682500}
  ]'::jsonb;
  v_rutas     constant jsonb := '[
    {"valor": "completo",  "nombre": "Completo (UPME + IVA)",     "pct": 100},
    {"valor": "solo_upme", "nombre": "Solo certificado (UPME)",   "pct": 50},
    {"valor": "solo_iva",  "nombre": "Solo devolución IVA (DIAN)", "pct": 80}
  ]'::jsonb;
  v_no_ofrece constant jsonb := '[{"plan": 1, "ruta": "solo_iva"}]'::jsonb;
  v_cap       constant numeric := 25;
  v_desde     constant date := date '2026-10-01';
  v_opciones  text[];
  v_existente record;
begin
  if not exists (
    select 1 from public.servicios where id = v_servicio and workspace_id = v_ws
  ) then
    raise exception 'El servicio % no existe en el workspace de SOENA', v_servicio;
  end if;

  -- Las rutas tienen que ser exactamente opciones que un negocio puede declarar. Una ruta
  -- con un valor que nadie declara nunca encontraría su casilla.
  select array_agg(o->>'value')
    into v_opciones
    from public.bloque_configs bc,
         jsonb_array_elements(bc.config_extra->'fields') f,
         jsonb_array_elements(f->'opciones') o
   where bc.workspace_id = v_ws
     and bc.slug = 'servicio_contratado'
     and f->>'slug' = 'servicio';
  if v_opciones is null
     or not (array['completo','solo_upme','solo_iva'] <@ v_opciones) then
    raise exception 'servicio_contratado.servicio no ofrece completo/solo_upme/solo_iva (hay: %)', v_opciones;
  end if;

  select * into v_existente
    from public.servicio_tarifas_versiones
   where servicio_id = v_servicio
   order by version
   limit 1;

  if found then
    if v_existente.version = 1
       and v_existente.planes = v_planes
       and v_existente.rutas = v_rutas
       and v_existente.no_ofrece = v_no_ofrece
       and v_existente.cap_descuento_pct = v_cap
       and v_existente.vigente_desde = v_desde then
      raise notice 'La versión 1 de tarifas de SOENA ya está cargada: nada que hacer';
      return;
    end if;
    raise exception 'El servicio ya tiene tarifas distintas de las de esta carga (versión %, vigente desde %). No se pisan.',
      v_existente.version, v_existente.vigente_desde;
  end if;

  insert into public.servicio_tarifas_versiones
    (workspace_id, servicio_id, version, vigente_desde, planes, rutas, no_ofrece, cap_descuento_pct, creado_por, nota)
  values
    (v_ws, v_servicio, 1, v_desde, v_planes, v_rutas, v_no_ofrece, v_cap, null,
     'Carga inicial por migración (brief 2026-10-01).');
end;
$$;
