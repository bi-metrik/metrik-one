-- ============================================================================
-- Código de negocio config-driven por workspace/línea.
--
-- Hasta ahora el código se armaba SIEMPRE como "{empresa|inicial} {AA} {n}"
-- (generate_negocio_codigo / _sin_empresa), con consecutivo MAX+1 por
-- empresa+año. Algunos clientes necesitan un folio corrido y legible por línea
-- (ej. SOENA/VE → V0001, V0002…).
--
-- Este cambio hace el trigger CONFIG-DRIVEN sin hardcodear ningún workspace:
--   workspaces.config_extra.negocio_codigo_format = [
--     { "linea_id": "<uuid>", "prefijo": "V", "padding": 4,
--       "sequence": "public.seq_negocio_codigo_ve_soena" }
--   ]
-- Si el negocio que se inserta pertenece a una línea con regla → el código se
-- genera con esa SEQUENCE (atómica, a prueba de concurrencia, no MAX+1):
--     prefijo || lpad(nextval(sequence), padding, '0')
-- Si NO hay regla para esa línea (todos los demás workspaces/líneas) → cae al
-- comportamiento estándar INTACTO.
--
-- Defensivo: si la regla apunta a una sequence inexistente, también cae al
-- comportamiento estándar (no rompe el INSERT del negocio).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_negocio_auto_codigo()
  RETURNS trigger
  LANGUAGE plpgsql
  SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_fmt     jsonb;
  v_regla   jsonb;
  v_seq     text;
  v_prefijo text;
  v_padding int;
BEGIN
  -- Ya tiene código: no hacer nada
  IF NEW.codigo IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- ── Formato custom config-driven (por línea) ──
  SELECT config_extra -> 'negocio_codigo_format'
    INTO v_fmt
  FROM workspaces
  WHERE id = NEW.workspace_id;

  IF v_fmt IS NOT NULL AND jsonb_typeof(v_fmt) = 'array' AND NEW.linea_id IS NOT NULL THEN
    SELECT r
      INTO v_regla
    FROM jsonb_array_elements(v_fmt) AS r
    WHERE r ->> 'linea_id' = NEW.linea_id::text
    LIMIT 1;

    IF v_regla IS NOT NULL THEN
      v_seq     := v_regla ->> 'sequence';
      v_prefijo := COALESCE(v_regla ->> 'prefijo', '');
      v_padding := COALESCE((v_regla ->> 'padding')::int, 0);

      -- La sequence debe existir; si no, caer al estándar (no romper el INSERT).
      IF v_seq IS NOT NULL AND to_regclass(v_seq) IS NOT NULL THEN
        NEW.codigo := v_prefijo || lpad(nextval(v_seq::regclass)::text, v_padding, '0');
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  -- ── Comportamiento estándar (resto de workspaces/líneas) ──
  IF NEW.empresa_id IS NOT NULL THEN
    NEW.codigo := generate_negocio_codigo(NEW.empresa_id, NEW.workspace_id);
  ELSE
    NEW.codigo := generate_negocio_codigo_sin_empresa(NEW.contacto_id, NEW.workspace_id);
  END IF;

  RETURN NEW;
END;
$function$;
