// Tutorial para `/compliance/listas` — workspace ALMA con dual Informa+Valida.
// UX transparente: NO menciona Valida ni Informa por nombre. El cliente solo
// percibe "dos fuentes" unificadas.

import {
  stepBienvenida,
  stepConsultaPuntual,
  stepLecturaResultado,
  stepReportePDF,
  stepCargaMasiva,
} from './_shared';
import type { TutorialDefinition } from './types';

// Nota: esta surface (ALMA) no tiene historial visible al usuario; los datos
// quedan registrados en backend pero la UX prioriza accion sobre auditoria.
// Por eso este tutorial NO incluye stepHistorial.
export const complianceListasDualTutorial: TutorialDefinition = {
  slug: 'compliance_listas_dual',
  version: 1,
  title: 'Tutorial Listas Restrictivas',
  intro: 'Recorrido rapido para consultar listas restrictivas con doble fuente.',
  steps: [
    stepBienvenida('dual_neutral'),
    stepConsultaPuntual(),
    stepLecturaResultado(),
    stepCargaMasiva(),
    stepReportePDF(),
  ],
};
