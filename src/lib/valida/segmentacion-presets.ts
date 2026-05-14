/**
 * Presets de segmentación SARLAFT.
 * Spec autorizada por Lucia (Compliance LA/FT).
 * Los presets son sugerencias iniciales por sector — el sujeto obligado
 * los ajusta y documenta como metodología propia (indelegable).
 */

export type VariableContraparte = 'pais' | 'ciiu' | 'calidad_verificado' | 'forma_operacion' | 'pep_listas';
export type VariableEmpleado = 'ubicacion' | 'tipo_contrato' | 'criticidad_cargo' | 'pep_listas' | 'endeudamiento';

export type PesosContrapartes = Record<VariableContraparte, number>;
export type PesosEmpleados = Record<VariableEmpleado, number>;

export type UmbralesUniverso = {
  alto_min: number;
  medio_min: number;
  frec_alto_meses: number;
  frec_medio_meses: number;
  frec_bajo_meses: number;
};

export type PresetSegmentacion = 'sector_real_general' | 'concesion_vial_transporte' | 'notariado_registro' | 'personalizado';

export type ConfigSegmentacion = {
  preset: PresetSegmentacion;
  pesos_contrapartes: PesosContrapartes;
  pesos_empleados: PesosEmpleados;
  umbrales_contrapartes: UmbralesUniverso;
  umbrales_empleados: UmbralesUniverso;
};

export const UMBRALES_DEFAULT: UmbralesUniverso = {
  alto_min: 2.5,
  medio_min: 1.5,
  frec_alto_meses: 3,
  frec_medio_meses: 6,
  frec_bajo_meses: 12,
};

export const PRESETS: Record<Exclude<PresetSegmentacion, 'personalizado'>, ConfigSegmentacion> = {
  sector_real_general: {
    preset: 'sector_real_general',
    pesos_contrapartes: {
      pais: 0.15,
      ciiu: 0.20,
      calidad_verificado: 0.15,
      forma_operacion: 0.25,
      pep_listas: 0.25,
    },
    pesos_empleados: {
      ubicacion: 0.10,
      tipo_contrato: 0.15,
      criticidad_cargo: 0.25,
      pep_listas: 0.25,
      endeudamiento: 0.25,
    },
    umbrales_contrapartes: UMBRALES_DEFAULT,
    umbrales_empleados: UMBRALES_DEFAULT,
  },
  concesion_vial_transporte: {
    preset: 'concesion_vial_transporte',
    pesos_contrapartes: {
      pais: 0.10,
      ciiu: 0.30,
      calidad_verificado: 0.15,
      forma_operacion: 0.20,
      pep_listas: 0.25,
    },
    pesos_empleados: {
      ubicacion: 0.10,
      tipo_contrato: 0.15,
      criticidad_cargo: 0.30,
      pep_listas: 0.20,
      endeudamiento: 0.25,
    },
    umbrales_contrapartes: UMBRALES_DEFAULT,
    umbrales_empleados: UMBRALES_DEFAULT,
  },
  notariado_registro: {
    preset: 'notariado_registro',
    pesos_contrapartes: {
      pais: 0.10,
      ciiu: 0.15,
      calidad_verificado: 0.25,
      forma_operacion: 0.20,
      pep_listas: 0.30,
    },
    pesos_empleados: {
      ubicacion: 0.10,
      tipo_contrato: 0.15,
      criticidad_cargo: 0.25,
      pep_listas: 0.25,
      endeudamiento: 0.25,
    },
    umbrales_contrapartes: UMBRALES_DEFAULT,
    umbrales_empleados: UMBRALES_DEFAULT,
  },
};

export const PRESET_LABEL: Record<PresetSegmentacion, string> = {
  sector_real_general: 'Sector real general (Supersociedades)',
  concesion_vial_transporte: 'Concesión vial / Transporte (Supertransporte)',
  notariado_registro: 'Notariado y registro',
  personalizado: 'Personalizado',
};

