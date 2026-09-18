/**
 * Qué documento espera un bloque, y qué hacer cuando llega otro.
 *
 * ── El problema ──────────────────────────────────────────────────────────────────────
 * Un bloque documental aceptaba CUALQUIER archivo. En SOENA (V0497 y V0498) se cargó un
 * certificado de Cámara de Comercio en el bloque `rut`: de los 22 campos que ese bloque
 * exige, el certificado tiene siete, y el modelo devolvió **los quince restantes
 * inventados con confianza 0.95**. Uno de ellos, `direccion_seccional`, quedó sembrado
 * en el negocio como la seccional de la DIAN del caso. ONE además renombra el archivo al
 * subirlo, así que en Drive quedó como `007_RUT.pdf` y un humano que abra la carpeta no
 * ve el error.
 *
 * Dos cosas que NO sirven como control, y por eso no se usan aquí:
 *   · **La confianza.** La seccional inventada vino con 0.95.
 *   · **El campo vacío.** El `responseSchema` de `extract-fields` marca todos los campos
 *     como `required`, así que el modelo nunca devuelve un campo ausente.
 *
 * ── La regla ─────────────────────────────────────────────────────────────────────────
 * El control sale del DOCUMENTO, no de lo que alguien declaró. El bloque dice qué espera
 * (`config_extra.documento_esperado`), un lector INDEPENDIENTE mira el archivo y dice qué
 * es, y si el lector identifica con certeza otro documento conocido, el bloque no se
 * guarda.
 *
 * ⚠️ **Se rechaza solo con una identificación POSITIVA y segura de otro tipo conocido.**
 * `otro`, `ilegible` y cualquier veredicto por debajo del umbral **dejan pasar** y quedan
 * anotados. Es deliberado y asimétrico: un falso rechazo frena a un operador sobre un
 * documento correcto —y SOENA tiene cientos de casos abiertos—, mientras que un falso
 * acepte solo deja las cosas como estaban antes de este control. El lado seguro de un
 * control NUEVO no es el mismo que el de un gate: aquí es dejar pasar lo dudoso.
 *
 * ⚠️ **El lector no sabe qué se espera.** Si se le dijera «esto debería ser un RUT», el
 * modelo tiende a confirmarlo. Por eso `reconocerDocumento` recibe el catálogo completo y
 * nunca la expectativa, y por eso esta comparación vive aquí y no dentro del prompt.
 */

/** Tipos de documento que el lector puede nombrar. Lista CERRADA. */
export const TIPOS_DOCUMENTO = {
  rut: {
    label: 'RUT de la DIAN',
    descripcion:
      'Registro Único Tributario expedido por la DIAN. Formulario 001 con casillas numeradas, ' +
      'logo de la DIAN, NIT y dígito de verificación en las casillas 5 y 6, y la Dirección Seccional en la casilla 12.',
  },
  camara_comercio: {
    label: 'Certificado de Cámara de Comercio',
    descripcion:
      'Certificado de existencia y representación legal expedido por una Cámara de Comercio. ' +
      'Menciona matrícula mercantil, objeto social, representante legal y la Cámara que lo expide.',
  },
  factura_venta: {
    label: 'Factura de venta',
    descripcion:
      'Factura electrónica o física de venta de un bien o servicio. Trae un número de factura, ' +
      'un emisor con su NIT, un adquirente, detalle de ítems, IVA y total.',
  },
  certificado_bancario: {
    label: 'Certificación bancaria',
    descripcion:
      'Certificación de una entidad financiera sobre la existencia y titularidad de una cuenta ' +
      '(tipo de cuenta, número, titular).',
  },
  certificado_upme: {
    label: 'Certificado o concepto de la UPME',
    descripcion:
      'Documento de la Unidad de Planeación Minero Energética (UPME) que certifica o conceptúa ' +
      'sobre un bien o proyecto (por ejemplo, un vehículo eléctrico o híbrido).',
  },
  contrato_leasing: {
    label: 'Contrato de leasing',
    descripcion:
      'Contrato de arrendamiento financiero entre una compañía de financiamiento y un locatario, ' +
      'con cláusulas, canon y opción de compra.',
  },
  comprobante_pago: {
    label: 'Comprobante de pago',
    descripcion:
      'Soporte de una transferencia, consignación, pago PSE o pago por pasarela: muestra un valor, ' +
      'una fecha y una referencia o número de aprobación.',
  },
  recibo_caja: {
    label: 'Recibo de caja',
    descripcion: 'Recibo de caja emitido por una empresa al recibir un pago de un tercero.',
  },
  carta_autorizacion: {
    label: 'Carta de autorización',
    descripcion:
      'Carta firmada en la que una persona o empresa autoriza a otra a actuar o a recibir algo. ' +
      'Puede estar notariada o con reconocimiento de firma.',
  },
  documento_identidad: {
    label: 'Documento de identidad',
    descripcion:
      'Cédula de ciudadanía, cédula de extranjería, pasaporte o tarjeta de identidad de una persona.',
  },
  tarjeta_propiedad: {
    label: 'Tarjeta de propiedad de vehículo',
    descripcion:
      'Licencia de tránsito o tarjeta de propiedad expedida por el RUNT: placa, marca, línea, modelo y propietario.',
  },
  formulario_dian: {
    label: 'Formulario de la DIAN',
    descripcion:
      'Formulario oficial de la DIAN distinto del RUT: solicitud de devolución (010), poder (1668), ' +
      'declaración de renta o de IVA. Trae el número de formulario impreso.',
  },
  declaracion_juramentada: {
    label: 'Declaración juramentada',
    descripcion: 'Declaración bajo la gravedad del juramento, normalmente ante notario.',
  },
  estados_financieros: {
    label: 'Estados financieros',
    descripcion: 'Balance general, estado de resultados o certificación de un contador sobre las cifras de una empresa.',
  },
} as const

