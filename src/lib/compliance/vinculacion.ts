/**
 * Vinculación de contrapartes (CCBF): el expediente que reemplaza el formato.
 *
 * Qué resuelve: hoy conocer a una contraparte es mandarle un Word, recibir un
 * correo con seis PDF adjuntos y transcribir a mano. El motor que cambia eso
 * ya existe y vive en `metrik-valida`: recibe los documentos, los lee con IA y
 * devuelve cada campo con su confianza y con la línea literal del documento de
 * donde salió. Lo que no existía es la pantalla del oficial de cumplimiento.
 * Esto es esa pantalla.
 *
 * ── Por qué el dato NO se copia a ONE ─────────────────────────────────────
 *
 * El expediente vive en Valida y ONE lo lee por API en cada carga. No se
 * replica acá, y no es por pereza: el expediente tiene retención de 5 años con
 * trigger anti-DELETE y bitácora encadenada por hashes. Una copia en ONE sería
 * una segunda verdad sin ninguna de esas garantías, y ante un auditor dos
 * copias que difieren valen menos que una sola.
 *
 * Lo único que ONE guarda es el espejo de estado (`kyc_expediente_ref`), que
 * llega por webhook firmado y sirve para listar rápido, nunca como fuente.
 *
 * ── La regla que hace útil esta pantalla ──────────────────────────────────
 *
 * Un documento que no se pudo leer NO es un documento sin hallazgos. Si la
 * extracción quedó en `pendiente`, `failed` o `no_key`, los campos de ese
 * documento simplemente no están, y un expediente al que le faltan campos por
 * eso no puede leerse como completo. `alertasDeExpediente` existe para que esa
 * diferencia esté en la pantalla y no en la cabeza de quien revisa.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque estas reglas tienen que poder probarse sin red.
 */

// ─── Vocabulario del expediente (espejo de lib/kyc/types.ts en metrik-valida) ─

export type EstadoExpediente =
  | 'invitado'
  | 'en_proceso'
  | 'pendiente_revision'
  | 'aprobado'
  | 'rechazado'
  | 'devuelto'
  | 'vencido'
  | 'sin_respuesta';

export const ESTADOS_EXPEDIENTE: readonly EstadoExpediente[] = [
  'invitado',
  'en_proceso',
  'pendiente_revision',
  'aprobado',
  'rechazado',
  'devuelto',
  'vencido',
  'sin_respuesta',
];

/** Etiquetas en lenguaje de quien opera, no del schema. */
export const ESTADO_EXPEDIENTE_LABEL: Record<EstadoExpediente, string> = {
  invitado: 'Invitado',
  en_proceso: 'Llenando',
  pendiente_revision: 'Por revisar',
  aprobado: 'Aprobado',
  rechazado: 'Rechazado',
  devuelto: 'Devuelto',
  vencido: 'Enlace vencido',
  sin_respuesta: 'Sin respuesta',
};

/** Qué le toca hacer al oficial con un expediente en ese estado. */
export const ESTADO_EXPEDIENTE_ACCION: Record<EstadoExpediente, string> = {
  invitado: 'Se le envió el enlace y todavía no lo ha abierto.',
  en_proceso: 'La contraparte está subiendo sus documentos.',
  pendiente_revision: 'Firmó y quedó listo. Te toca decidir.',
  aprobado: 'Quedó vinculada. El expediente se conserva 5 años.',
  rechazado: 'No quedó vinculada. El expediente se conserva 5 años.',
  devuelto: 'Se le pidió corregir algo y está de vuelta con la contraparte.',
  vencido: 'El enlace caducó antes de que terminara. Hay que reinvitarla.',
  sin_respuesta: 'Nunca contestó la invitación.',
};

export type EtapaExpediente =
  | 'invitacion'
  | 'documentos'
  | 'formulario'
  | 'bf'
  | 'declaraciones_firma'
  | 'consultas'
  | 'revision_oc'
  | 'archivo';

export const ETAPAS: readonly EtapaExpediente[] = [
  'invitacion',
  'documentos',
  'formulario',
  'bf',
  'declaraciones_firma',
  'consultas',
  'revision_oc',
  'archivo',
];

export const ETAPA_LABEL: Record<EtapaExpediente, string> = {
  invitacion: 'Invitación',
  documentos: 'Documentos',
  formulario: 'Formulario',
  bf: 'Beneficiario final',
  declaraciones_firma: 'Declaraciones y firma',
  consultas: 'Consultas',
  revision_oc: 'Revisión',
  archivo: 'Archivo',
};

export type EstadoExtraccion = 'pendiente' | 'ok' | 'failed' | 'no_key';

