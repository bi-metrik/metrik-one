/**
 * Lo que la contraparte firma antes de entregar un solo documento.
 *
 * La cláusula 3.3 del addendum CCBF no deja esto a criterio del producto: dice
 * que "la autorización de tratamiento y el aviso de privacidad se obtienen de
 * la contraparte EN EL FLUJO DE VINCULACIÓN, con información clara sobre las
 * finalidades SARLAFT, la intervención de MéTRIK como Encargado y la
 * transmisión internacional". Este archivo es esa obligación hecha código.
 *
 * ── Quién es Responsable, y por qué el texto no lo puede decir mal ────────
 *
 * Bajo la Ley 1581 de 2012 el **Responsable es la empresa que invita** (la que
 * decide vincular y define la finalidad), y MéTRIK es **Encargado** (trata por
 * cuenta de ella). Una autorización que nombrara a MéTRIK como responsable
 * sería una autorización defectuosa, y con ella todo el expediente queda mal
 * parado. Por eso los textos son plantillas que reciben el nombre de la
 * empresa: no hay forma de renderizarlos sin decir de quién es el tratamiento.
 *
 * ── La versión es la prueba ───────────────────────────────────────────────
 *
 * Se guarda `texto_version` junto con la aceptación. Sin eso, dentro de tres
 * años nadie puede decir QUÉ aceptó esta persona, solo que aceptó algo. Y por
 * lo mismo una aceptación de una versión anterior NO vale para la vigente: si
 * el texto cambia, se vuelve a pedir. `faltaAceptar` implementa exactamente eso.
 *
 * Vive fuera de los archivos `'use server'` porque esos solo pueden exportar
 * funciones async, y porque estas reglas tienen que poder probarse sin red.
 */

// ─── Identidad de MéTRIK como Encargado ───────────────────────────────────

export const ENCARGADO = {
  nombre: 'MéTRIK IA SAS',
  producto: 'MeTRIK ONE',
  correo: 'mauricio.moreno@metrik.com.co',
} as const;

// ─── Las dos aceptaciones ─────────────────────────────────────────────────

export type TipoAceptacion = 'nda' | 'autorizacion_datos';

export const TIPOS_ACEPTACION: readonly TipoAceptacion[] = ['nda', 'autorizacion_datos'];

/**
 * Versión del texto. Cambiar el texto SIN cambiar esto deja aceptaciones que
 * dicen apuntar a un contenido que ya no existe. Cambiarlo obliga a que todo el
 * mundo vuelva a aceptar, que es el comportamiento correcto.
 */
export const VERSION_TEXTO: Record<TipoAceptacion, string> = {
  nda: 'metrik-confidencialidad-contraparte-v1',
  autorizacion_datos: 'metrik-autorizacion-datos-contraparte-v1',
};

export const TITULO_ACEPTACION: Record<TipoAceptacion, string> = {
  nda: 'Compromiso de confidencialidad',
  autorizacion_datos: 'Autorización de tratamiento de datos personales',
};

/** La frase del checkbox. Es lo único que mucha gente va a leer completo. */
export const CASILLA_ACEPTACION: Record<TipoAceptacion, string> = {
  nda: 'Leí y acepto el compromiso de confidencialidad.',
  autorizacion_datos:
    'Autorizo el tratamiento de mis datos personales en los términos anteriores.',
};

export type TextoAceptacion = {
  tipo: TipoAceptacion;
  version: string;
  titulo: string;
  casilla: string;
  parrafos: string[];
};

/**
 * Los textos. Son los de MéTRIK, con el nombre de la empresa que invita puesto
 * donde tiene que ir. No se presentan como concepto legal del cliente: son la
 * plantilla que MéTRIK pone a disposición, y el cliente puede reemplazarla.
 */
