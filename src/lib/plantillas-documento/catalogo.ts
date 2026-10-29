/**
 * Catálogo de las plantillas editables: qué documentos hay, qué variables y condiciones
 * puede usar cada uno, cuáles son obligatorias para activarlo y cómo se calcula cada
 * valor a partir de los datos que ya resuelve `generarFormularioCore` (`campos_fuente`
 * + overrides).
 *
 * Los valores DERIVADOS se calculan con las MISMAS funciones que usan los componentes
 * @react-pdf (`formato.ts`, `titulares.ts`, `nitBaseYDv`): una plantilla editada no puede
 * formatear distinto el mismo peso que la Relación de facturas del mismo expediente.
 *
 * Los marcadores ("[N.° DE CÉDULA]", "—") son los que imprimen hoy los componentes cuando
 * falta un dato opcional. Un dato OBLIGATORIO que falta no llega aquí: la generación se
 * detiene antes con la lista de faltantes.
 *
 * Agregar un documento: ver `docs/specs/2026-10-29_plantillas-editables.md`.
 */
import { nitBaseYDv } from '@/lib/dian/nit'
import { concordancia, titularesDeDatos, type Titular } from '@/lib/pdf/titulares'
import { fechaCorta, fechaDeGeneracion, fechaLarga, fmtAlMil, fmtCurrency, tarifaIva } from '@/lib/pdf/formato'

export type TipoPlantilla = 'declaracion-juramentada' | 'relacion-facturas'

export type Datos = Record<string, string | null | undefined>

export interface Contexto {
  /** ISO de la generación (`new Date().toISOString()`). La fecha sale en hora de Bogotá. */
  fechaGeneracion: string
  codigoNegocio: string
}

export interface VariableDef {
  nombre: string
  etiqueta: string
  grupo: string
  /** Solo para la pantalla: qué es o de dónde sale. */
  ayuda?: string
}

export interface CondicionDef {
  nombre: string
  etiqueta: string
}

/** Lo que necesita el render: valores ya formateados, condiciones y titulares. */
export interface Valores {
  vars: Record<string, string>
  conds: Record<string, boolean>
  titulares: Array<Record<string, string>>
}

export interface Requisito {
  /** Lo que ve la persona si falta. */
  etiqueta: string
  /** Se cumple si ALGUNA de estas variables aparece fuera de un {{#si}}. */
  alguna: string[]
}

export interface DefPagina {
  /** Márgenes en pt: arriba/abajo y a los lados. */
  margenVertical: number
  margenLateral: number
  interlineado: number
}

export interface DefDocumento {
  tipo: TipoPlantilla
  nombre: string
  descripcion: string
  variables: VariableDef[]
  variablesTitular: VariableDef[]
  condiciones: CondicionDef[]
  condicionesTitular: CondicionDef[]
  requisitos: Requisito[]
  pagina: DefPagina
  /** Datos de ejemplo para la vista previa sin negocio. */
  ejemplo: Datos
  valores: (datos: Datos, ctx: Contexto) => Valores
}

const t = (v: string | null | undefined) => v?.trim() || ''

// ── Piezas comunes ───────────────────────────────────────────────────────────

const CONDICIONES_COMUNES: CondicionDef[] = [
  { nombre: 'dos_titulares', etiqueta: 'Si hay dos titulares (copropiedad)' },
  { nombre: 'hay_radicado_upme', etiqueta: 'Si hay radicado del certificado UPME' },
  { nombre: 'hay_fecha_certificado', etiqueta: 'Si hay fecha del certificado UPME' },
]

const CONDICIONES_TITULAR: CondicionDef[] = [
  { nombre: 'titular.es_primero', etiqueta: 'Si es el primer titular' },
  { nombre: 'titular.es_ultimo', etiqueta: 'Si es el último titular' },
]

