/**
 * El mostrador: el enlace que la empresa comparte para que un proveedor pida
 * vincularse.
 *
 * ── Por qué no es "el formulario, abierto" ────────────────────────────────
 *
 * La tentación es publicar el formulario de vinculación sin token y que cada
 * quien se registre. Rompe dos cosas:
 *
 *   1. En SARLAFT la debida diligencia arranca con el obligado decidiendo a
 *      quién vincula. Un formulario abierto invierte eso: el tercero se declara
 *      contraparte solo, y la empresa termina conservando cinco años
 *      expedientes de gente con la que nunca pensó contratar.
 *   2. El código de firma viaja al correo del expediente. Si la contraparte
 *      escribe ese correo en un formulario abierto, el OTP solo prueba que
 *      controla un correo que ella misma eligió, y la firma deja de amarrar a
 *      un canal que la empresa ya conocía.
 *
 * Por eso el mostrador pide lo mínimo, y el enlace personal llega por correo.
 * Lo que hace verificable ese correo es justamente que el enlace llegó ahí.
 *
 * ── El aviso de este paso no reemplaza la autorización ────────────────────
 *
 * Acá ya se recogen datos personales (nombre, documento, correo), así que hace
 * falta aviso en el momento de la recolección. Pero es un aviso corto: la
 * autorización completa, con finalidades SARLAFT y transmisión internacional,
 * se sigue pidiendo dentro del enlace personal (`vinculacion-publica.ts`). Este
 * archivo cubre lo que se recoge aquí, no más.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo exportan funciones
 * async, y porque estas reglas tienen que poder probarse sin red.
 */

import { ENCARGADO } from './vinculacion-publica';

// ─── El aviso del mostrador ───────────────────────────────────────────────

/**
 * Tiene que coincidir con `VERSION_AVISO_SOLICITUD` de Valida, que es donde se
 * guarda pegada a la declaración. Si las dos se separan, la fila dice apuntar a
 * un texto que no es el que la persona leyó.
 */
export const VERSION_AVISO_SOLICITUD = 'metrik-aviso-solicitud-vinculacion-v1';

export const CASILLA_AVISO =
  'Entiendo para qué se usan estos datos y autorizo que se traten para iniciar mi vinculación.';

/**
 * Plantilla: no hay forma de renderizarla sin decir de quién es el tratamiento.
 * Bajo la Ley 1581 de 2012 el Responsable es la empresa que invita, y MéTRIK es
 * Encargado. Un aviso que lo dijera al revés sería un aviso defectuoso.
 */
export function textoAvisoSolicitud(empresa: string): string[] {
  return [
    `Responsable del tratamiento: ${empresa}. Los datos que entregues acá (nombre o razón social, documento y correo) se usan únicamente para abrir tu expediente de vinculación y enviarte tu enlace personal.`,
    `Encargado: ${ENCARGADO.nombre} trata estos datos por cuenta de ${empresa} a través de ${ENCARGADO.producto}. Puedes ejercer tus derechos de conocer, actualizar, rectificar y suprimir escribiendo a ${empresa} o a ${ENCARGADO.correo}.`,
    'Cuando abras tu enlace personal se te pedirá la autorización completa, con el detalle de las finalidades y de la transmisión internacional. Este aviso cubre solo lo que entregas en esta pantalla.',
  ];
}

// ─── Los datos que pide el mostrador ──────────────────────────────────────

export type TipoSujeto = 'juridica' | 'natural';

export type TipoDocumento = 'NIT' | 'CC' | 'CE' | 'PAS';

export const DOCUMENTOS_POR_SUJETO: Record<TipoSujeto, readonly TipoDocumento[]> = {
  juridica: ['NIT'],
  natural: ['CC', 'CE', 'PAS'],
};

export const ETIQUETA_DOCUMENTO: Record<TipoDocumento, string> = {
  NIT: 'NIT',
  CC: 'Cédula de ciudadanía',
  CE: 'Cédula de extranjería',
  PAS: 'Pasaporte',
};

export const ETIQUETA_SUJETO: Record<TipoSujeto, string> = {
  juridica: 'Empresa',
  natural: 'Persona natural',
};

export type DatosSolicitud = {
  tipoSujeto: TipoSujeto;
  denominacion: string;
  tipoDocumento: TipoDocumento;
  documento: string;
  correo: string;
  acepta: boolean;
};

export const DATOS_VACIOS: DatosSolicitud = {
  tipoSujeto: 'juridica',
  denominacion: '',
  tipoDocumento: 'NIT',
  documento: '',
  correo: '',
  acepta: false,
};

/**
 * Se quita todo lo que no sea letra o número. La gente escribe el NIT con
 * puntos, con guion y con dígito de verificación, y las tres formas tienen que
 * caer en el mismo expediente: si no, el mismo proveedor entra tres veces.
 */
export function normalizarDocumento(v: string): string {
  return v.replace(/[^0-9A-Za-z]/g, '');
}

