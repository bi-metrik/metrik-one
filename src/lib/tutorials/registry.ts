// Registry central de tutoriales. Importar desde aqui para resolver un slug.

import { validaStandaloneTutorial } from './valida-standalone';
import { validaComplianceTutorial } from './valida-compliance';
import { complianceListasDualTutorial } from './compliance-listas-dual';
import type { TutorialDefinition, TutorialSlug } from './types';

export const TUTORIALS: Record<TutorialSlug, TutorialDefinition> = {
  valida_standalone: validaStandaloneTutorial,
  valida_compliance: validaComplianceTutorial,
  compliance_listas_dual: complianceListasDualTutorial,
};

export function getTutorial(slug: TutorialSlug): TutorialDefinition {
  return TUTORIALS[slug];
}
