/**
 * Base de sujetos de debida diligencia.
 *
 * Tipos y reglas puras, compartidos entre server actions y cliente. Vive fuera
 * de los archivos `'use server'` porque esos solo pueden exportar funciones
 * async, y porque la regla que decide si alguien está habilitado tiene que
 * poder probarse sin base de datos.
 *
 * ── La decisión de diseño que sostiene todo lo demás ──────────────────────
 *
 * El estado NO se guarda: se calcula. Si fuera una columna que alguien marca,
 * un sujeto vencido seguiría exhibiéndose como habilitado hasta que alguien se
 * acordara de tocarlo, y ese es justamente el caso que el módulo existe para
 * cazar. Aquí el vencimiento ocurre solo, sin cron y sin que nadie pase.
 */

import {
  coberturaDeContraparte,
  claveContraparte,
  type ComplianceLiberacion,
} from './liberaciones';
import { sumarDiasISO } from './periodicidad';

// ─── Vocabulario ───────────────────────────────────────────────────────────

export type TipoSujeto =
  | 'empleado'
  | 'proveedor'
  | 'contratista'
  | 'cliente'
  | 'socio'
  | 'otro';

export const TIPOS_SUJETO: readonly TipoSujeto[] = [
  'empleado',
  'proveedor',
  'contratista',
  'cliente',
  'socio',
  'otro',
];

export const TIPO_SUJETO_LABEL: Readonly<Record<TipoSujeto, string>> = {
  empleado: 'Empleado',
  proveedor: 'Proveedor',
  contratista: 'Contratista',
  cliente: 'Cliente',
  socio: 'Socio o accionista',
  otro: 'Otro',
};

export function esTipoSujeto(v: unknown): v is TipoSujeto {
  return typeof v === 'string' && (TIPOS_SUJETO as readonly string[]).includes(v);
}

/**
 * Los cinco estados de cumplimiento. Cuatro son los del tablero que pidió
 * Mauricio; `sin_consultar` es el quinto y es el que no se puede omitir: el
 * sujeto que está vinculado y al que nadie miró nunca no es "habilitado por
 * defecto".
 */
export type EstadoSujeto =
  /** Vinculado y sin una sola consulta a su nombre. */
  | 'sin_consultar'
  /** Consulta limpia vigente, o liberación vigente del oficial. */
  | 'habilitado'
  /** Liberado, pero el oficial lo dejó bajo observación. */
  | 'en_seguimiento'
  /** Estuvo habilitado y la vigencia caducó. Nadie lo tocó: caducó solo. */
  | 'vencido'
  /** El oficial lo rechazó. Solo otra decisión suya lo levanta. */
  | 'inhabilitado';

export const ESTADOS_SUJETO: readonly EstadoSujeto[] = [
  'habilitado',
  'en_seguimiento',
  'vencido',
  'inhabilitado',
  'sin_consultar',
];

export const ESTADO_SUJETO_LABEL: Readonly<Record<EstadoSujeto, string>> = {
  sin_consultar: 'Sin consultar',
  habilitado: 'Habilitado',
  en_seguimiento: 'Habilitado en seguimiento',
  vencido: 'Vencido',
  inhabilitado: 'Inhabilitado',
};

/**
 * Lo que el ejecutor puede hacer con cada estado, en la única frase que le
 * importa. La pantalla la muestra tal cual: el ejecutor no tiene que traducir
 * "vencido" a "no contrates todavía".
 */
export const ESTADO_SUJETO_ACCION: Readonly<Record<EstadoSujeto, string>> = {
  sin_consultar: 'Falta consultarlo antes de vincularlo.',
  habilitado: 'Puede contratarse.',
  en_seguimiento: 'Puede contratarse, con las condiciones que fijó el oficial.',
  vencido: 'No contratar hasta revalidar.',
  inhabilitado: 'No contratar.',
};

// ─── La ficha ──────────────────────────────────────────────────────────────

export type ComplianceSujeto = {
  id: string;
  tipo: TipoSujeto;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
  staff_id: string | null;
  segmento_id: string | null;
  responsable_profile_id: string | null;
  relacion_desde: string;
  relacion_hasta: string | null;
  motivo_cierre: string | null;
  notas: string | null;
  created_at: string;
};

/**
 * La consulta más reciente SIN hallazgo de este sujeto.
 *
 * Existe porque `coberturaDeContraparte` solo sabe de liberaciones, y una
 * liberación solo se escribe cuando hubo hallazgo. La inmensa mayoría de los
 * proveedores sale limpia y no tiene liberación ninguna: sin este segundo
 * insumo, todos ellos aparecerían como "sin consultar" habiéndose consultado.
 */
export type ConsultaLimpia = {
  created_at: string;
  /** Fecha de revalidación calculada por R2. NULL si el workspace no adoptó periodicidad. */
  vigente_hasta: string | null;
};