export type TipoDocumento = keyof typeof TIPOS_DOCUMENTO

/** El lector vio un documento que no está en el catálogo. */
export const TIPO_OTRO = 'otro'
/** El lector no pudo leer el archivo (borroso, en blanco, cortado). */
export const TIPO_ILEGIBLE = 'ilegible'

/** Lo que el lector puede devolver: un tipo del catálogo, `otro` o `ilegible`. */
export type TipoReconocido = TipoDocumento | typeof TIPO_OTRO | typeof TIPO_ILEGIBLE

/** Los valores admitidos en el `enum` del esquema que se le pasa al modelo. */
export const VALORES_RECONOCIBLES: readonly string[] = [
  ...Object.keys(TIPOS_DOCUMENTO),
  TIPO_OTRO,
  TIPO_ILEGIBLE,
]

export function esTipoDelCatalogo(v: unknown): v is TipoDocumento {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(TIPOS_DOCUMENTO, v)
}

export function etiquetaTipo(v: string): string {
  if (esTipoDelCatalogo(v)) return TIPOS_DOCUMENTO[v].label
  if (v === TIPO_ILEGIBLE) return 'un archivo que no se pudo leer'
  return 'otro documento'
}

/**
 * Umbral por defecto para creerle al lector. Es el mismo 0.70 con el que
 * `extract-fields` decide si un campo necesita revisión manual: una sola vara.
 */
export const CONFIANZA_MINIMA_DEFAULT = 0.7

/** Lo que el bloque declara en su `config_extra`. */
export interface ExpectativaDocumento {
  /** Uno o varios tipos aceptables. Un bloque puede admitir más de un documento. */
  tipos: TipoDocumento[]
  /** Por debajo de esto, el veredicto del lector no alcanza para rechazar. */
  confianzaMinima: number
}

/**
 * Lee la expectativa del `config_extra` de un bloque.
 *
 * Devuelve `null` cuando el bloque **no declara nada**, que es el caso de los 37 bloques
 * con extracción que ya existen: ahí el comportamiento tiene que ser exactamente el de
 * siempre, sin lector, sin llamada extra y sin rechazo posible.
 *
 * Un valor que no está en el catálogo se **ignora** (no se inventa un tipo). Si el bloque
 * declara solo valores desconocidos, es como si no declarara nada: preferimos un control
 * apagado a uno que rechace comparando contra algo que el lector nunca puede devolver.
 */
