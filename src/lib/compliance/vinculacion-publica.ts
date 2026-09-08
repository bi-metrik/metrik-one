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

export type PasoPublico =
  | 'aceptaciones'
  | 'documentos'
  | 'socios'
  | 'datos'
  | 'firma'
  | 'listo';

export const PASO_LABEL: Record<PasoPublico, string> = {
  aceptaciones: 'Autorizaciones',
  documentos: 'Documentos',
  socios: 'Socios',
  datos: 'Tus datos',
  firma: 'Firma',
  listo: 'Listo',
};

export const PASOS: readonly PasoPublico[] = [
  'aceptaciones',
  'documentos',
  'socios',
  'datos',
  'firma',
  'listo',
];

/**
 * A una persona natural no se le pregunta por sus socios. El paso no se
 * esconde con un `display:none`: se saca de la lista, porque un paso visible
 * que nunca se puede alcanzar deja a alguien buscando qué le falta.
 */
export function pasosVisibles(pideCadena: boolean): readonly PasoPublico[] {
  return pideCadena ? PASOS : PASOS.filter((p) => p !== 'socios');
}

/**
 * En qué paso va. Es deliberado que nada se pueda hacer antes de aceptar: el
 * primer documento que sube la contraparte ya es tratamiento de datos, y
 * pedirle la autorización después sería pedírsela cuando ya no puede decir que
 * no.
 *
 * Y la firma va de última porque firmar es afirmar que lo anterior es cierto.
 * Valida no la deja pasar con campos sin confirmar (gate de Lucía, 409
 * `campos_pendientes`); acá el paso ni siquiera se ofrece, para que la
 * contraparte no llegue a chocar contra ese error.
 */
export function pasoActual(input: {
  acepto: boolean;
  slotsFaltantes: number;
  cadenaPendiente: number;
  camposPorConfirmar: number;
  firmado: boolean;
}): PasoPublico {
  if (input.firmado) return 'listo';
  if (!input.acepto) return 'aceptaciones';
  if (input.slotsFaltantes > 0) return 'documentos';
  if (input.cadenaPendiente > 0) return 'socios';
  if (input.camposPorConfirmar > 0) return 'datos';
  return 'firma';
}

/**
 * El expediente ya firmado. Valida lo mueve a `pendiente_revision` al sellar,
 * así que el estado ES la respuesta: no hace falta un campo aparte que pueda
 * quedar desfasado del que manda.
 */
export function estaFirmado(estado: string): boolean {
  return estado === 'pendiente_revision';
}

// ─── La firma ─────────────────────────────────────────────────────────────

/** Lo mismo que genera Valida: seis dígitos. */
export const LARGO_OTP = 6;

/** Cooldown del canal de envío. Mismo número que aplica Valida al reenviar. */
export const SEGUNDOS_REENVIO = 60;

/** Deja escribir solo dígitos, y como mucho los que tiene el código. */
export function normalizarOtp(v: string): string {
  return v.replace(/\D/g, '').slice(0, LARGO_OTP);
}

export function otpCompleto(v: string): boolean {
  return normalizarOtp(v).length === LARGO_OTP;
}

/**
 * Cada fallo del canal termina distinto para quien está del otro lado, así que
 * cada uno tiene su frase. Un "algo salió mal" acá deja a alguien esperando un
 * correo que no va a llegar, sin saber que tiene que hacer otra cosa.
 */
