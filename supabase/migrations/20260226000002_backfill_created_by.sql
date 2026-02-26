-- Backfill created_by for existing gastos/cobros that have NULL created_by.
-- Sets to the workspace owner (role='owner') since most small businesses
-- have a single owner who registered all historical data.

UPDATE gastos g
SET created_by = (
  SELECT p.id FROM profiles p
  WHERE p.workspace_id = g.workspace_id AND p.role = 'owner'
  LIMIT 1
)
WHERE g.created_by IS NULL;

UPDATE cobros c
SET created_by = (
  SELECT p.id FROM profiles p
  WHERE p.workspace_id = c.workspace_id AND p.role = 'owner'
  LIMIT 1
)
WHERE c.created_by IS NULL;
