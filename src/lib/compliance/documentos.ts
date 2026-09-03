/**
 * Índice de documentos del expediente de cumplimiento.
 *
 * Qué resuelve: el objetivo de ALMA es que ante una auditoría externa todo
 * salga de ONE y no toque salir a buscar nada. La plataforma ya tiene la
 * matriz, los controles, las consultas y las liberaciones. Lo que falta es el
 * gobierno: el manual, el acta que lo aprueba, la designación del oficial, los
 * informes a junta y las constancias de capacitación. Esos viven en el Drive
 * del cliente.
 *
 * ── Vigencia, no control de versiones ─────────────────────────────────────
 *
 * Drive ya versiona el contenido. Esto no compite con eso y a propósito no
 * guarda diffs ni copias. Responde una sola pregunta, que es la que hace un
 * auditor:
 *
 *   "El día del hecho, cuál era la versión vigente, quién la aprobó y con qué
 *    acta."
 *
 * Eso no es un atributo del archivo: es un hecho de gobierno, y no está en el
 * historial de revisiones de Drive.
 *
 * ── De quién es cada decisión ─────────────────────────────────────────────
 *
 * El catálogo sugerido de abajo es una sugerencia de MéTRIK, NO una lista de
 * obligaciones. El régimen que obliga a ALMA (SAGRILAFT Supersociedades,
 * Circular 027 Supertransporte o SAGRILAFT ANI) sigue sin resolverse en
 * nuestros archivos, y ninguna pieza puede presentarse como "exigida por
 * norma". Lo que la plataforma afirma es que el obligado declaró esa pieza
 * parte de SU expediente.
 * Ver `cerebro/reglas/cautela-afirmacion-marco-normativo.md`.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque estas reglas tienen que poder probarse sin base de
 * datos.
 */

import { sumarMesesISO } from './liberaciones';
import { sumarDiasISO } from './periodicidad';

// ─── Vocabulario ───────────────────────────────────────────────────────────

export type TipoDocumento =
  | 'manual'
  | 'politica'
  | 'procedimiento'
  | 'acta'
  | 'designacion'
  | 'informe_junta'
  | 'capacitacion'
  | 'otro';

export const TIPOS_DOCUMENTO: readonly TipoDocumento[] = [
  'manual',
  'politica',
  'procedimiento',
  'acta',
  'designacion',
  'informe_junta',
  'capacitacion',
  'otro',
];

export const TIPO_LABEL: Readonly<Record<TipoDocumento, string>> = {
  manual: 'Manual',
  politica: 'Política',
  procedimiento: 'Procedimiento',
  acta: 'Acta',
  designacion: 'Designación',
  informe_junta: 'Informe a junta',
  capacitacion: 'Capacitación',
  otro: 'Otro',
};

export function esTipoDocumento(v: unknown): v is TipoDocumento {
  return typeof v === 'string' && (TIPOS_DOCUMENTO as readonly string[]).includes(v);
}

// ─── Catálogo sugerido ─────────────────────────────────────────────────────

export type PiezaSugerida = {
  codigo: string;
  tipo: TipoDocumento;
  nombre: string;
  descripcion: string;
  /** Cada cuántos meses debería renovarse. null = no vence por calendario. */
  periodicidad_meses: number | null;
};

/**
 * Las piezas que suelen faltarle a un expediente cuando toda la evidencia vive
 * en carpetas. Se siembran solo si el oficial las adopta: sembrarlas de oficio
 * pondría a la plataforma a declarar obligaciones que no verificó.
 *
 * Las periodicidades sugeridas (manual anual, informe trimestral, capacitación
 * anual) son práctica corriente, no números citables. El oficial las cambia.
 */