export function mensajeErrorFirma(codigo: string, esperarSegundos?: number | null): string {
  switch (codigo) {
    case 'sin_correo_de_contraparte':
      return 'No tenemos un correo tuyo para mandarte el código. Escríbele a quien te envió el enlace para que lo registre.';
    case 'canal_no_configurado':
      return 'El envío de códigos no está disponible en este momento. Avísale a quien te envió el enlace.';
    case 'espera_antes_de_reenviar':
      return esperarSegundos
        ? `Ya te mandamos un código. Espera ${esperarSegundos} segundos para pedir otro.`
        : 'Ya te mandamos un código. Espera un momento para pedir otro.';
    case 'ya_firmado':
      return 'Este expediente ya está firmado.';
    case 'otp_incorrecto':
      return 'Ese código no es. Revísalo y vuelve a intentar.';
    case 'otp_expirado':
      return 'El código se venció. Pide uno nuevo.';
    case 'bloqueado':
      return 'Se agotaron los intentos. Pide un código nuevo.';
    case 'campos_pendientes':
      return 'Todavía hay datos sin confirmar. Revísalos antes de firmar.';
    case 'sin_firma_iniciada':
      return 'Pide primero el código.';
    default:
      return 'No se pudo completar la firma. Vuelve a intentar, y si sigue igual escríbele a quien te envió el enlace.';
  }
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

/**
 * Lo que se suelta sobre un bloque de documento.
 *
 * Soltar es más impreciso que elegir del explorador: la persona puede arrastrar
 * una selección entera sin darse cuenta, o soltar algo que ni siquiera es un
 * archivo. Tomar el primero en silencio sería lo peor de los dos mundos: el
 * expediente queda con un documento que nadie escogió, y la persona cree que
 * subió otro.
 */
export function archivoSoltado(
  files: readonly { type: string; size: number }[],
): { ok: true; indice: 0 } | { ok: false; error: string } {
  if (files.length === 0) return { ok: false, error: 'No reconocimos lo que soltaste. Intenta con un archivo.' };
  if (files.length > 1) {
    return {
      ok: false,
      error: 'Suelta un archivo a la vez: cada bloque recibe un solo documento.',
    };
  }
  const err = validarArchivo(files[0]);
  if (err) return { ok: false, error: err };
  return { ok: true, indice: 0 };
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

/**
 * La aclaración de cada documento, en el bloque, antes de subirlo.
 *
 * No es ayuda opcional: el error que más cuesta acá es el que se descubre
 * tarde. Una cámara de comercio de una sola hoja pasa como "recibida", el
 * lector no encuentra socios ni revisor fiscal, y tres días después alguien
 * tiene que escribirle a la contraparte para pedirle otra vez lo mismo. La
 * frase que evita eso vale más puesta antes que la explicación después.
 */
const NOTA_PEDIDO: Record<string, string> = {
  camara_comercio:
    'El certificado completo, el que lista socios o accionistas, revisor fiscal y contador. La carátula o el resumen de una hoja no sirven. Que no tenga más de 30 días de expedido.',
  rut: 'El RUT actualizado, descargado del portal de la DIAN, con la hoja de responsabilidades.',
  estados_financieros:
    'Los del último año cerrado, firmados por el representante legal y el contador. Si tienes revisor fiscal, también con su firma.',
  cedula_rl:
    'Las dos caras en un solo archivo, y que se lea el número. Tiene que ser la del representante legal que aparece en el certificado.',
  cedula: 'Las dos caras en un solo archivo, y que se lea el número.',
  declaracion_renta: 'La del último año gravable, con el acuse de presentación.',
  rub: 'El reporte completo del Registro Único de Beneficiarios que expide la DIAN.',
  cert_laboral:
    'Con cargo, salario y fecha de ingreso, firmada por quien la expide y con fecha reciente.',
};

export function notaPedido(slot: string): string | null {
  return NOTA_PEDIDO[slot] ?? null;
}

// ─── La lectura delante de la contraparte ─────────────────────────────────

/** Lo que devuelve Valida al leer un documento recién subido. */
export type LecturaDoc = {
  estado: string;
  doc_type_match: boolean | null;
  doc_type_detected: string | null;
  campos: readonly { slug: string; value: unknown }[];
};

export type VeredictoLectura = {
  tono: 'ok' | 'ojo' | 'espera' | 'falla';
  texto: string;
  /** Si conviene ofrecerle cambiar el archivo ahí mismo. */
  sugiereReemplazo: boolean;
};

/**
 * Qué se le dice a la contraparte del documento que acaba de subir.
 *
 * El tipo detectado lo escribe un modelo, así que solo se nombra cuando cae en
 * la lista de documentos que conocemos. Pegar el texto crudo del modelo en la
 * pantalla de un desconocido es dejar que el modelo le escriba a la persona.
 */
export function nombreDetectado(detectado: string | null): string | null {
  if (!detectado) return null;
  const clave = detectado.trim().toLowerCase();
  return SLOT_PEDIDO[clave] ?? null;
}

/**
 * Un "no era este documento" que llega tres días después ya no cuesta un clic:
 * cuesta un correo, una espera y una persona que dejó de confiar en el trámite.
 * Por eso el veredicto se dice completo acá, con lo que se sabe en el momento,
 * incluso cuando lo que se sabe es que todavía no se sabe.
 */
export function veredictoLectura(slot: string, l: LecturaDoc): VeredictoLectura {
  const pedido = nombrePedido(slot);

  if (l.estado === 'en_proceso' || l.estado === 'pendiente') {
    return {
      tono: 'espera',
      texto:
        'Lo recibimos y lo estamos leyendo. Se está demorando más de lo normal, así que sigue con lo demás: si algo no cuadra te escribimos.',
      sugiereReemplazo: false,
    };
  }

  // El documento se guardó, pero no es el que se pidió. Esto NO es un error de
  // lectura: el lector funcionó y por eso puede decirlo.
  if (l.doc_type_match === false) {
    const otro = nombreDetectado(l.doc_type_detected);
    return {
      tono: 'ojo',
      texto: otro
        ? `Esto no parece ${pedido}: se parece más a ${otro}. Revísalo y súbelo de nuevo.`
        : `Esto no parece ${pedido}. Revísalo y súbelo de nuevo.`,
      sugiereReemplazo: true,
    };
  }

  // Sin llave del lector no leímos nada, y no es culpa de quien subió el
  // archivo. Decirle "revísalo" sería mandarlo a buscar un defecto que no
  // existe.
  if (l.estado === 'no_key') {
    return {
      tono: 'espera',
      texto: 'Lo recibimos. La lectura automática no está disponible ahora, la hacemos después.',
      sugiereReemplazo: false,
    };
  }

  if (l.estado !== 'ok') {
    return {
      tono: 'falla',
      texto:
        'Lo recibimos, pero no pudimos leerlo. Si está borroso o es una foto de una pantalla, súbelo otra vez más nítido.',
      sugiereReemplazo: true,
    };
  }

  const n = l.campos.length;
  if (n === 0) {
    return {
      tono: 'espera',
      texto: `Recibimos ${pedido}, pero no alcanzamos a sacarle datos. Los vas a poder escribir tú en el paso siguiente.`,
      sugiereReemplazo: false,
    };
  }

  return {
    tono: 'ok',
    texto: `Leímos ${pedido}: ${n} ${n === 1 ? 'dato' : 'datos'}. Los revisas en el paso siguiente.`,
    sugiereReemplazo: false,
  };
}

/**
 * Qué se muestra del documento leído, ahí mismo. Se enseñan pocos y cortos: es
 * para que la persona reconozca su documento de un vistazo, no para que lo
 * revise entero (eso es el paso de datos).
 */
export const CAMPOS_EN_VISTA_PREVIA = 4;

export function vistaPreviaCampos(
  campos: readonly { slug: string; value: unknown }[],
): { slug: string; texto: string }[] {
  const vistos: { slug: string; texto: string }[] = [];
  for (const c of campos) {
    if (vistos.length >= CAMPOS_EN_VISTA_PREVIA) break;
    if (c.value === null || c.value === undefined) continue;
    const texto = typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value);
    const limpio = texto.trim();
    if (limpio.length === 0) continue;
    vistos.push({ slug: c.slug, texto: limpio.length > 60 ? `${limpio.slice(0, 60)}...` : limpio });
  }
  return vistos;
}

// ─── La cadena hasta el beneficiario final ────────────────────

/**
 * Quién está detrás de la empresa que se está vinculando.
 *
 * Quien decide qué le falta a la cadena es Valida: multiplica las
 * participaciones a lo largo del camino, las compara contra el umbral y
 * devuelve el diagnóstico ya hecho. Acá no se vuelve a calcular nada. Lo que
 * vive en este archivo es cómo se le dice eso a alguien que no sabe qué es un
 * beneficiario final y que además tiene afán.
 */

/** Solo para redactar. El que decide con este número es Valida. */
export const UMBRAL_BF = 5;

export const SLOT_SOPORTE_BF = 'soporte_bf';

export type FaltaEnSocio = 'porcentaje' | 'socios' | 'soporte' | 'justificacion';

export type MotivoParada = 'sociedad_listada' | 'entidad_estatal' | 'bf_no_identificable';

export type Socio = {
  persona_id: string;
  padre_persona_id: string | null;
  nivel: number;
  rol: string;
  tipo_sujeto: 'natural' | 'juridica';
  nombre: string;
  documento_tipo: string | null;
  documento_numero: string | null;
  porcentaje_participacion: number | null;
  participacion_efectiva: number | null;
  motivo_parada: string | null;
  parada_justificacion: string | null;
  tiene_soporte: boolean;
};

export type CadenaPublica = {
  completa: boolean;
  pendientes: { persona_id: string; nombre: string; falta: FaltaEnSocio }[];
  beneficiarios: {
    persona_id: string;
    nombre: string;
    documento_tipo: string | null;
    documento_numero: string | null;
    participacion_efectiva: number | null;
  }[];
  sin_resolver: { persona_id: string; nombre: string; justificacion: string | null }[];
  suma_directa: number;
  suma_excedida: boolean;
};

export const CADENA_VACIA: CadenaPublica = {
  completa: true,
  pendientes: [],
  beneficiarios: [],
  sin_resolver: [],
  suma_directa: 0,
  suma_excedida: false,
};

/**
 * Los tres motivos que la contraparte puede declarar para no seguir bajando.
 * `bajo_umbral` y `persona_natural` no están: esos salen de la aritmética, y
 * ofrecerlos sería dejar que alguien cierre a mano una rama que las cuentas
 * dicen que sigue abierta.
 */
export const MOTIVOS_PARADA: readonly MotivoParada[] = [
  'sociedad_listada',
  'entidad_estatal',
  'bf_no_identificable',
];

export const MOTIVO_PARADA_LABEL: Record<MotivoParada, string> = {
  sociedad_listada: 'Cotiza en bolsa',
  entidad_estatal: 'Es una entidad del Estado',
  bf_no_identificable: 'No pude conseguir la información',
};

export const MOTIVO_PARADA_AYUDA: Record<MotivoParada, string> = {
  sociedad_listada:
    'Sus acciones se negocian en una bolsa de valores, así que no tiene un dueño identificable detrás.',
  entidad_estatal: 'Es una entidad pública, no tiene socios privados.',
  bf_no_identificable:
    'El socio no te entregó su composición. Escribe qué pasó: eso es lo que va a leer quien revise.',
};

export function esMotivoParada(v: string | null): v is MotivoParada {
  return v !== null && (MOTIVOS_PARADA as readonly string[]).includes(v);
}

/** Por qué se le está pidiendo la cadena, en una frase. */
export const POR_QUE_LOS_SOCIOS =
  `La ley pide saber qué personas están detrás de la empresa. Si uno de tus socios es otra empresa, hay que seguir bajando hasta llegar a personas, y solo importan las que terminen con ${UMBRAL_BF}% o más.`;

/** La aclaración del soporte que se le pide a cada socio empresa. */
export function notaSoporteBf(nombre: string): string {
  return `El certificado de existencia y representación legal de ${nombre}, el completo, donde se listan sus socios. Si no lo tienes, sirve la composición accionaria firmada por su representante legal.`;
}

/** Qué le falta a un socio, dicho como se lo dirías a quien tiene que resolverlo. */
export function fraseFalta(falta: FaltaEnSocio): string {
  switch (falta) {
    case 'porcentaje':
      return 'Falta el porcentaje que tiene en la empresa.';
    case 'socios':
      return 'Falta decir quiénes son sus socios.';
    case 'soporte':
      return 'Falta subir el documento que respalda su composición.';
    case 'justificacion':
      return 'Falta explicar por qué no se puede seguir bajando por acá.';
  }
}

/** Lo que le falta a ese socio, sin repetir el mismo faltante dos veces. */
export function faltasDe(cadena: CadenaPublica, personaId: string): FaltaEnSocio[] {
  const vistas = new Set<FaltaEnSocio>();
  for (const p of cadena.pendientes) {
    if (p.persona_id === personaId) vistas.add(p.falta);
  }
  return [...vistas];
}

function porcentaje(n: number): string {
  // Un "30%" se lee mejor que un "30.0000%", y el decimal solo aparece cuando
  // dice algo: la efectiva compuesta casi siempre lo tiene.
  const redondo = Math.round(n * 100) / 100;
  return `${Number.isInteger(redondo) ? redondo : redondo.toFixed(2)}%`;
}

/**
 * Cuánto pesa un socio, en una línea. La efectiva solo se nombra cuando es
 * distinta de la directa: repetir "30% (30% efectivo)" no informa y ocupa el
 * lugar donde debería estar lo que sí falta.
 */
export function textoParticipacion(socio: Socio): string {
  const propio = socio.porcentaje_participacion;
  if (propio === null) return 'Sin porcentaje';
  const efectiva = socio.participacion_efectiva;
  if (efectiva === null || Math.abs(efectiva - propio) < 0.005) return porcentaje(propio);
  return `${porcentaje(propio)} de su empresa, ${porcentaje(efectiva)} del total`;
}

/**
 * El encabezado del paso. Dice lo que hay que hacer ahora, no un conteo: una
 * persona que ve "3 pendientes" todavía tiene que averiguar cuáles.
 */
export function resumenCadena(cadena: CadenaPublica, socios: readonly Socio[]): string {
  if (socios.length === 0) return 'Todavía no has registrado ningún socio.';
  if (cadena.suma_excedida) {
    return 'Los porcentajes de algún grupo de socios suman más de 100%. Revísalos.';
  }
  const n = new Set(cadena.pendientes.map((p) => p.persona_id)).size;
  if (n === 0) {
    const bf = cadena.beneficiarios.length;
    if (bf === 0) return 'La cadena está completa. Ningún socio llega al umbral.';
    return `La cadena está completa: ${bf} ${bf === 1 ? 'beneficiario final' : 'beneficiarios finales'}.`;
  }
  return `Falta información de ${n} ${n === 1 ? 'socio' : 'socios'}.`;
}

/** Lo que la contraparte escribe para declarar un socio. */
export type FormSocio = {
  tipoSujeto: 'natural' | 'juridica';
  nombre: string;
  documentoTipo: string;
  documentoNumero: string;
  porcentaje: string;
  motivoParada: string;
  justificacion: string;
};

export const FORM_SOCIO_VACIO: FormSocio = {
  tipoSujeto: 'natural',
  nombre: '',
  documentoTipo: 'CC',
  documentoNumero: '',
  porcentaje: '',
  motivoParada: '',
  justificacion: '',
};

/**
 * Qué está mal en el formulario, campo por campo.
 *
 * Valida vuelve a validar todo esto del otro lado: acá se hace para que el
 * error salga al lado del campo y no como un mensaje suelto después de un
 * viaje al servidor.
 */
export function faltaEnFormSocio(form: FormSocio): Partial<Record<keyof FormSocio, string>> {
  const errores: Partial<Record<keyof FormSocio, string>> = {};

  if (!form.nombre.trim()) errores.nombre = 'Escribe el nombre.';
  else if (form.nombre.trim().length > 200) errores.nombre = 'El nombre es muy largo.';

  const pct = form.porcentaje.trim();
  if (!pct) {
    errores.porcentaje = 'Escribe el porcentaje.';
  } else {
    const n = Number(pct.replace(',', '.'));
    if (!Number.isFinite(n)) errores.porcentaje = 'Escribe solo el número.';
    else if (n < 0 || n > 100) errores.porcentaje = 'Tiene que estar entre 0 y 100.';
  }

  if (form.motivoParada) {
    if (form.tipoSujeto !== 'juridica') {
      errores.motivoParada = 'Esto solo aplica cuando el socio es una empresa.';
    } else if (!form.justificacion.trim()) {
      errores.justificacion = 'Escribe por qué. Sin esto no queda constancia de nada.';
    }
  }

  return errores;
}

/** El número tal como lo espera Valida, o null si no se escribió. */
export function porcentajeANumero(v: string): number | null {
  const limpio = v.trim().replace(',', '.');
  if (!limpio) return null;
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}