export const VARIABLE_CONTRAPARTE_LABEL: Record<VariableContraparte, string> = {
  pais: 'País',
  ciiu: 'Actividad económica (CIIU)',
  calidad_verificado: 'Calidad del verificado',
  forma_operacion: 'Forma de operación / pago',
  pep_listas: 'PEP + Listas vinculantes (Valida)',
};

export const VARIABLE_EMPLEADO_LABEL: Record<VariableEmpleado, string> = {
  ubicacion: 'Ubicación geográfica',
  tipo_contrato: 'Tipo de contrato',
  criticidad_cargo: 'Criticidad del cargo',
  pep_listas: 'PEP + Listas vinculantes (Valida)',
  endeudamiento: 'Endeudamiento con la empresa',
};

// ─── Tablas de score determinístico (enums cerrados) ──────────────────────

export const SCORE_CALIDAD_VERIFICADO: Record<string, number> = {
  representante_legal: 3,
  accionista: 3,
  apoderado: 2,
  revisor_fiscal: 2,
  miembro_junta: 3,
  beneficiario_final: 3,
  proveedor: 1,
  contratista: 1,
};

export const SCORE_FORMA_OPERACION: Record<string, number> = {
  credito: 2,
  contado: 3,
  anticipado: 1,
  no_aplica: 1,
};

export const SCORE_TIPO_CONTRATO: Record<string, number> = {
  indefinido: 2,
  fijo: 1,
  temporal: 1,
  labor_obra: 2,
  aprendizaje: 1,
};

export const SCORE_CRITICIDAD_CARGO: Record<string, number> = {
  lider: 3,
  tactico: 2,
  operativo: 1,
};

export const SCORE_ENDEUDAMIENTO: Record<string, number> = {
  alto: 3,
  medio: 2,
  bajo: 1,
  no_aplica: 1,
};

// ─── Mapeo Valida severidad → score PEP/Listas ────────────────────────────

export type SeveridadValida = 'alto' | 'medio' | 'bajo' | 'informativo' | 'sin_hallazgo' | 'error';

export type ScorePEPListas = {
  score: number; // 1-3
  bandera: 'bloqueo_ros' | 'diligencia_ampliada' | 'politica_interna' | null;
  reintentar: boolean;
};

export function scorePEPListasDesdeValida(severidad: SeveridadValida): ScorePEPListas {
  switch (severidad) {
    case 'alto':
      return { score: 3, bandera: 'bloqueo_ros', reintentar: false };
    case 'medio':
      // Nota: Valida hoy entrega "medio" agregado. Cuando se diferencie
      // medio-PEP vs medio-referencia, se actualiza este mapeo.
      return { score: 3, bandera: 'diligencia_ampliada', reintentar: false };
    case 'bajo':
      return { score: 1, bandera: 'politica_interna', reintentar: false };
    case 'informativo':
      return { score: 1, bandera: null, reintentar: false };
    case 'sin_hallazgo':
      return { score: 1, bandera: null, reintentar: false };
    case 'error':
      return { score: 0, bandera: null, reintentar: true };
    default:
      return { score: 1, bandera: null, reintentar: false };
  }
}

// ─── Cálculo nivel desde puntaje ──────────────────────────────────────────

export function nivelDesdePuntaje(puntaje: number, umbrales: UmbralesUniverso): 'alto' | 'medio' | 'bajo' {
  if (puntaje >= umbrales.alto_min) return 'alto';
  if (puntaje >= umbrales.medio_min) return 'medio';
  return 'bajo';
}

export function frecuenciaMesesDesdeNivel(nivel: 'alto' | 'medio' | 'bajo', umbrales: UmbralesUniverso): number {
  if (nivel === 'alto') return umbrales.frec_alto_meses;
  if (nivel === 'medio') return umbrales.frec_medio_meses;
  return umbrales.frec_bajo_meses;
}

// ─── Validación que pesos suman 1.0 (con tolerancia) ─────────────────────

export function pesosSumanUno(pesos: Record<string, number>): boolean {
  const total = Object.values(pesos).reduce((acc, v) => acc + v, 0);
  return Math.abs(total - 1.0) < 0.001;
}
