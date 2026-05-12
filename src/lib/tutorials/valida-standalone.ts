// Tutorial para `/valida` — workspace AFI y futuros workspaces solo-Valida.
// Incluye los 5 steps core + asociacion a negocio + carga masiva.

import {
  stepBienvenida,
  stepConsultaPuntual,
  stepLecturaResultado,
  stepHistorial,
  stepReportePDF,
  stepCargaMasiva,
  stepAsociarNegocio,
} from './_shared';
import type { TutorialDefinition } from './types';

export const validaStandaloneTutorial: TutorialDefinition = {
  slug: 'valida_standalone',
  version: 1,
  title: 'Tutorial Valida', // TODO(mateo)
  intro: 'Recorrido rapido para consultar listas SARLAFT en este workspace.', // TODO(mateo)
  steps: [
    stepBienvenida('valida_explicit'),
    stepConsultaPuntual(),
    stepLecturaResultado(),
    stepAsociarNegocio(),
    stepHistorial(),
    stepCargaMasiva(),
    stepReportePDF(),
  ],
};
