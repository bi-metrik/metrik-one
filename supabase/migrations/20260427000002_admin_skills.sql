-- admin_skills: índice de skills MéTRIK sincronizado desde .claude/skills/.
-- Solo accesible desde workspace metrik (ADMIN_WORKSPACE_ID).
-- Se actualiza via scripts/sync-skills.js cada vez que se crea/modifica un skill.

CREATE TABLE IF NOT EXISTS public.admin_skills (
  id                       UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre                   TEXT    NOT NULL UNIQUE,
  tipo                     INT,                                -- 1=Proceso 2=Agente 3=Conocimiento 4=Ejecucion
  descripcion              TEXT,
  argument_hint            TEXT,
  disable_model_invocation BOOLEAN DEFAULT false,
  allowed_tools            TEXT[]  DEFAULT ARRAY[]::TEXT[],
  user_invocable           BOOLEAN DEFAULT true,
  effort                   TEXT,                              -- 'high' | null
  contenido                TEXT,                              -- SKILL.md completo
  ultima_sync              TIMESTAMPTZ DEFAULT now(),
  created_at               TIMESTAMPTZ DEFAULT now(),
  updated_at               TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_skills_tipo   ON public.admin_skills(tipo);
CREATE INDEX IF NOT EXISTS idx_admin_skills_nombre ON public.admin_skills(nombre);

COMMENT ON TABLE  public.admin_skills IS 'Índice de skills MéTRIK. Sincronizado via scripts/sync-skills.js desde .claude/skills/.';
COMMENT ON COLUMN public.admin_skills.contenido IS 'Contenido completo del SKILL.md para visualización inline.';

-- Trigger updated_at
CREATE OR REPLACE FUNCTION public.admin_skills_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_admin_skills_updated_at ON public.admin_skills;
CREATE TRIGGER trg_admin_skills_updated_at
  BEFORE UPDATE ON public.admin_skills
  FOR EACH ROW EXECUTE FUNCTION public.admin_skills_updated_at();

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.admin_skills ENABLE ROW LEVEL SECURITY;
-- Sin policies: solo service role accede.