export const EXTRACCION_LABEL: Record<EstadoExtraccion, string> = {
  pendiente: 'En cola de lectura',
  ok: 'Leído',
  failed: 'No se pudo leer',
  no_key: 'Lectura no configurada',
};

export type ConfidenceEstado = 'extraido' | 'requiere_confirmacion' | 'manual_obligatorio';

export const CONFIDENCE_LABEL: Record<ConfidenceEstado, string> = {
  extraido: 'Leído del documento',
  requiere_confirmacion: 'Pide confirmación',
  manual_obligatorio: 'Lo llena la contraparte',
};

export type OrigenCampo = 'ia' | 'manual' | 'contraparte';

export const ORIGEN_LABEL: Record<OrigenCampo, string> = {
  ia: 'Extraído del documento',
  manual: 'Cargado por el oficial',
  contraparte: 'Escrito por la contraparte',
};

// ─── Formas que devuelve la API de Valida ─────────────────────────────────

export type ExpedienteFila = {
  expediente_id: string;
  razon_social: string | null;
  nombre: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  estado: EstadoExpediente;
  etapa_actual: EtapaExpediente;
  email_contraparte: string | null;
  fecha_invitacion: string | null;
  fecha_cierre: string | null;
  creado_en: string;
};

export type ExpedienteDoc = {
  doc_id: string;
  slot: string;
  tipo_doc: string | null;
  estado_extraccion: EstadoExtraccion | null;
  vigencia_hasta: string | null;
  mime: string | null;
  size_bytes: number | null;
  subido_en: string | null;
  procesado_en: string | null;
};

export type ExpedienteCampo = {
  campo_id: string;
  doc_id: string | null;
  slug: string;
  value: unknown;
  confidence: number | null;
  confidence_estado: ConfidenceEstado | null;
  source_hint: string | null;
  evidencia: string | null;
  reason_if_null: string | null;
  origen: OrigenCampo;
  confirmado_contraparte: boolean;
};

export type ExpedienteDetalle = {
  expediente_id: string;
  sector: string;
  tipo_sujeto: 'natural' | 'juridica';
  razon_social: string | null;
  nombre: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  email_contraparte: string | null;
  estado: EstadoExpediente;
  etapa_actual: EtapaExpediente;
  decision_oc: Record<string, unknown> | null;
  fecha_invitacion: string | null;
  fecha_cierre: string | null;
  data_retention_until: string | null;
  creado_en: string;
};

// ─── Permisos ─────────────────────────────────────────────────────────────

/**
 * Solo el oficial de cumplimiento, igual que Liberaciones y por la misma razón,
 * no por jerarquía: el expediente trae la cédula del representante legal, la
 * declaración de renta y la cadena de beneficiarios finales. Es el conjunto de
 * datos personales más denso del módulo. El ejecutor ve el resultado en
 * `/compliance/sujetos`, que le dice si puede contratar sin mostrarle nada de
 * esto.
 */
export const ROLES_VER_VINCULACION: readonly string[] = ['owner', 'admin'];

export function puedeVerVinculacion(role: string | null | undefined): boolean {
  return !!role && ROLES_VER_VINCULACION.includes(role);
}

/** Decidir es aprobar o rechazar la vinculación. Mismo conjunto que ver. */
export function puedeDecidirVinculacion(role: string | null | undefined): boolean {
  return puedeVerVinculacion(role);
}

// ─── Progreso ─────────────────────────────────────────────────────────────

/** Posición de la etapa en la secuencia, 1-based. 0 si la etapa no se reconoce. */
export function progresoEtapa(etapa: EtapaExpediente | string): {
  paso: number;
  total: number;
} {
  const i = ETAPAS.indexOf(etapa as EtapaExpediente);
  return { paso: i < 0 ? 0 : i + 1, total: ETAPAS.length };
}

// ─── La decisión ──────────────────────────────────────────────────────────

/**
 * El endpoint de decisión responde 409 si el expediente no está en
 * `pendiente_revision`. Preguntarlo acá evita mandar al oficial a chocar contra
 * un error que se podía anticipar, y sobre todo evita el botón que promete algo
 * que no va a pasar.
 */
export function puedeDecidirse(estado: EstadoExpediente): boolean {
  return estado === 'pendiente_revision';
}

export function razonNoDecidible(estado: EstadoExpediente): string | null {
  if (puedeDecidirse(estado)) return null;
  if (estado === 'aprobado' || estado === 'rechazado') {
    return 'Este expediente ya se decidió. La decisión no se reescribe: si cambió algo, se abre una vinculación nueva.';
  }
  return 'Todavía no se puede decidir: la contraparte no ha terminado de llenar y firmar.';
}