export const CATALOGO_SUGERIDO: readonly PiezaSugerida[] = [
  {
    codigo: 'MAN-SARLAFT',
    tipo: 'manual',
    nombre: 'Manual del sistema de cumplimiento',
    descripcion: 'El documento marco del sistema. Es la primera pieza que pide cualquier auditoría.',
    periodicidad_meses: 12,
  },
  {
    codigo: 'ACT-ADOPCION',
    tipo: 'acta',
    nombre: 'Acta de aprobación del manual',
    descripcion: 'Sin el acta, el manual es un archivo. Con ella, es una política adoptada.',
    periodicidad_meses: null,
  },
  {
    codigo: 'DES-OC',
    tipo: 'designacion',
    nombre: 'Designación del oficial de cumplimiento',
    descripcion: 'Quién responde por el sistema, desde cuándo y por decisión de quién.',
    periodicidad_meses: null,
  },
  {
    codigo: 'COD-ETICA',
    tipo: 'politica',
    nombre: 'Código de ética y conducta',
    descripcion: 'Lo citan varios controles de la matriz.',
    periodicidad_meses: null,
  },
  {
    codigo: 'POL-CONOCIMIENTO',
    tipo: 'politica',
    nombre: 'Política de conocimiento de contraparte',
    descripcion: 'Qué se le pide a una contraparte antes de vincularla, y con qué criterio.',
    periodicidad_meses: 12,
  },
  {
    codigo: 'PRO-DEBIDA-DILIGENCIA',
    tipo: 'procedimiento',
    nombre: 'Procedimiento de debida diligencia',
    descripcion: 'El paso a paso que la operación sigue. Es lo que un auditor compara contra lo que realmente pasó.',
    periodicidad_meses: 12,
  },
  {
    codigo: 'PRO-REPORTE-UIAF',
    tipo: 'procedimiento',
    nombre: 'Procedimiento de reporte a la UIAF',
    descripcion: 'Cómo se decide y se tramita un reporte. Los reportes en sí no van acá: son evidencia por registro.',
    periodicidad_meses: null,
  },
  {
    codigo: 'INF-JUNTA',
    tipo: 'informe_junta',
    nombre: 'Informe del oficial al órgano de gobierno',
    descripcion: 'La prueba de que el sistema se reporta hacia arriba y no se queda en el escritorio del oficial.',
    periodicidad_meses: 3,
  },
  {
    codigo: 'CAP-ANUAL',
    tipo: 'capacitacion',
    nombre: 'Constancia de capacitación',
    descripcion: 'Con lista de asistentes. Una capacitación sin constancia no se puede demostrar.',
    periodicidad_meses: 12,
  },
  {
    codigo: 'POL-RETENCION',
    tipo: 'politica',
    nombre: 'Política de conservación documental',
    descripcion: 'Cuánto se guarda cada cosa y dónde. Define hasta dónde llega el expediente.',
    periodicidad_meses: null,
  },
];

// ─── Clasificación del enlace ──────────────────────────────────────────────

/**
 * Qué clase de cosa hay del otro lado de la URL.
 *
 * Existe porque la regla que hace que un link cuente como evidencia (apuntar a
 * un archivo congelado, no al documento vivo) no la puede garantizar el
 * software. Lo que sí puede es detectar lo evidente y no dejar pasar en
 * silencio los dos casos que rompen el expediente.
 */
export type ClaseEnlace =
  /** Archivo concreto de Drive. Es lo que se espera. */
  | 'archivo_drive'
  /** Documento nativo de Google: editable, se mueve bajo los pies de la fila. */
  | 'doc_editable'
  /** Carpeta: no es una versión, es justo el "salir a buscar" que hay que evitar. */
  | 'carpeta'
  /** Enlace válido fuera de Drive. No lo sabemos juzgar, se acepta. */
  | 'externo'
  | 'invalido';

const RE_DRIVE_FILE = /^https:\/\/drive\.google\.com\/file\/d\/([A-Za-z0-9_-]{10,})/;
const RE_DRIVE_OPEN = /^https:\/\/drive\.google\.com\/open\?.*\bid=([A-Za-z0-9_-]{10,})/;
const RE_DRIVE_UC = /^https:\/\/drive\.google\.com\/uc\?.*\bid=([A-Za-z0-9_-]{10,})/;
const RE_DRIVE_FOLDER = /^https:\/\/drive\.google\.com\/drive\/folders\//;
const RE_GOOGLE_DOC = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\//;

