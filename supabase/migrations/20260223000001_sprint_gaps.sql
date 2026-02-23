-- Sprint: Close spec gaps
-- Make presupuesto_total nullable for internal projects

ALTER TABLE proyectos ALTER COLUMN presupuesto_total DROP NOT NULL;
ALTER TABLE proyectos ALTER COLUMN presupuesto_total DROP DEFAULT;