export const MOTIVO_RECHAZO_MIN = 10;

/**
 * Un rechazo sin motivo escrito no le sirve a nadie que lea el expediente
 * después. Aprobar no lo exige: el sustento de una aprobación son los campos y
 * las consultas, que ya quedaron en el expediente.
 */
export function validarMotivoRechazo(motivo: string): string | null {
  const limpio = motivo.trim();
  if (limpio.length === 0) return 'Escribe por qué se rechaza.';
  if (limpio.length < MOTIVO_RECHAZO_MIN) {
    return `El motivo es muy corto: mínimo ${MOTIVO_RECHAZO_MIN} caracteres.`;
  }
  return null;
}

// ─── Lo que hay que mirar antes de decidir ────────────────────────────────

export type Alerta = {
  clave:
    | 'documentos_sin_leer'
    | 'campos_sin_confirmar'
    | 'campos_sin_llenar'
    | 'documentos_faltantes';
  texto: string;
  cuantos: number;
};

/** Documento cuya extracción no llegó a buen puerto: sus campos NO están. */
export function documentosSinLeer(docs: readonly ExpedienteDoc[]): ExpedienteDoc[] {
  return docs.filter((d) => d.estado_extraccion !== 'ok');
}

/**
 * Campo que la contraparte tenía que confirmar y no confirmó. El gate de firma
 * de Valida ya bloquea la firma por esto, así que en un expediente
 * `pendiente_revision` no debería haber ninguno. Se cuenta igual: si aparece,
 * es que algo entró por otra puerta, y eso el oficial tiene que verlo.
 */
export function camposSinConfirmar(campos: readonly ExpedienteCampo[]): ExpedienteCampo[] {
  return campos.filter(
    (c) => c.confidence_estado === 'requiere_confirmacion' && !c.confirmado_contraparte,
  );
}

/** Campo que quedó marcado como "lo llena la contraparte" y sigue vacío. */
export function camposSinLlenar(campos: readonly ExpedienteCampo[]): ExpedienteCampo[] {
  return campos.filter((c) => c.confidence_estado === 'manual_obligatorio' && esVacio(c.value));
}