/** El resultado completo: el estado y de dónde salió. */
export type SituacionSujeto = {
  estado: EstadoSujeto;
  /** Cuándo caduca lo que hoy lo habilita. NULL si no aplica o no hay periodicidad adoptada. */
  venceEl: string | null;
  /** Qué evidencia decidió el estado. */
  fuente: 'liberacion' | 'consulta' | null;
  /** Eje independiente del estado: la relación operativa está cerrada. */
  relacionCerrada: boolean;
};

export const DIAS_AVISO_SUJETO = 30;

/**
 * La regla, y por qué está en este orden.
 *
 *   1. Un rechazo del oficial gana sobre todo lo demás, incluida una consulta
 *      limpia posterior. Que una lista deje de reportar a alguien no revierte
 *      la decisión de no contratarlo: eso lo levanta el oficial o no se levanta.
 *      Es la única precedencia que no es cronológica, y es deliberada.
 *   2. Con liberación vigente, el estado lo fija la condición de esa liberación:
 *      limpia habilita, condicionada habilita bajo seguimiento.
 *   3. Sin liberación vigente, manda la consulta limpia MÁS RECIENTE, siempre
 *      que sea posterior a la liberación vencida. Si fuera anterior, estaríamos
 *      habilitando con evidencia que el propio oficial ya consideró superada.
 *   4. Lo que estuvo habilitado y caducó es `vencido`, no `sin_consultar`. La
 *      diferencia importa: uno es un descuido de revalidación y el otro es un
 *      sujeto que entró sin pasar por el control.
 *
 * `hoyISO` se recibe, no se calcula: la fecha civil de Bogotá la resuelve
 * `todayBogotaISO()` en el llamador (Vercel corre en UTC).
 */
export function situacionSujeto(
  sujeto: Pick<ComplianceSujeto, 'relacion_hasta'>,
  liberaciones: readonly ComplianceLiberacion[],
  consultaLimpia: ConsultaLimpia | null,
  hoyISO: string,
): SituacionSujeto {
  const relacionCerrada =
    sujeto.relacion_hasta !== null && sujeto.relacion_hasta <= hoyISO;

  const cobertura = coberturaDeContraparte(liberaciones, hoyISO);

  if (cobertura.motivo === 'rechazada') {
    return { estado: 'inhabilitado', venceEl: null, fuente: 'liberacion', relacionCerrada };
  }

  if (cobertura.cubierta && cobertura.liberacion) {
    return {
      estado: cobertura.liberacion.seguimiento ? 'en_seguimiento' : 'habilitado',
      venceEl: cobertura.liberacion.vigente_hasta,
      fuente: 'liberacion',
      relacionCerrada,
    };
  }

  const liberacionVencida = cobertura.motivo === 'vencida' ? cobertura.liberacion : null;
  const consultaEsPosterior =
    consultaLimpia !== null &&
    (liberacionVencida === null || consultaLimpia.created_at > liberacionVencida.created_at);

  if (consultaLimpia && consultaEsPosterior) {
    // Sin periodicidad adoptada la consulta no dice hasta cuándo vale. Habilita
    // igual: quien no adoptó el cuadro es el obligado, y decir "vencido" sería
    // afirmar un vencimiento que nadie fijó. La pantalla lo señala aparte.
    if (!consultaLimpia.vigente_hasta) {
      return { estado: 'habilitado', venceEl: null, fuente: 'consulta', relacionCerrada };
    }
    if (consultaLimpia.vigente_hasta >= hoyISO) {
      return {
        estado: 'habilitado',
        venceEl: consultaLimpia.vigente_hasta,
        fuente: 'consulta',
        relacionCerrada,
      };
    }
    return {
      estado: 'vencido',
      venceEl: consultaLimpia.vigente_hasta,
      fuente: 'consulta',
      relacionCerrada,
    };
  }

  if (liberacionVencida) {
    return {
      estado: 'vencido',
      venceEl: liberacionVencida.vigente_hasta,
      fuente: 'liberacion',
      relacionCerrada,
    };
  }

  // Hubo consulta limpia pero es anterior a una liberación que ya venció: la
  // evidencia buena es la que el oficial superó, así que el sujeto está vencido,
  // no sin consultar.
  if (consultaLimpia) {
    return { estado: 'vencido', venceEl: consultaLimpia.vigente_hasta, fuente: 'consulta', relacionCerrada };
  }

  return { estado: 'sin_consultar', venceEl: null, fuente: null, relacionCerrada };
}

/**
 * ¿Está habilitado hoy pero caduca dentro del margen de aviso?
 *
 * Separado de `situacionSujeto` a propósito: "por vencer" no es un estado, es
 * una alerta sobre un estado. Un sujeto por vencer SÍ se puede contratar hoy, y
 * convertirlo en estado propio haría que el ejecutor dudara de una contratación
 * que es perfectamente válida.
 */