export function textosAceptacion(responsable: string): TextoAceptacion[] {
  const empresa = responsable.trim() || 'la empresa que te invitó';
  return [
    {
      tipo: 'nda',
      version: VERSION_TEXTO.nda,
      titulo: TITULO_ACEPTACION.nda,
      casilla: CASILLA_ACEPTACION.nda,
      parrafos: [
        `${empresa} te pide esta información para cumplir sus obligaciones de conocimiento de contrapartes. Todo lo que subas acá se usa para eso y para nada más.`,
        `La información se guarda en la plataforma ${ENCARGADO.producto}, operada por ${ENCARGADO.nombre}, con acceso restringido al oficial de cumplimiento de ${empresa} y al personal de ${ENCARGADO.nombre} que necesite entrar para operar y sostener la plataforma.`,
        `Ni ${empresa} ni ${ENCARGADO.nombre} van a divulgar a terceros los documentos que entregues, salvo requerimiento de autoridad competente o cuando la ley lo exija. Esta obligación sigue vigente aunque la vinculación no se concrete.`,
        `Tú también te comprometes a no divulgar la información que ${empresa} te comparta a través de este enlace.`,
      ],
    },
    {
      tipo: 'autorizacion_datos',
      version: VERSION_TEXTO.autorizacion_datos,
      titulo: TITULO_ACEPTACION.autorizacion_datos,
      casilla: CASILLA_ACEPTACION.autorizacion_datos,
      parrafos: [
        `Responsable del tratamiento: ${empresa}. Es quien decide vincularte y quien define para qué se usan tus datos.`,
        `Encargado: ${ENCARGADO.nombre}, que trata los datos por cuenta de ${empresa} para operar la plataforma ${ENCARGADO.producto}.`,
        'Finalidad: verificar tu identidad y la de tu representante legal, socios y beneficiarios finales; consultar listas restrictivas y de personas expuestas políticamente; evaluar el riesgo de lavado de activos y financiación del terrorismo; y sustentar la decisión de vincularte. No se usan para publicidad ni se venden.',
        'Datos que se tratan: los de los documentos que subas y los que confirmes en el formulario, incluidos identificación, datos de contacto, información societaria y financiera, y datos de las personas relacionadas contigo que aparezcan en esos documentos.',
        'Lectura automatizada: los documentos se procesan con inteligencia artificial para proponer los datos ya escritos. Lo que la máquina propone no se da por cierto: tú lo confirmas o lo corriges antes de firmar, y la decisión final la toma una persona.',
        'Transmisión internacional: ese procesamiento automatizado se hace con proveedores ubicados fuera de Colombia, incluidos Estados Unidos, bajo las garantías del artículo 26 de la Ley 1581 de 2012.',
        'Conservación: el expediente se conserva cinco (5) años contados desde el fin del vínculo, por deber legal de conservación. Durante ese plazo no se puede borrar, ni siquiera a petición tuya.',
        `Tus derechos: puedes conocer, actualizar y rectificar tus datos, pedir prueba de esta autorización, ser informado del uso que se les ha dado, revocarla o pedir su supresión cuando no proceda un deber legal de conservarlos, y presentar quejas ante la Superintendencia de Industria y Comercio. Para ejercerlos escribe a ${empresa} o a ${ENCARGADO.correo}.`,
        'Esta autorización es libre y voluntaria. Si no la das, no se puede continuar con el proceso de vinculación.',
      ],
    },
  ];
}

// ─── El portón ────────────────────────────────────────────────────────────

/** Lo que devuelve Valida por cada declaración ya registrada. */
export type DeclaracionRegistrada = {
  tipo: string;
  aceptada: boolean;
  texto_version: string | null;
  aceptada_en: string | null;
};

/**
 * Qué falta aceptar. Una aceptación cuenta solo si es de la versión vigente:
 * si el texto cambió, la aceptación anterior no cubre el nuevo y se vuelve a
 * pedir. Decir lo contrario sería afirmar que alguien aceptó algo que nunca
 * vio.
 */
