-- Admin workflows v2: identificador por cliente + linea de negocio del cliente

-- Numero de flujo auto-incrementado por cliente_slug. Para identificador visible afi1, soena2, etc.
ALTER TABLE public.admin_workflows
  ADD COLUMN IF NOT EXISTS numero_flujo INT,
  ADD COLUMN IF NOT EXISTS linea_negocio_cliente TEXT;

COMMENT ON COLUMN public.admin_workflows.numero_flujo IS 'Numero secuencial del workflow dentro del cliente. Forma el identificador visible {cliente_slug}{numero_flujo}';
COMMENT ON COLUMN public.admin_workflows.linea_negocio_cliente IS 'Linea de negocio del cliente (distinto de linea_negocio que es la linea de MeTRIK que sirve el flujo)';

-- Backfill numero_flujo para los existentes, ordenado por fecha de creacion
WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY cliente_slug ORDER BY created_at, id) AS rn
  FROM public.admin_workflows
  WHERE numero_flujo IS NULL
)
UPDATE public.admin_workflows aw
SET numero_flujo = ranked.rn
FROM ranked
WHERE aw.id = ranked.id;

-- Unique por cliente_slug + numero_flujo (solo valido mientras no NULL)
CREATE UNIQUE INDEX IF NOT EXISTS idx_admin_workflows_numero_cliente
  ON public.admin_workflows (cliente_slug, numero_flujo)
  WHERE numero_flujo IS NOT NULL;

-- Funcion para asignar el siguiente numero_flujo al insertar
CREATE OR REPLACE FUNCTION public.admin_workflows_assign_numero()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.numero_flujo IS NULL THEN
    SELECT COALESCE(MAX(numero_flujo), 0) + 1
      INTO NEW.numero_flujo
      FROM public.admin_workflows
     WHERE cliente_slug = NEW.cliente_slug;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_admin_workflows_numero ON public.admin_workflows;
CREATE TRIGGER trg_admin_workflows_numero
  BEFORE INSERT ON public.admin_workflows
  FOR EACH ROW EXECUTE FUNCTION public.admin_workflows_assign_numero();