export function clasificarEnlace(url: unknown): ClaseEnlace {
  if (typeof url !== 'string') return 'invalido';
  const u = url.trim();
  // Solo https: un enlace http en un expediente es evidencia que cualquiera
  // puede interceptar y reemplazar en tránsito.
  if (!/^https:\/\/\S+$/.test(u)) return 'invalido';
  if (RE_DRIVE_FOLDER.test(u)) return 'carpeta';
  if (RE_GOOGLE_DOC.test(u)) return 'doc_editable';
  if (RE_DRIVE_FILE.test(u) || RE_DRIVE_OPEN.test(u) || RE_DRIVE_UC.test(u)) return 'archivo_drive';
  return 'externo';
}

/** El id del archivo en Drive, cuando la URL lo trae. Sirve para verificarlo después. */
export function extraerDriveFileId(url: string): string | null {
  const m =
    RE_DRIVE_FILE.exec(url.trim()) ?? RE_DRIVE_OPEN.exec(url.trim()) ?? RE_DRIVE_UC.exec(url.trim());
  return m ? m[1] : null;
}

/**
 * Devuelve el código de error, o null si la URL sirve para registrar una versión.
 *
 * La carpeta se rechaza y el documento editable no: el editable es un error de
 * higiene que la pantalla advierte y el oficial decide, la carpeta es
 * directamente otra cosa (no hay "versión" de una carpeta, y abrirla obliga al
 * auditor a buscar adentro, que es el problema que este módulo vino a cerrar).
 */
export function validarUrlVersion(url: unknown): string | null {
  const clase = clasificarEnlace(url);
  if (clase === 'invalido') return 'url_invalida';
  if (clase === 'carpeta') return 'url_es_carpeta';
  return null;
}

/** Advertencia para mostrar, no para bloquear. null si no hay nada que advertir. */
export function advertenciaEnlace(url: unknown): string | null {
  return clasificarEnlace(url) === 'doc_editable'
    ? 'Apunta a un documento editable de Google. Si alguien lo edita, esta fila dirá una versión y el archivo tendrá otra. Enlaza el PDF congelado de la versión aprobada.'
    : null;
}

// ─── Estado del expediente ─────────────────────────────────────────────────

export type EstadoDocumento =
  /** Pieza declarada obligatoria sin ninguna versión registrada. */
  | 'faltante'
  /** Hay versión, pero el enlace no responde o no da acceso. */
  | 'link_roto'
  /** La versión vigente pasó su fecha de renovación. */
  | 'vencido'
  /** Le faltan menos de `diasAviso` para vencer. */
  | 'por_vencer'
  | 'vigente';

export const ESTADO_DOC_LABEL: Readonly<Record<EstadoDocumento, string>> = {
  faltante: 'Falta',
  link_roto: 'Enlace roto',
  vencido: 'Vencido',
  por_vencer: 'Por vencer',
  vigente: 'Vigente',
};

/** Mismo aviso que usa la periodicidad de revalidación, por coherencia de lectura. */
export const DIAS_AVISO_DOCUMENTO = 30;

export type VersionParaEstado = {
  fecha_aprobacion: string | null;
  vigente_desde: string;
  url_estado: string | null;
};

export type DocumentoParaEstado = {
  obligatorio: boolean;
  periodicidad_meses: number | null;
};

/**
 * El estado de una pieza del expediente.
 *
 * El orden de prioridad no es arbitrario. `link_roto` gana sobre `vencido`
 * porque un enlace muerto no es evidencia desactualizada: es evidencia que no
 * se puede producir. Un manual vencido al menos se le puede mostrar al auditor.
 *
 * Una pieza no obligatoria sin versión no es "falta": el obligado no la declaró
 * parte de su expediente, y marcarla en rojo entrenaría al oficial a ignorar los
 * rojos.
 */
