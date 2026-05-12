// Steps core compartidos por todos los tutoriales Valida.
// Cada superficie agrega/quita steps especificos en su archivo dedicado.
//
// Convencion: cada step recibe variantes de copy si se necesita adaptar
// (caso `compliance_listas_dual` que NO menciona Valida/Informa por nombre).

import type { TutorialStep } from './types';

export type SharedCopyVariant = 'valida_explicit' | 'dual_neutral';

// TODO(mateo): copy final aprobado por Mateo. Por ahora placeholders descriptivos.
export function stepBienvenida(variant: SharedCopyVariant): TutorialStep {
  const description =
    variant === 'dual_neutral'
      ? 'Cada consulta cruza dos fuentes de informacion para mayor cobertura. Los resultados se unifican en una respuesta. Cumples tu obligacion como sujeto obligado sin saltar entre fuentes.' // TODO(mateo)
      : 'ONU, OFAC, UE, PEP Colombia, CSN Colombia. Cumples tu obligacion como sujeto obligado sin saltar entre fuentes.'; // TODO(mateo)

  const title =
    variant === 'dual_neutral'
      ? 'Listas SARLAFT en una sola consulta' // TODO(mateo)
      : 'Valida revisa listas SARLAFT en una sola consulta'; // TODO(mateo)

  return {
    element: null,
    title,
    description,
  };
}

export function stepConsultaPuntual(): TutorialStep {
  return {
    element: '[data-tutorial-target="consulta-puntual-form"]',
    title: 'Consulta puntual', // TODO(mateo)
    description:
      'Llena nombre y/o documento. Si das ambos, el matching es mas preciso. Selector de persona natural vs juridica arriba.', // TODO(mateo)
    side: 'right',
    align: 'start',
  };
}

export function stepLecturaResultado(): TutorialStep {
  return {
    element: '[data-tutorial-target="resultado-zona"]',
    title: 'Como leer el resultado', // TODO(mateo)
    description:
      'El badge muestra severidad: Alto (rojo) bloquea, Medio/Bajo (amarillo) requiere revision, Sin hallazgo (verde) puedes proceder. El tier identifica si la lista es vinculante.', // TODO(mateo)
    side: 'top',
    align: 'center',
  };
}

export function stepHistorial(): TutorialStep {
  return {
    element: '[data-tutorial-target="tab-historial"]',
    title: 'Historial auditable', // TODO(mateo)
    description:
      'Toda consulta queda registrada por 5 anos (obligacion regulatoria). Filtras por fecha, severidad, tipo.', // TODO(mateo)
    side: 'bottom',
    align: 'center',
  };
}

export function stepReportePDF(): TutorialStep {
  return {
    element: null,
    title: 'Reporte PDF para auditoria', // TODO(mateo)
    description:
      'Cada consulta genera reporte PDF con hash de integridad para auditoria SARLAFT.', // TODO(mateo)
  };
}

export function stepCargaMasiva(): TutorialStep {
  return {
    element: '[data-tutorial-target="tab-masiva"]',
    title: 'Carga masiva XLSX', // TODO(mateo)
    description:
      'Descarga la plantilla, llena hasta 500 filas, sube y descarga el resultado con severidad por fila.', // TODO(mateo)
    side: 'bottom',
    align: 'center',
  };
}

export function stepAsociarNegocio(): TutorialStep {
  return {
    element: '[data-tutorial-target="negocio-picker"]',
    title: 'Asociar la consulta a un negocio', // TODO(mateo)
    description:
      'Asocia la consulta a un negocio del workspace para agrupar todas las validaciones de un mismo CDA o cliente. Incluye negocios cerrados.', // TODO(mateo)
    side: 'top',
    align: 'start',
  };
}
