-- Agrega skill_id a admin_skills.
-- skill_id es el identificador canónico que combina tipo + posición:
--   P01, P02...   → Proceso (pasos Clarity)
--   A1.00, A1.01... → Agente (equipo MéTRIK)
--   O01, O02...   → Organización (procesos internos)
-- Determina el orden visual en la biblioteca de skills.

ALTER TABLE public.admin_skills
  ADD COLUMN IF NOT EXISTS skill_id TEXT;

-- Índice para ordenamiento eficiente
CREATE INDEX IF NOT EXISTS idx_admin_skills_skill_id ON public.admin_skills(skill_id);

-- Unique parcial: solo imponer unicidad cuando skill_id no es null
CREATE UNIQUE INDEX IF NOT EXISTS uidx_admin_skills_skill_id
  ON public.admin_skills(skill_id)
  WHERE skill_id IS NOT NULL;

COMMENT ON COLUMN public.admin_skills.skill_id IS
  'ID canónico del skill: P01/P02 (Proceso), A1.00/A1.01 (Agente), O01/O02 (Organización). Determina orden visual en biblioteca.';