export function correoValido(v: string): boolean {
  const s = v.trim();
  // Deliberadamente laxa. Validar correos con expresión regular estricta
  // rechaza direcciones legítimas, y acá el correo se verifica solo: si está
  // mal, el enlace no llega y no hay expediente que avance.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

export const LARGO_MIN_DOCUMENTO = 5;
export const LARGO_MIN_DENOMINACION = 3;

/**
 * Devuelve lo que falta, no un booleano. La pantalla necesita señalar el campo,
 * y un `false` obliga a adivinar cuál era.
 */
export function faltaEnSolicitud(datos: DatosSolicitud): string[] {
  const falta: string[] = [];
  if (datos.denominacion.trim().length < LARGO_MIN_DENOMINACION) {
    falta.push(datos.tipoSujeto === 'juridica' ? 'razon_social' : 'nombre');
  }
  if (normalizarDocumento(datos.documento).length < LARGO_MIN_DOCUMENTO) falta.push('documento');
  if (!correoValido(datos.correo)) falta.push('correo');
  if (!datos.acepta) falta.push('aviso');
  return falta;
}

export function puedeEnviarSolicitud(datos: DatosSolicitud): boolean {
  return faltaEnSolicitud(datos).length === 0;
}

/** Cambiar de persona a empresa deja el tipo de documento en uno imposible. */
export function documentoPorDefecto(tipo: TipoSujeto): TipoDocumento {
  return DOCUMENTOS_POR_SUJETO[tipo][0];
}

export function documentoCoherente(tipo: TipoSujeto, doc: TipoDocumento): boolean {
  return DOCUMENTOS_POR_SUJETO[tipo].includes(doc);
}

// ─── El enlace que la empresa copia ───────────────────────────────────────

/**
 * `ruta` viene de Valida (`/vinculacion/solicitud/<token>`) y el origen lo pone
 * ONE, que es quien sabe bajo qué subdominio está atendiendo. Se normaliza la
 * barra para no producir `https://x.co//vinculacion`, que funciona pero se ve
 * roto justo en el texto que alguien va a pegar en un WhatsApp.
 */
export function urlDeSolicitud(origen: string, ruta: string): string {
  const base = origen.trim().replace(/\/+$/, '');
  const camino = ruta.startsWith('/') ? ruta : `/${ruta}`;
  return `${base}${camino}`;
}

/**
 * El mensaje listo para pegar. Existe porque el enlace pelado, mandado por
 * WhatsApp por alguien de compras, llega como un link sin contexto pidiendo la
 * cédula del representante legal: la forma exacta de una estafa. El texto dice
 * quién invita y para qué antes de que aparezca la URL.
 */
export function mensajeParaCompartir(empresa: string, url: string): string {
  return [
    `Hola. Te escribo de ${empresa}.`,
    '',
    'Para poder trabajar contigo necesitamos conocerte como contraparte. Es un trámite de una sola vez: en este enlace registras tus datos básicos y te llega a tu correo un enlace personal para subir los documentos y firmar.',
    '',
    url,
  ].join('\n');
}

// ─── Errores ──────────────────────────────────────────────────────────────

export type MotivoEnlaceSolicitud = 'no_encontrado' | 'cerrado';

export function esMotivoEnlaceSolicitud(v: string): v is MotivoEnlaceSolicitud {
  return v === 'no_encontrado' || v === 'cerrado';
}

export const MENSAJE_ENLACE_SOLICITUD: Record<MotivoEnlaceSolicitud, string> = {
  no_encontrado:
    'Este enlace no existe o dejó de servir. Pídele a tu contacto en la empresa el enlace vigente.',
  cerrado:
    'La empresa cerró este enlace. Pídele a tu contacto el enlace nuevo, o que te invite directamente.',
};

/**
 * El límite y el fallo de envío se cuentan distinto a propósito. "Muchas
 * solicitudes" invita a esperar; "no salió el correo" invita a revisar la
 * dirección. Un mensaje genérico para los dos deja a la persona sin saber qué
 * hacer.
 */
export function mensajeErrorSolicitud(codigo: string): string {
  switch (codigo) {
    case 'limite_excedido':
      return 'Ya se enviaron varias solicitudes desde acá en la última hora. Espera un momento y vuelve a intentar.';
    case 'datos_invalidos':
      return 'Revisa los datos: falta algo o quedó mal escrito.';
    case 'envio_fallido':
      return 'No pudimos enviar el correo a esa dirección. Verifica que esté bien escrita y vuelve a intentar.';
    case 'no_encontrado':
    case 'cerrado':
      return MENSAJE_ENLACE_SOLICITUD[codigo];
    case 'valida_no_responde':
      return 'No pudimos procesar tu solicitud en este momento. Vuelve a intentar en unos minutos.';
    default:
      return 'No pudimos procesar tu solicitud. Vuelve a intentar en unos minutos.';
  }
}

/**
 * Lo que ve quien acaba de enviar. No confirma si el expediente se creó o si ya
 * existía: la respuesta de Valida es muda a propósito, para que el mostrador no
 * sirva de oráculo para averiguar quién es proveedor de quién. El texto tiene
 * que ser verdadero en los dos casos.
 */
export const MENSAJE_SOLICITUD_ENVIADA =
  'Listo. Si los datos están correctos, en unos minutos te llega un correo con tu enlace personal para continuar. Revisa también la carpeta de spam.';
