-- Cierre excepcional sin factura: conserva el precio aprobado y deja una marca
-- auditable para que los reportes separen cierres facturables de no facturables.
-- Idempotente para entornos que ya hayan recibido parte del cambio.

ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS cierre_no_facturable BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS cierre_no_facturable_motivo TEXT,
  ADD COLUMN IF NOT EXISTS cierre_no_facturable_nota TEXT,
  ADD COLUMN IF NOT EXISTS cierre_no_facturable_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cierre_no_facturable_por UUID REFERENCES staff(id);

ALTER TABLE negocios
  DROP CONSTRAINT IF EXISTS negocios_cierre_no_facturable_consistente;

ALTER TABLE negocios
  ADD CONSTRAINT negocios_cierre_no_facturable_consistente CHECK (
    (
      cierre_no_facturable = false
      AND cierre_no_facturable_motivo IS NULL
      AND cierre_no_facturable_nota IS NULL
      AND cierre_no_facturable_at IS NULL
      AND cierre_no_facturable_por IS NULL
    )
    OR (
      cierre_no_facturable = true
      AND cierre_no_facturable_motivo IN (
        'cortesia_compensacion',
        'incluido_otro_acuerdo',
        'otro'
      )
      AND cierre_no_facturable_at IS NOT NULL
      AND cierre_no_facturable_por IS NOT NULL
      AND (
        cierre_no_facturable_motivo <> 'otro'
        OR length(btrim(coalesce(cierre_no_facturable_nota, ''))) > 0
      )
    )
  );