const VARIABLES_FRASES: VariableDef[] = [
  { nombre: 'frase_yo', etiqueta: 'Yo / Nosotros', grupo: 'Concordancia' },
  { nombre: 'frase_identificado', etiqueta: 'identificado(a)', grupo: 'Concordancia' },
  { nombre: 'frase_domiciliado', etiqueta: 'domiciliado(a)', grupo: 'Concordancia' },
  { nombre: 'frase_manifiesto', etiqueta: 'manifiesto / manifestamos', grupo: 'Concordancia' },
  { nombre: 'frase_declaro', etiqueta: 'Declaro / Declaramos', grupo: 'Concordancia' },
  { nombre: 'frase_solicitante', etiqueta: 'solicitante / solicitantes', grupo: 'Concordancia' },
  { nombre: 'frase_presento', etiqueta: 'presento / presentamos', grupo: 'Concordancia' },
  { nombre: 'frase_soy', etiqueta: 'soy / somos', grupo: 'Concordancia' },
  { nombre: 'frase_adquirente', etiqueta: 'el legítimo adquirente y propietario / los legítimos…', grupo: 'Concordancia' },
  { nombre: 'frase_persona_natural', etiqueta: 'persona natural no obligada… / personas naturales…', grupo: 'Concordancia' },
]

const VARIABLES_FECHA_GENERACION: VariableDef[] = [
  { nombre: 'fecha_generacion_larga', etiqueta: 'Fecha de generación (29 de octubre de 2026)', grupo: 'Generación', ayuda: 'Día en que se genera el documento, en hora de Bogotá.' },
  { nombre: 'fecha_generacion_dia', etiqueta: 'Día de generación (29)', grupo: 'Generación' },
  { nombre: 'fecha_generacion_mes', etiqueta: 'Mes de generación (octubre)', grupo: 'Generación' },
  { nombre: 'fecha_generacion_anio', etiqueta: 'Año de generación (2026)', grupo: 'Generación' },
  { nombre: 'codigo_negocio', etiqueta: 'Código del negocio', grupo: 'Generación' },
]

function frases(cantidad: number): Record<string, string> {
  const c = concordancia(cantidad)
  return {
    frase_yo: c.yo,
    frase_identificado: c.identificado,
    frase_domiciliado: c.domiciliado,
    frase_manifiesto: c.manifiesto,
    frase_declaro: c.declaro,
    frase_solicitante: c.solicitante,
    frase_presento: c.presento,
    frase_soy: c.soy,
    frase_adquirente: c.adquirente,
    frase_persona_natural: c.personaNatural,
  }
}

function fechaGen(ctx: Contexto): Record<string, string> {
  const { dia, mes, anio } = fechaDeGeneracion(ctx.fechaGeneracion)
  return {
    fecha_generacion_larga: `${dia} de ${mes} de ${anio}`,
    fecha_generacion_dia: String(dia),
    fecha_generacion_mes: mes,
    fecha_generacion_anio: String(anio),
    codigo_negocio: ctx.codigoNegocio,
  }
}

function condsComunes(datos: Datos, titulares: Titular[]): Record<string, boolean> {
  const radicado = Boolean(t(datos.numero_caso_upme))
  return {
    dos_titulares: titulares.length > 1,
    hay_radicado_upme: radicado,
    hay_fecha_certificado: Boolean(t(datos.fecha_certificado)),
  }
}

/** Tipo de vehículo como lo imprimen los dos documentos: en minúscula, o «híbrido / eléctrico». */
const tipoVehiculo = (d: Datos) => t(d.tipo_vehiculo).toLowerCase() || 'híbrido / eléctrico'

const CEDULA = '[N.° DE CÉDULA]'
const NOMBRE_SOLICITANTE = '[NOMBRE COMPLETO DEL SOLICITANTE]'

// ── Declaración juramentada ──────────────────────────────────────────────────

