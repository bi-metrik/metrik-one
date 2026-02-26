-- Add direct FK to profiles for PostgREST join support
-- (profiles.id = auth.users.id, so both FKs are consistent)
ALTER TABLE gastos ADD CONSTRAINT gastos_created_by_profiles_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id);

ALTER TABLE cobros ADD CONSTRAINT cobros_created_by_profiles_fkey
  FOREIGN KEY (created_by) REFERENCES profiles(id);