export function porVencer(
  situacion: SituacionSujeto,
  hoyISO: string,
  diasAviso: number = DIAS_AVISO_SUJETO,
): boolean {
  if (situacion.estado !== 'habilitado' && situacion.estado !== 'en_seguimiento') return false;
  if (!situacion.venceEl) return false;
  return situacion.venceEl <= sumarDiasISO(hoyISO, diasAviso);
}

// ─── Permisos ──────────────────────────────────────────────────────────────

/**
 * Quién ve la base: el oficial y también el ejecutor.
 *
 * Es la diferencia con `/compliance/liberaciones`, y no es una inconsistencia.
 * Allá se ve el fundamento del hallazgo, quién quedó reportado y en qué lista;
 * acá se ve un semáforo. El ejecutor necesita la respuesta ("¿puedo contratar a
 * este?") sin la información reservada que la sustenta.
 */
export const ROLES_VER_SUJETOS: readonly string[] = [
  'owner',
  'admin',
  'supervisor',
  'operator',
];

export function puedeVerSujetos(role: string | null | undefined): boolean {
  return !!role && ROLES_VER_SUJETOS.includes(role);
}

/**
 * Quién da de alta y quién cierra la relación: los mismos que la ven.
 *
 * El ejecutor es quien sabe que el proveedor terminó contrato; obligarlo a
 * pedírselo al oficial garantiza que la base quede desactualizada. Lo que NO
 * puede hacer es inhabilitar: eso es `puedeLiberarContrapartes`.
 */
export function puedeGestionarSujetos(role: string | null | undefined): boolean {
  return puedeVerSujetos(role);
}

// ─── Validación ────────────────────────────────────────────────────────────

export const NOMBRE_SUJETO_MAX = 200;
export const MOTIVO_CIERRE_MAX = 500;

export type SujetoInput = {
  tipo: string;
  documento_tipo: string;
  documento_numero: string;
  nombre: string;
};

/** Devuelve el primer problema en español, o null si el input sirve. */
export function validarSujeto(input: SujetoInput): string | null {
  if (!esTipoSujeto(input.tipo)) return 'Elige qué tipo de sujeto es.';

  const tipoDoc = input.documento_tipo.trim();
  if (!tipoDoc) return 'Falta el tipo de documento.';

  const numero = normalizarDocumento(input.documento_numero);
  if (!numero) return 'Falta el número de documento.';
  if (numero.length > 30) return 'El número de documento es demasiado largo.';

  const nombre = input.nombre.trim();
  if (nombre.length < 2) return 'Falta el nombre.';
  if (nombre.length > NOMBRE_SUJETO_MAX) {
    return `El nombre no puede pasar de ${NOMBRE_SUJETO_MAX} caracteres.`;
  }

  return null;
}

export function validarMotivoCierre(motivo: string): string | null {
  const limpio = motivo.trim();
  if (!limpio) return 'Escribe por qué termina la relación. Queda en la bitácora.';
  if (limpio.length > MOTIVO_CIERRE_MAX) {
    return `El motivo no puede pasar de ${MOTIVO_CIERRE_MAX} caracteres.`;
  }
  return null;
}

/**
 * Misma normalización que el trigger de la base y que `partesContraparte`.
 *
 * Las tres tienen que coincidir: la de TypeScript decide qué se muestra, la del
 * trigger decide qué se guarda, y si divergen el unique de la tabla deja de
 * proteger contra el duplicado que la aplicación creía imposible.
 */
export function normalizarDocumento(numero: string | null | undefined): string {
  return (numero ?? '').replace(/[\s.\-_]/g, '').trim().toUpperCase();
}

/** La llave con la que este sujeto se cruza contra liberaciones y consultas. */
export function claveSujeto(
  sujeto: Pick<ComplianceSujeto, 'documento_tipo' | 'documento_numero'>,
): string | null {
  return claveContraparte(sujeto.documento_tipo, sujeto.documento_numero);
}

// ─── Resumen para el tablero ───────────────────────────────────────────────

export type ResumenSujetos = Record<EstadoSujeto, number> & {
  total: number;
  relacionesCerradas: number;
  porVencer: number;
};

export function resumirSujetos(
  situaciones: readonly SituacionSujeto[],
  hoyISO: string,
): ResumenSujetos {
  const base: ResumenSujetos = {
    sin_consultar: 0,
    habilitado: 0,
    en_seguimiento: 0,
    vencido: 0,
    inhabilitado: 0,
    total: 0,
    relacionesCerradas: 0,
    porVencer: 0,
  };

  for (const s of situaciones) {
    base.total += 1;
    base[s.estado] += 1;
    if (s.relacionCerrada) base.relacionesCerradas += 1;
    if (porVencer(s, hoyISO)) base.porVencer += 1;
  }

  return base;
}
