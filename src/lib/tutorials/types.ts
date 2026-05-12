// Tipos del sistema de tutoriales in-app reusable.
// Wrapper sobre driver.js — el componente TutorialTour expande estos a DriveStep.

export type TutorialSlug =
  | 'valida_standalone'
  | 'valida_compliance'
  | 'compliance_listas_dual';

export type TutorialStep = {
  /**
   * Selector CSS o `data-tutorial-target` value para resaltar.
   * Si es `null`, el step es un popup centrado sin elemento.
   */
  element: string | null;
  title: string;
  description: string;
  /**
   * Posicion del popover respecto al elemento. Default driver.js: 'auto'.
   */
  side?: 'top' | 'right' | 'bottom' | 'left' | 'over';
  align?: 'start' | 'center' | 'end';
};

export type TutorialDefinition = {
  slug: TutorialSlug;
  version: number;
  title: string;
  intro: string;
  steps: TutorialStep[];
};

export type TutorialProgress = {
  current_step: number;
  completed_at: string | null;
  dismissed_at: string | null;
  version: number;
};
