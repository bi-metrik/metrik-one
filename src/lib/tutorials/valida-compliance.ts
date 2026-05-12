// Tutorial para `/compliance/validacion` — Valida pura dentro del modulo compliance core.
// Solo los 5 steps core. Sin asociacion a negocio, sin masiva.

import {
  stepBienvenida,
  stepConsultaPuntual,
  stepLecturaResultado,
  stepHistorial,
  stepReportePDF,
} from './_shared';
import type { TutorialDefinition } from './types';

export const validaComplianceTutorial: TutorialDefinition = {
  slug: 'valida_compliance',
  version: 1,
  title: 'Tutorial Validacion SARLAFT', // TODO(mateo)
  intro: 'Recorrido rapido para consultar listas restrictivas desde el modulo de compliance.', // TODO(mateo)
  steps: [
    stepBienvenida('valida_explicit'),
    stepConsultaPuntual(),
    stepLecturaResultado(),
    stepHistorial(),
    stepReportePDF(),
  ],
};
