-- ============================================================
-- Fix: quitar codigo del nombre de proyecto
-- El codigo ahora vive solo en la columna 'codigo', no en 'nombre'
-- Nombre nuevo: "Empresa · Descripcion" (sin prefijo de codigo)
-- ============================================================

-- 1. Actualizar trigger para NO incluir codigo en nombre
CREATE OR REPLACE FUNCTION trg_proyecto_auto_nombre()
RETURNS TRIGGER AS $$
DECLARE
  v_empresa_nombre TEXT;
  v_oportunidad_codigo TEXT;
  v_next_int_seq INT;
BEGIN
  -- Obtener nombre de empresa
  IF NEW.empresa_id IS NOT NULL THEN
    SELECT nombre INTO v_empresa_nombre FROM empresas WHERE id = NEW.empresa_id;
  END IF;

  -- Asignar codigo
  IF NEW.oportunidad_id IS NOT NULL THEN
    -- Proyecto de oportunidad: heredar codigo de la oportunidad
    SELECT codigo INTO v_oportunidad_codigo FROM oportunidades WHERE id = NEW.oportunidad_id;
    NEW.codigo := v_oportunidad_codigo;
  ELSE
    -- Proyecto interno: generar INT-N
    SELECT COALESCE(MAX(
      CASE
        WHEN p.codigo ~ '^INT-\d+$'
        THEN SUBSTRING(p.codigo FROM 5)::INT
        ELSE 0
      END
    ), 0) + 1
    INTO v_next_int_seq
    FROM proyectos p
    WHERE p.workspace_id = NEW.workspace_id;

    NEW.codigo := 'INT-' || v_next_int_seq;
  END IF;

  -- Generar nombre SIN codigo: "Empresa · Descripcion"
  NEW.nombre := COALESCE(v_empresa_nombre, 'Interno')
    || ' · ' || NEW.nombre;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 2. Limpiar nombres existentes: quitar prefijo de codigo

-- Quitar prefijo viejo P-NNN ·
UPDATE proyectos
SET nombre = REGEXP_REPLACE(nombre, '^P-\d{1,4} · ', '')
WHERE nombre ~ '^P-\d{1,4} · ';

-- Quitar prefijo nuevo CODIGO-N · (ej: BRA-1 · , FAB-12 · )
UPDATE proyectos
SET nombre = REGEXP_REPLACE(nombre, '^[A-Z]{2,3}-\d+ · ', '')
WHERE nombre ~ '^[A-Z]{2,3}-\d+ · ';

-- Quitar prefijo INT-N ·
UPDATE proyectos
SET nombre = REGEXP_REPLACE(nombre, '^INT-\d+ · ', '')
WHERE nombre ~ '^INT-\d+ · ';