const DJ: DefDocumento = {
  tipo: 'declaracion-juramentada',
  nombre: 'Declaración juramentada',
  descripcion: 'Solicitud de devolución de IVA – pago de lo no debido (art. 12, Ley 1715 de 2014).',
  variables: [
    { nombre: 'nombre_solicitante', etiqueta: 'Nombre del primer titular', grupo: 'Solicitante' },
    { nombre: 'numero_identificacion', etiqueta: 'Cédula del primer titular (sin DV)', grupo: 'Solicitante' },
    { nombre: 'direccion', etiqueta: 'Dirección del primer titular', grupo: 'Solicitante' },
    { nombre: 'municipio', etiqueta: 'Ciudad del primer titular', grupo: 'Solicitante', ayuda: 'También es la ciudad de la firma.' },
    { nombre: 'nombre_solicitante_2', etiqueta: 'Nombre del segundo titular', grupo: 'Solicitante', ayuda: 'Úsala dentro de «Si hay dos titulares».' },
    { nombre: 'numero_identificacion_2', etiqueta: 'Cédula del segundo titular', grupo: 'Solicitante', ayuda: 'Úsala dentro de «Si hay dos titulares».' },
    { nombre: 'marca', etiqueta: 'Marca del vehículo', grupo: 'Vehículo y factura' },
    { nombre: 'linea', etiqueta: 'Línea y modelo', grupo: 'Vehículo y factura' },
    { nombre: 'tipo_vehiculo', etiqueta: 'Tipo de vehículo (eléctrico, híbrido…)', grupo: 'Vehículo y factura' },
    { nombre: 'proveedor', etiqueta: 'Proveedor (vendedor)', grupo: 'Vehículo y factura' },
    { nombre: 'numero_factura', etiqueta: 'Número de factura', grupo: 'Vehículo y factura' },
    { nombre: 'fecha_factura_larga', etiqueta: 'Fecha de la factura (15 de marzo de 2026)', grupo: 'Vehículo y factura' },
    { nombre: 'fecha_factura_corta', etiqueta: 'Fecha de la factura (15/03/2026)', grupo: 'Vehículo y factura' },
    { nombre: 'valor_sin_iva', etiqueta: 'Valor antes de IVA', grupo: 'Valores' },
    { nombre: 'valor_iva', etiqueta: 'IVA pagado', grupo: 'Valores' },
    { nombre: 'iva_solicitado', etiqueta: 'IVA solicitado, aproximado al mil', grupo: 'Valores', ayuda: 'Art. 577 del Estatuto Tributario.' },
    { nombre: 'tarifa_iva', etiqueta: 'Tarifa de IVA (19 %)', grupo: 'Valores', ayuda: 'IVA pagado ÷ valor antes de IVA.' },
    { nombre: 'numero_caso_upme', etiqueta: 'Radicado del certificado UPME', grupo: 'Certificado UPME', ayuda: 'Úsalo dentro de «Si hay radicado UPME».' },
    { nombre: 'fecha_certificado_larga', etiqueta: 'Fecha del certificado (8 de mayo de 2026)', grupo: 'Certificado UPME', ayuda: 'Úsala dentro de «Si hay fecha del certificado».' },
    { nombre: 'fecha_certificado_corta', etiqueta: 'Fecha del certificado (08/05/2026)', grupo: 'Certificado UPME' },
    ...VARIABLES_FECHA_GENERACION,
    ...VARIABLES_FRASES,
  ],
  variablesTitular: [
    { nombre: 'titular.nombre', etiqueta: 'Nombre', grupo: 'Por titular' },
    { nombre: 'titular.cedula', etiqueta: 'Cédula (sin DV)', grupo: 'Por titular' },
    { nombre: 'titular.direccion', etiqueta: 'Dirección', grupo: 'Por titular' },
    { nombre: 'titular.municipio', etiqueta: 'Ciudad', grupo: 'Por titular' },
  ],
  condiciones: CONDICIONES_COMUNES,
  condicionesTitular: CONDICIONES_TITULAR,
  requisitos: [
    { etiqueta: 'Nombre del solicitante', alguna: ['titular.nombre', 'nombre_solicitante'] },
    { etiqueta: 'Cédula del solicitante', alguna: ['titular.cedula', 'numero_identificacion'] },
    { etiqueta: 'Número de factura', alguna: ['numero_factura'] },
    { etiqueta: 'IVA pagado', alguna: ['valor_iva'] },
    { etiqueta: 'IVA solicitado, aproximado al mil', alguna: ['iva_solicitado'] },
    { etiqueta: 'Bloque de firmas ({{#firmas}})', alguna: ['@firmas'] },
  ],
  pagina: { margenVertical: 50, margenLateral: 55, interlineado: 1.5 },
  ejemplo: {
    nombre_solicitante: 'ANA MARÍA GÓMEZ',
    numero_identificacion: '43567890',
    direccion: 'CR 43A # 1 50 APTO 902',
    municipio: 'Medellín',
    marca: 'BYD',
    linea: 'DOLPHIN MINI GS 2026',
    tipo_vehiculo: 'Eléctrico',
    fecha_factura: '2026-03-15',
    proveedor: 'MOTORES Y MAQUINAS S.A.',
    numero_factura: 'FEMM12345',
    valor_unitario_sin_iva: '86380952',
    valor_iva: '4319048',
    numero_caso_upme: 'VEH_GEE20262260',
    fecha_certificado: '2026-05-08',
  },
  valores(datos, ctx) {
    const titulares = titularesDeDatos(datos, NOMBRE_SOLICITANTE)
    const radicado = t(datos.numero_caso_upme)
    return {
      vars: {
        nombre_solicitante: titulares[0].nombre,
        numero_identificacion: titulares[0].identificacion ?? CEDULA,
        direccion: t(titulares[0].direccion) || '[DIRECCIÓN COMPLETA]',
        municipio: t(titulares[0].municipio) || '[CIUDAD]',
        nombre_solicitante_2: titulares[1]?.nombre ?? '',
        numero_identificacion_2: titulares[1] ? (titulares[1].identificacion ?? CEDULA) : '',
        marca: t(datos.marca) || '[MARCA]',
        linea: t(datos.linea) || '[LÍNEA Y MODELO]',
        tipo_vehiculo: tipoVehiculo(datos),
        proveedor: t(datos.proveedor) || '[PROVEEDOR]',
        numero_factura: t(datos.numero_factura) || '[N.° DE FACTURA]',
        fecha_factura_larga: fechaLarga(datos.fecha_factura, '[FECHA DE LA FACTURA]'),
        fecha_factura_corta: fechaCorta(datos.fecha_factura, '[FECHA DE LA FACTURA]'),
        valor_sin_iva: fmtCurrency(datos.valor_unitario_sin_iva, '[VALOR]'),
        valor_iva: fmtCurrency(datos.valor_iva, '[IVA PAGADO]'),
        iva_solicitado: fmtAlMil(datos.valor_iva, '[IVA SOLICITADO, APROXIMADO AL MIL]'),
        tarifa_iva: tarifaIva(datos.valor_iva, datos.valor_unitario_sin_iva, '[TARIFA DE IVA]'),
        numero_caso_upme: radicado || '—',
        fecha_certificado_larga: t(datos.fecha_certificado) ? fechaLarga(datos.fecha_certificado) : '—',
        fecha_certificado_corta: t(datos.fecha_certificado) ? fechaCorta(datos.fecha_certificado) : '—',
        ...fechaGen(ctx),
        ...frases(titulares.length),
      },
      conds: condsComunes(datos, titulares),
      titulares: titulares.map((x) => ({
        'titular.nombre': x.nombre,
        'titular.cedula': x.identificacion ?? CEDULA,
        'titular.direccion': t(x.direccion) || '[DIRECCIÓN COMPLETA]',
        'titular.municipio': t(x.municipio) || '[CIUDAD]',
      })),
    }
  },
}

