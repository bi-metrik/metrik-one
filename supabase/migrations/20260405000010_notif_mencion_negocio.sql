-- Fix fn_notif_mencion: agregar soporte para entidad_tipo = 'negocio'
-- Antes: el ELSE dejaba deep_link = NULL y entidad_nombre = NULL
-- Ahora: para negocios, resuelve nombre y genera deep_link correcto
CREATE OR REPLACE FUNCTION fn_notif_mencion()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_autor_profile_id UUID;
  v_mencionado_profile_id UUID;
  v_autor_nombre TEXT;
  v_entidad_nombre TEXT;
  v_deep_link TEXT;
BEGIN
  -- Solo menciones con mencion_id
  IF NEW.mencion_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver profile del mencionado (staff → profile)
  SELECT profile_id INTO v_mencionado_profile_id
  FROM staff WHERE id = NEW.mencion_id LIMIT 1;

  IF v_mencionado_profile_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Resolver autor profile
  SELECT profile_id INTO v_autor_profile_id
  FROM staff WHERE id = NEW.autor_id LIMIT 1;

  -- D169: no notificar si autor = mencionado
  IF v_autor_profile_id = v_mencionado_profile_id THEN
    RETURN NEW;
  END IF;

  -- Nombre del autor
  SELECT full_name INTO v_autor_nombre
  FROM staff WHERE id = NEW.autor_id LIMIT 1;

  -- Nombre de la entidad y deep_link según tipo
  IF NEW.entidad_tipo = 'oportunidad' THEN
    SELECT descripcion INTO v_entidad_nombre FROM oportunidades WHERE id = NEW.entidad_id;
    v_deep_link := '/pipeline/' || NEW.entidad_id;
  ELSIF NEW.entidad_tipo = 'proyecto' THEN
    SELECT nombre INTO v_entidad_nombre FROM proyectos WHERE id = NEW.entidad_id;
    v_deep_link := '/proyectos/' || NEW.entidad_id;
  ELSIF NEW.entidad_tipo = 'negocio' THEN
    SELECT nombre INTO v_entidad_nombre FROM negocios WHERE id = NEW.entidad_id;
    v_deep_link := '/negocios/' || NEW.entidad_id;
  ELSE
    v_entidad_nombre := NULL;
    v_deep_link := NULL;
  END IF;

  PERFORM crear_notificacion(
    NEW.workspace_id,
    v_mencionado_profile_id,
    'mencion',
    COALESCE(v_autor_nombre, 'Alguien') || ' te mencionó en "' || COALESCE(v_entidad_nombre, 'un registro') || '"',
    NEW.entidad_tipo,
    NEW.entidad_id,
    v_deep_link,
    jsonb_build_object(
      'autor_nombre', COALESCE(v_autor_nombre, ''),
      'entidad_nombre', COALESCE(v_entidad_nombre, ''),
      'activity_log_id', NEW.id
    )
  );

  RETURN NEW;
END;
$$;
