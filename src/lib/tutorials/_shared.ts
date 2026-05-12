// Steps core compartidos por todos los tutoriales Valida.
// Cada superficie agrega/quita steps especificos en su archivo dedicado.
//
// Convencion: cada step recibe variantes de copy si se necesita adaptar
// (caso `compliance_listas_dual` que NO menciona Valida/Informa por nombre).

import type { TutorialStep } from './types';

export type SharedCopyVariant = 'valida_explicit' | 'dual_neutral';

export function stepBienvenida(variant: SharedCopyVariant): TutorialStep {
  const description =
    variant === 'dual_neutral'
      ? 'Cada consulta cruza varias fuentes y unifica el resultado. Trazabilidad completa para auditoria.'
      : 'Una consulta cruza ONU, OFAC, Union Europea, PEP Colombia y CSN. Tu obligacion como sujeto obligado, sin saltar entre fuentes.';

  const title =
    variant === 'dual_neutral'
      ? 'Validar listas en un solo paso'
      : 'Validar listas SARLAFT en un solo paso';

  return {
    element: null,
    title,
    description,
  };
}

export function stepConsultaPuntual(): TutorialStep {
  return {
    element: '[data-tutorial-target="consulta-puntual-form"]',
    title: 'Consulta puntual',
    description:
      'Escribe nombre, documento o ambos. Cuanto mas completo, mejor el matching. Elige persona natural o juridica arriba.',
    side: 'right',
    align: 'start',
  };
}

export function stepLecturaResultado(): TutorialStep {
  return {
    element: '[data-tutorial-target="resultado-zona"]',
    title: 'Como leer el resultado',
    description:
      'Alto (rojo): bloquea la operacion. Medio o bajo (amarillo): revisa antes de proceder. Sin hallazgo (verde): puedes continuar. El tier indica si la lista es vinculante.',
    side: 'top',
    align: 'center',
  };
}

export function stepHistorial(): TutorialStep {
  return {
    element: '[data-tutorial-target="tab-historial"]',
    title: 'Historial auditable',
    description:
      'Cada consulta queda registrada por 5 anos. Filtras por fecha, severidad o tipo. Soporte de auditoria SARLAFT.',
    side: 'bottom',
    align: 'center',
  };
}

export function stepReportePDF(): TutorialStep {
  return {
    element: null,
    title: 'Reporte descargable',
    description:
      'Cada consulta genera un PDF con hash de integridad. Lo descargas desde el historial cuando lo necesites para auditoria.',
  };
}

export function stepCargaMasiva(): TutorialStep {
  return {
    element: '[data-tutorial-target="tab-masiva"]',
    title: 'Carga masiva por archivo',
    description:
      'Descarga la plantilla, llena hasta 500 filas y sube el archivo. Recibes un XLSX con la severidad de cada fila.',
    side: 'bottom',
    align: 'center',
  };
}

export function stepAsociarNegocio(): TutorialStep {
  return {
    element: '[data-tutorial-target="negocio-picker"]',
    title: 'Asociar al negocio',
    description:
      'Vincula la consulta a un negocio del workspace. Util para agrupar todas las validaciones de un mismo cliente o CDA. Incluye negocios cerrados.',
    side: 'top',
    align: 'start',
  };
}