export function expectativaDeDocumento(
  configExtra: Record<string, unknown> | null | undefined,
): ExpectativaDocumento | null {
  const crudo = configExtra?.documento_esperado
  if (crudo === undefined || crudo === null) return null

  const lista = Array.isArray(crudo) ? crudo : [crudo]
  const tipos = lista.filter(esTipoDelCatalogo)
  if (tipos.length === 0) return null

  const min = configExtra?.documento_esperado_confianza_min
  const confianzaMinima =
    typeof min === 'number' && min >= 0 && min <= 1 ? min : CONFIANZA_MINIMA_DEFAULT

  return { tipos: [...new Set(tipos)], confianzaMinima }
}

/** Lo que devuelve el lector del documento. */
export interface Reconocimiento {
  tipo: TipoReconocido
  confianza: number
  /** Qué vio, en una línea. Es lo que se le muestra al operador. */
  evidencia: string
}

export type MotivoVeredicto =
  /** El documento es uno de los esperados. */
  | 'coincide'
  /** El lector no corrió (bloque sin expectativa, sin llave o error del modelo). */
  | 'sin_comprobar'
  /** El lector nombró otro tipo conocido, con confianza suficiente. */
  | 'documento_distinto'
  /** El lector dudó: no alcanza para rechazar, pero queda anotado. */
  | 'no_concluyente'

export interface Veredicto {
  acepta: boolean
  motivo: MotivoVeredicto
}

/**
 * ¿Se guarda este documento?
 *
 * Solo `documento_distinto` rechaza. Ver el encabezado del archivo: el control es
 * asimétrico a propósito.
 */
export function veredictoDocumento(
  expectativa: ExpectativaDocumento | null,
  reconocimiento: Reconocimiento | null,
): Veredicto {
  if (!expectativa || !reconocimiento) return { acepta: true, motivo: 'sin_comprobar' }

  if (expectativa.tipos.includes(reconocimiento.tipo as TipoDocumento)) {
    return { acepta: true, motivo: 'coincide' }
  }
  if (!esTipoDelCatalogo(reconocimiento.tipo)) {
    // `otro` e `ilegible` no son una identificación: no rechazan.
    return { acepta: true, motivo: 'no_concluyente' }
  }
  if (reconocimiento.confianza < expectativa.confianzaMinima) {
    return { acepta: true, motivo: 'no_concluyente' }
  }
  return { acepta: false, motivo: 'documento_distinto' }
}

/**
 * Lo que viaja a la pantalla cuando el bloque NO se guarda.
 *
 * Vive aquí y no en la server action porque un archivo `'use server'` no puede exportar
 * tipos, y la pantalla necesita exactamente esta forma para decir qué llegó.
 */
export interface DocumentoRechazado {
  /** Etiqueta legible de lo que el bloque espera. */
  esperado: string
  /** Etiqueta legible de lo que el lector identificó. */
  visto: string
  /** Slug del tipo identificado, para la traza. */
  visto_tipo: string
  confianza: number
  /** La frase del lector: qué vio en el archivo. */
  evidencia: string
}

/** Cómo se nombra la expectativa en pantalla: «un RUT de la DIAN» / «un A o un B». */
export function etiquetaEsperado(expectativa: ExpectativaDocumento): string {
  const labels = expectativa.tipos.map(t => TIPOS_DOCUMENTO[t].label)
  if (labels.length === 1) return labels[0]
  return `${labels.slice(0, -1).join(', ')} o ${labels[labels.length - 1]}`
}

/**
 * El mensaje que ve quien cargó el archivo.
 *
 * Dice las tres cosas que necesita para resolverlo solo: qué esperaba el bloque, qué
 * llegó, y qué hacer. Sin la segunda, el operador vuelve a subir el mismo archivo.
 */
export function mensajeDocumentoRechazado(
  expectativa: ExpectativaDocumento,
  reconocimiento: Reconocimiento,
): string {
  const visto = etiquetaTipo(reconocimiento.tipo)
  return (
    `Este bloque espera ${etiquetaEsperado(expectativa)} y el archivo que subiste es ${visto}. ` +
    `No se guardó nada: sube el documento correcto.`
  )
}