export function estadoDocumento(
  doc: DocumentoParaEstado,
  vigente: VersionParaEstado | null,
  hoyISO: string,
  diasAviso: number = DIAS_AVISO_DOCUMENTO,
): EstadoDocumento | null {
  if (!vigente) return doc.obligatorio ? 'faltante' : null;
  if (vigente.url_estado === 'rota' || vigente.url_estado === 'sin_permiso') return 'link_roto';

  const vence = fechaVencimiento(doc, vigente);
  if (!vence) return 'vigente';
  // Comparación lexicográfica de `YYYY-MM-DD`: coincide con la cronológica, así
  // que no hay que construir Dates ni arrastrar zona horaria.
  if (vence < hoyISO) return 'vencido';
  return vence <= sumarDiasISO(hoyISO, diasAviso) ? 'por_vencer' : 'vigente';
}

/**
 * Cuándo hay que renovar la versión vigente. null si la pieza no vence.
 *
 * Se cuenta desde la aprobación y no desde `vigente_desde`: una versión puede
 * empezar a regir después de aprobada, y lo que envejece es la decisión, no la
 * fecha en que se publicó. Si no hay fecha de aprobación se usa el inicio de
 * vigencia, que es lo único que se sabe.
 */
export function fechaVencimiento(
  doc: DocumentoParaEstado,
  vigente: VersionParaEstado,
): string | null {
  if (!doc.periodicidad_meses) return null;
  return sumarMesesISO(vigente.fecha_aprobacion ?? vigente.vigente_desde, doc.periodicidad_meses);
}

// ─── La consulta del auditor ───────────────────────────────────────────────

export type VersionConVigencia = {
  vigente_desde: string;
  vigente_hasta: string | null;
};

/**
 * Qué versión regía el día `fechaISO`.
 *
 * Intervalo [vigente_desde, vigente_hasta) con límite superior excluyente: la
 * versión nueva arranca el mismo día en que cierra la anterior, así que ningún
 * día del calendario tiene dos respuestas ni queda sin respuesta.
 */
export function versionVigenteEn<T extends VersionConVigencia>(
  versiones: readonly T[],
  fechaISO: string,
): T | null {
  return (
    versiones.find(
      (v) => v.vigente_desde <= fechaISO && (v.vigente_hasta === null || v.vigente_hasta > fechaISO),
    ) ?? null
  );
}

// ─── Validaciones de entrada ───────────────────────────────────────────────

export function validarCodigo(valor: unknown): string | null {
  if (typeof valor !== 'string') return 'codigo_requerido';
  const v = valor.trim();
  if (v.length < 2 || v.length > 40) return 'codigo_largo_invalido';
  // Mayúsculas, dígitos y guion: es la cita que un auditor escribe a mano en un
  // papel de trabajo, y ahí los espacios y los acentos se pierden.
  if (!/^[A-Z0-9][A-Z0-9-]*$/.test(v)) return 'codigo_formato_invalido';
  return null;
}

export function validarNombre(valor: unknown): string | null {
  if (typeof valor !== 'string') return 'nombre_requerido';
  const v = valor.trim();
  if (v.length < 3 || v.length > 200) return 'nombre_largo_invalido';
  return null;
}

export function validarVersion(valor: unknown): string | null {
  if (typeof valor !== 'string') return 'version_requerida';
  const v = valor.trim();
  if (v.length < 1 || v.length > 40) return 'version_largo_invalido';
  return null;
}

export function validarFechaISO(valor: unknown): string | null {
  if (typeof valor !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) return 'fecha_invalida';
  const [a, m, d] = valor.trim().split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return 'fecha_invalida';
  return null;
}

export const PERIODICIDAD_MIN = 1;
export const PERIODICIDAD_MAX = 120;

/** null (o vacío) es válido: significa que la pieza no vence por calendario. */
export function validarPeriodicidad(valor: unknown): string | null {
  if (valor === null || valor === undefined || valor === '') return null;
  const n = typeof valor === 'string' ? Number(valor.trim()) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'periodicidad_no_numerica';
  if (!Number.isInteger(n)) return 'periodicidad_no_entera';
  if (n < PERIODICIDAD_MIN) return `periodicidad_minimo_${PERIODICIDAD_MIN}`;
  if (n > PERIODICIDAD_MAX) return `periodicidad_maximo_${PERIODICIDAD_MAX}`;
  return null;
}