export function faltaAceptar(
  declaraciones: readonly DeclaracionRegistrada[],
): TipoAceptacion[] {
  return TIPOS_ACEPTACION.filter((tipo) => {
    const d = declaraciones.find((x) => x.tipo === tipo);
    if (!d) return true;
    if (!d.aceptada) return true;
    return d.texto_version !== VERSION_TEXTO[tipo];
  });
}

export function yaAcepto(declaraciones: readonly DeclaracionRegistrada[]): boolean {
  return faltaAceptar(declaraciones).length === 0;
}

// ─── Estado del enlace ────────────────────────────────────────────────────

export type MotivoEnlaceCerrado = 'no_encontrado' | 'expirado' | 'cerrado';

export const MENSAJE_ENLACE: Record<MotivoEnlaceCerrado, string> = {
  no_encontrado:
    'Este enlace no existe. Revisa que lo hayas copiado completo, o pídele uno nuevo a quien te lo envió.',
  expirado: 'Este enlace se venció. Pídele uno nuevo a quien te lo envió.',
  cerrado:
    'Este proceso de vinculación ya se cerró. Si necesitas algo más, escríbele a quien te envió el enlace.',
};

export function esMotivoEnlaceCerrado(v: string): v is MotivoEnlaceCerrado {
  return v === 'no_encontrado' || v === 'expirado' || v === 'cerrado';
}

// ─── Pasos del formulario ─────────────────────────────────────────────────

export type PasoPublico = 'aceptaciones' | 'documentos' | 'datos' | 'listo';

export const PASO_LABEL: Record<PasoPublico, string> = {
  aceptaciones: 'Autorizaciones',
  documentos: 'Documentos',
  datos: 'Tus datos',
  listo: 'Listo',
};

export const PASOS: readonly PasoPublico[] = ['aceptaciones', 'documentos', 'datos', 'listo'];

/**
 * En qué paso va. Es deliberado que nada se pueda hacer antes de aceptar: el
 * primer documento que sube la contraparte ya es tratamiento de datos, y
 * pedirle la autorización después sería pedírsela cuando ya no puede decir que
 * no.
 */
export function pasoActual(input: {
  acepto: boolean;
  slotsFaltantes: number;
  camposPorConfirmar: number;
}): PasoPublico {
  if (!input.acepto) return 'aceptaciones';
  if (input.slotsFaltantes > 0) return 'documentos';
  if (input.camposPorConfirmar > 0) return 'datos';
  return 'listo';
}

// ─── Documentos ───────────────────────────────────────────────────────────

/** Tope por archivo, alineado con el límite del módulo (pricing CCBF §3). */
export const TAMANO_MAX_MB = 10;

const TIPOS_ACEPTADOS = ['application/pdf', 'image/jpeg', 'image/png'];

export function validarArchivo(file: { type: string; size: number }): string | null {
  if (!TIPOS_ACEPTADOS.includes(file.type)) {
    return 'Solo se aceptan archivos PDF, JPG o PNG.';
  }
  if (file.size > TAMANO_MAX_MB * 1024 * 1024) {
    return `El archivo pesa más de ${TAMANO_MAX_MB} MB. Súbelo más liviano.`;
  }
  if (file.size === 0) return 'El archivo está vacío.';
  return null;
}

/** Nombre del documento en palabras de la contraparte, no del schema. */
const SLOT_PEDIDO: Record<string, string> = {
  camara_comercio: 'Certificado de existencia y representación legal',
  rut: 'RUT',
  estados_financieros: 'Estados financieros del último año',
  cedula_rl: 'Cédula del representante legal',
  cedula: 'Cédula',
  declaracion_renta: 'Declaración de renta del último año',
  rub: 'Registro Único de Beneficiarios (RUB)',
  cert_laboral: 'Certificación laboral',
};

export function nombrePedido(slot: string): string {
  return SLOT_PEDIDO[slot] ?? slot.replace(/_/g, ' ');
}