// ── Relación de facturas ─────────────────────────────────────────────────────

const VACIO = '—'

const RELACION: DefDocumento = {
  tipo: 'relacion-facturas',
  nombre: 'Relación de facturas',
  descripcion: 'Relación detallada de facturas electrónicas para la DIAN.',
  variables: [
    { nombre: 'nombre_solicitante', etiqueta: 'Nombre del primer titular', grupo: 'Solicitante' },
    { nombre: 'numero_identificacion', etiqueta: 'Cédula del primer titular (sin DV)', grupo: 'Solicitante' },
    { nombre: 'municipio', etiqueta: 'Ciudad del primer titular', grupo: 'Solicitante', ayuda: 'También es la ciudad del encabezado y de la firma.' },
    { nombre: 'email', etiqueta: 'Correo del primer titular', grupo: 'Solicitante' },
    { nombre: 'telefono', etiqueta: 'Celular del primer titular', grupo: 'Solicitante' },
    { nombre: 'nombre_solicitante_2', etiqueta: 'Nombre del segundo titular', grupo: 'Solicitante', ayuda: 'Úsala dentro de «Si hay dos titulares».' },
    { nombre: 'numero_identificacion_2', etiqueta: 'Cédula del segundo titular', grupo: 'Solicitante', ayuda: 'Úsala dentro de «Si hay dos titulares».' },
    { nombre: 'numero_factura', etiqueta: 'Número de factura (con prefijo)', grupo: 'Factura' },
    { nombre: 'fecha_factura_larga', etiqueta: 'Fecha de expedición (15 de marzo de 2026)', grupo: 'Factura' },
    { nombre: 'fecha_factura_corta', etiqueta: 'Fecha de expedición (15/03/2026)', grupo: 'Factura' },
    { nombre: 'nit_proveedor_base', etiqueta: 'NIT del proveedor, sin DV', grupo: 'Factura' },
    { nombre: 'nit_proveedor_dv', etiqueta: 'Dígito de verificación del proveedor', grupo: 'Factura', ayuda: 'Calculado (módulo 11 DIAN).' },
    { nombre: 'nombre_proveedor', etiqueta: 'Nombre o razón social del proveedor', grupo: 'Factura' },
    { nombre: 'marca', etiqueta: 'Marca del vehículo', grupo: 'Factura' },
    { nombre: 'linea', etiqueta: 'Línea y modelo', grupo: 'Factura' },
    { nombre: 'descripcion_bien', etiqueta: 'Descripción del bien (marca + línea)', grupo: 'Factura' },
    { nombre: 'tipo_vehiculo', etiqueta: 'Tipo de vehículo (eléctrico, híbrido…)', grupo: 'Factura' },
    { nombre: 'valor_sin_iva', etiqueta: 'Valor antes de IVA', grupo: 'Valores' },
    { nombre: 'valor_iva', etiqueta: 'IVA pagado', grupo: 'Valores' },
    { nombre: 'iva_solicitado', etiqueta: 'IVA solicitado, aproximado al mil', grupo: 'Valores', ayuda: 'Art. 577 del Estatuto Tributario.' },
    { nombre: 'tarifa_iva', etiqueta: 'Tarifa de IVA pagada (19 %)', grupo: 'Valores', ayuda: 'IVA pagado ÷ valor antes de IVA.' },
    { nombre: 'numero_caso_upme', etiqueta: 'N.° del certificado UPME («—» si no hay)', grupo: 'Certificado UPME' },
    { nombre: 'fecha_certificado_corta', etiqueta: 'Fecha del certificado (08/05/2026; «—» sin radicado)', grupo: 'Certificado UPME' },
    { nombre: 'fecha_certificado_larga', etiqueta: 'Fecha del certificado (8 de mayo de 2026)', grupo: 'Certificado UPME' },
    ...VARIABLES_FECHA_GENERACION,
    ...VARIABLES_FRASES,
  ],
  variablesTitular: [
    { nombre: 'titular.nombre', etiqueta: 'Nombre', grupo: 'Por titular' },
    { nombre: 'titular.cedula', etiqueta: 'Cédula (sin DV)', grupo: 'Por titular' },
    { nombre: 'titular.correo', etiqueta: 'Correo electrónico', grupo: 'Por titular' },
    { nombre: 'titular.celular', etiqueta: 'Celular', grupo: 'Por titular' },
  ],
  condiciones: CONDICIONES_COMUNES,
  condicionesTitular: CONDICIONES_TITULAR,
  requisitos: [
    { etiqueta: 'Nombre del solicitante', alguna: ['titular.nombre', 'nombre_solicitante'] },
    { etiqueta: 'Cédula del solicitante', alguna: ['titular.cedula', 'numero_identificacion'] },
    { etiqueta: 'Número de factura', alguna: ['numero_factura'] },
    { etiqueta: 'NIT del proveedor', alguna: ['nit_proveedor_base'] },
    { etiqueta: 'Valor antes de IVA', alguna: ['valor_sin_iva'] },
    { etiqueta: 'IVA pagado', alguna: ['valor_iva'] },
    { etiqueta: 'IVA solicitado, aproximado al mil', alguna: ['iva_solicitado'] },
    { etiqueta: 'Bloque de firmas ({{#firmas}})', alguna: ['@firmas'] },
  ],
  pagina: { margenVertical: 45, margenLateral: 50, interlineado: 1.4 },
  ejemplo: {
    numero_factura: 'FEMM12345',
    nit_proveedor: '890900608',
    nombre_proveedor: 'MOTORES Y MAQUINAS S.A.',
    marca: 'BYD',
    linea: 'DOLPHIN MINI GS 2026',
    tipo_vehiculo: 'Eléctrico',
    valor_unitario_sin_iva: '86380952',
    valor_iva: '4319048',
    nombre_solicitante: 'ANA MARÍA GÓMEZ',
    numero_identificacion: '43567890',
    municipio: 'Medellín',
    email: 'ana@example.com',
    telefono: '3001234567',
    fecha_factura: '2026-03-15',
    numero_caso_upme: 'VEH_GEE20262260',
    fecha_certificado: '2026-05-08',
  },
  valores(datos, ctx) {
    const titulares = titularesDeDatos(datos, NOMBRE_SOLICITANTE)
    const nit = nitBaseYDv(datos.nit_proveedor ?? null)
    const radicado = t(datos.numero_caso_upme)
    const descripcion = [datos.marca, datos.linea].map((v) => v?.trim()).filter(Boolean).join(' ') || VACIO
    return {
      vars: {
        nombre_solicitante: titulares[0].nombre,
        numero_identificacion: titulares[0].identificacion ?? CEDULA,
        municipio: t(datos.municipio) || '[CIUDAD]',
        email: titulares[0].email ?? '[CORREO]',
        telefono: titulares[0].telefono ?? '[CELULAR]',
        nombre_solicitante_2: titulares[1]?.nombre ?? '',
        numero_identificacion_2: titulares[1] ? (titulares[1].identificacion ?? CEDULA) : '',
        numero_factura: t(datos.numero_factura) || VACIO,
        fecha_factura_larga: fechaLarga(datos.fecha_factura),
        fecha_factura_corta: fechaCorta(datos.fecha_factura),
        nit_proveedor_base: nit?.base ?? VACIO,
        nit_proveedor_dv: nit?.dv ?? VACIO,
        nombre_proveedor: t(datos.nombre_proveedor) || VACIO,
        marca: t(datos.marca) || VACIO,
        linea: t(datos.linea) || VACIO,
        descripcion_bien: descripcion,
        tipo_vehiculo: tipoVehiculo(datos),
        valor_sin_iva: fmtCurrency(datos.valor_unitario_sin_iva),
        valor_iva: fmtCurrency(datos.valor_iva),
        iva_solicitado: fmtAlMil(datos.valor_iva),
        tarifa_iva: tarifaIva(datos.valor_iva, datos.valor_unitario_sin_iva, '[TARIFA DE IVA]'),
        numero_caso_upme: radicado || VACIO,
        // Sin radicado tampoco se imprime una fecha de certificado suelta (igual que la ficha de hoy).
        fecha_certificado_corta: radicado ? fechaCorta(datos.fecha_certificado) : VACIO,
        fecha_certificado_larga: radicado ? fechaLarga(datos.fecha_certificado) : VACIO,
        ...fechaGen(ctx),
        ...frases(titulares.length),
      },
      conds: condsComunes(datos, titulares),
      titulares: titulares.map((x) => ({
        'titular.nombre': x.nombre,
        'titular.cedula': x.identificacion ?? CEDULA,
        'titular.correo': x.email ?? '[CORREO]',
        'titular.celular': x.telefono ?? '[CELULAR]',
      })),
    }
  },
}

export const DOCUMENTOS: Record<TipoPlantilla, DefDocumento> = {
  'declaracion-juramentada': DJ,
  'relacion-facturas': RELACION,
}

export const TIPOS_PLANTILLA = Object.keys(DOCUMENTOS) as TipoPlantilla[]

export function esTipoPlantilla(v: unknown): v is TipoPlantilla {
  return typeof v === 'string' && v in DOCUMENTOS
}

export function defDe(tipo: TipoPlantilla): DefDocumento {
  return DOCUMENTOS[tipo]
}