function esVacio(v: unknown): boolean {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return v.trim() === '';
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** Slots del kit que todavía no tienen documento subido. */
export function slotsFaltantes(
  kit: readonly string[],
  docs: readonly ExpedienteDoc[],
): string[] {
  const subidos = new Set(docs.map((d) => d.slot));
  return kit.filter((slot) => !subidos.has(slot));
}

export function alertasDeExpediente(
  docs: readonly ExpedienteDoc[],
  campos: readonly ExpedienteCampo[],
  kit: readonly string[] = [],
): Alerta[] {
  const alertas: Alerta[] = [];

  const faltantes = slotsFaltantes(kit, docs);
  if (faltantes.length > 0) {
    alertas.push({
      clave: 'documentos_faltantes',
      cuantos: faltantes.length,
      texto:
        faltantes.length === 1
          ? 'Falta 1 documento del kit.'
          : `Faltan ${faltantes.length} documentos del kit.`,
    });
  }

  const sinLeer = documentosSinLeer(docs);
  if (sinLeer.length > 0) {
    alertas.push({
      clave: 'documentos_sin_leer',
      cuantos: sinLeer.length,
      texto:
        sinLeer.length === 1
          ? 'Hay 1 documento que no se pudo leer: sus campos no están, no es que vinieran vacíos.'
          : `Hay ${sinLeer.length} documentos que no se pudieron leer: sus campos no están, no es que vinieran vacíos.`,
    });
  }

  const sinConfirmar = camposSinConfirmar(campos);
  if (sinConfirmar.length > 0) {
    alertas.push({
      clave: 'campos_sin_confirmar',
      cuantos: sinConfirmar.length,
      texto: `${sinConfirmar.length} ${sinConfirmar.length === 1 ? 'campo pedía' : 'campos pedían'} confirmación de la contraparte y no la tiene.`,
    });
  }

  const sinLlenar = camposSinLlenar(campos);
  if (sinLlenar.length > 0) {
    alertas.push({
      clave: 'campos_sin_llenar',
      cuantos: sinLlenar.length,
      texto: `${sinLlenar.length} ${sinLlenar.length === 1 ? 'campo quedó' : 'campos quedaron'} sin llenar.`,
    });
  }

  return alertas;
}

// ─── Agrupación para la pantalla ──────────────────────────────────────────

export type GrupoCampos = {
  /** `doc_id` del documento del que salieron, o null para los que escribió la contraparte. */
  docId: string | null;
  titulo: string;
  campos: ExpedienteCampo[];
};

/**
 * Los campos se muestran agrupados por el documento del que salieron, porque la
 * pregunta del oficial no es "cuántos campos hay" sino "esto de dónde salió".
 * Los que no cuelgan de ningún documento van al final, en su propio grupo.
 */
export function agruparCamposPorDocumento(
  campos: readonly ExpedienteCampo[],
  docs: readonly ExpedienteDoc[],
): GrupoCampos[] {
  const tituloDe = new Map<string, string>();
  for (const d of docs) tituloDe.set(d.doc_id, etiquetaSlot(d.slot));

  const grupos = new Map<string, GrupoCampos>();
  const sueltos: ExpedienteCampo[] = [];

  for (const c of campos) {
    if (c.doc_id === null) {
      sueltos.push(c);
      continue;
    }
    const clave = c.doc_id;
    const existente = grupos.get(clave);
    if (existente) {
      existente.campos.push(c);
    } else {
      grupos.set(clave, {
        docId: clave,
        titulo: tituloDe.get(clave) ?? 'Documento',
        campos: [c],
      });
    }
  }

  const orden = docs
    .map((d) => grupos.get(d.doc_id))
    .filter((g): g is GrupoCampos => g !== undefined);

  // Un campo puede apuntar a un doc que la lista no trajo. No se descarta: se
  // pega al final, porque perder un campo en silencio es lo único que esta
  // pantalla no se puede permitir.
  for (const [clave, grupo] of grupos) {
    if (!docs.some((d) => d.doc_id === clave)) orden.push(grupo);
  }

  if (sueltos.length > 0) {
    orden.push({ docId: null, titulo: 'Escrito por la contraparte', campos: sueltos });
  }

  return orden;
}

/** Slot técnico a nombre de documento. Lo desconocido se muestra tal cual. */
const SLOT_LABEL: Record<string, string> = {
  camara_comercio: 'Cámara de comercio',
  rut: 'RUT',
  estados_financieros: 'Estados financieros',
  cedula_rl: 'Cédula del representante legal',
  cedula: 'Cédula',
  declaracion_renta: 'Declaración de renta',
  rub: 'RUB',
  cert_laboral: 'Certificación laboral',
};

export function etiquetaSlot(slot: string): string {
  return SLOT_LABEL[slot] ?? slot.replace(/_/g, ' ');
}

/**
 * Kit documental mínimo por sector y tipo de sujeto. Espejo de `KITS` en
 * `lib/kyc/types.ts` de metrik-valida: es el mismo contrato, y por eso una
 * combinación desconocida devuelve lista vacía en vez de adivinar. Un kit
 * inventado acá haría que la pantalla reclame documentos que el motor nunca
 * pidió.
 */
export const KITS: Record<string, readonly string[]> = {
  'sagrilaft_estandar:juridica': ['camara_comercio', 'rut', 'estados_financieros', 'cedula_rl'],
  'sagrilaft_estandar:natural': ['cedula', 'rut', 'declaracion_renta'],
};

export function kitDeExpediente(sector: string, tipo: 'natural' | 'juridica'): readonly string[] {
  return KITS[`${sector}:${tipo}`] ?? [];
}

/** Slug de campo a etiqueta legible. No hay catálogo cerrado: se normaliza. */
export function etiquetaCampo(slug: string): string {
  const limpio = slug.replace(/_/g, ' ').trim();
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

/** El valor puede ser escalar, arreglo u objeto. Se muestra siempre algo. */
export function mostrarValor(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map((x) => mostrarValor(x)).join(', ');
  return JSON.stringify(v);
}

// ─── Resumen de la bandeja ────────────────────────────────────────────────

export type ResumenVinculacion = Record<EstadoExpediente, number> & { total: number };

export function resumirExpedientes(filas: readonly ExpedienteFila[]): ResumenVinculacion {
  const base = Object.fromEntries(ESTADOS_EXPEDIENTE.map((e) => [e, 0])) as Record<
    EstadoExpediente,
    number
  >;
  for (const f of filas) {
    if (f.estado in base) base[f.estado] += 1;
  }
  return { ...base, total: filas.length };
}

/** Cómo se nombra a la contraparte en la lista, sin importar si es PN o PJ. */
export function nombreContraparte(
  f: Pick<ExpedienteFila, 'razon_social' | 'nombre' | 'documento_numero'>,
): string {
  const n = (f.razon_social ?? '').trim() || (f.nombre ?? '').trim();
  if (n) return n;
  const doc = (f.documento_numero ?? '').trim();
  return doc ? `Sin nombre (${doc})` : 'Sin nombre';
}
