-- Make codigo optional in inserts (trigger overrides it anyway)
ALTER TABLE proyectos ALTER COLUMN codigo SET DEFAULT 0;
