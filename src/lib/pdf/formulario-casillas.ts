// Metadata de casillas para la capa editable de formularios (010, 1668…).
// Da etiqueta legible, agrupación y nº de casilla a cada slug, para que el operador
// edite "casilla por casilla" en la plataforma antes de generar el PDF.
// Refinable: Deisy entrega el detalle por seccional; aquí va la base estable.
// Lo que NO esté en el mapa cae a humanizeSlug(slug) — nunca se rompe.

export interface CasillaMeta {
  slug: string
  label: string
  grupo: string
  casilla?: string // nº de casilla DIAN cuando se conoce
}

// Orden = orden de render. grupo = sección visual.
const CASILLAS_010: CasillaMeta[] = [
  // Identificación del solicitante (fuente: RUT)
  { slug: 'tipo_documento', label: 'Tipo de documento', grupo: 'Solicitante', casilla: '5' },
  { slug: 'nit', label: 'Número de identificación', grupo: 'Solicitante', casilla: '6' },
  { slug: 'dv', label: 'DV', grupo: 'Solicitante', casilla: '6' },
  { slug: 'primer_apellido', label: 'Primer apellido', grupo: 'Solicitante', casilla: '7' },
  { slug: 'segundo_apellido', label: 'Segundo apellido', grupo: 'Solicitante', casilla: '8' },
  { slug: 'primer_nombre', label: 'Primer nombre', grupo: 'Solicitante', casilla: '9' },
  { slug: 'otros_nombres', label: 'Otros nombres', grupo: 'Solicitante', casilla: '10' },
  { slug: 'razon_social', label: 'Razón social', grupo: 'Solicitante', casilla: '11' },
  // Ubicación (fuente: RUT)
  { slug: 'direccion_seccional', label: 'Dirección seccional', grupo: 'Ubicación', casilla: '12' },
  { slug: 'pais', label: 'País', grupo: 'Ubicación', casilla: '26' },
  { slug: 'codigo_pais', label: 'Código país', grupo: 'Ubicación', casilla: '26' },
  { slug: 'departamento', label: 'Departamento', grupo: 'Ubicación', casilla: '27' },
  { slug: 'codigo_departamento', label: 'Código departamento', grupo: 'Ubicación', casilla: '27' },
  { slug: 'municipio', label: 'Municipio / Ciudad', grupo: 'Ubicación', casilla: '28' },
  { slug: 'codigo_municipio', label: 'Código municipio', grupo: 'Ubicación', casilla: '28' },
  { slug: 'direccion', label: 'Dirección', grupo: 'Ubicación' },
  { slug: 'correo_electronico', label: 'Correo electrónico', grupo: 'Ubicación' },
  { slug: 'telefono', label: 'Teléfono', grupo: 'Ubicación' },
  // Factura y valor solicitado (fuente: Factura + Concepto UPME)
  { slug: 'numero_factura', label: 'Número de factura', grupo: 'Factura / Valor', casilla: '55' },
  { slug: 'fecha_factura', label: 'Fecha de factura', grupo: 'Factura / Valor' },
  { slug: 'valor_iva', label: 'Valor IVA', grupo: 'Factura / Valor' },
  { slug: 'valor_solicitado', label: 'Valor solicitado', grupo: 'Factura / Valor', casilla: '56' },
  // Formas de pago (fuente: Certificación bancaria)
  { slug: 'entidad_financiera', label: 'Entidad financiera', grupo: 'Cuenta bancaria' },
  { slug: 'numero_cuenta', label: 'Número de cuenta', grupo: 'Cuenta bancaria' },
  { slug: 'tipo_cuenta', label: 'Tipo de cuenta', grupo: 'Cuenta bancaria' },
  // Firma (fuente: RUT)
  { slug: 'nombre_suscriptor', label: 'Nombre quien suscribe', grupo: 'Firma' },
  { slug: 'tipo_doc_suscriptor', label: 'Tipo doc. suscriptor', grupo: 'Firma' },
  { slug: 'identificacion_suscriptor', label: 'Identificación suscriptor', grupo: 'Firma' },
  { slug: 'dv_suscriptor', label: 'DV suscriptor', grupo: 'Firma' },
  // Constantes / clasificación (editables: cambian por seccional)
  { slug: 'concepto', label: 'Concepto', grupo: 'Clasificación', casilla: '2' },
  { slug: 'concepto_label', label: 'Concepto (texto)', grupo: 'Clasificación' },
  { slug: 'tipo_solicitud', label: 'Tipo de solicitud', grupo: 'Clasificación', casilla: '44' },
  { slug: 'tipo_obligacion', label: 'Tipo de obligación', grupo: 'Clasificación', casilla: '50' },
  { slug: 'concepto_saldo', label: 'Concepto del saldo', grupo: 'Clasificación', casilla: '51' },
  { slug: 'nombre_documento', label: 'Nombre del documento', grupo: 'Clasificación', casilla: '57' },
]

const CASILLAS_1668: CasillaMeta[] = [
  { slug: 'tipo_documento', label: 'Tipo de documento', grupo: 'Titular' },
  { slug: 'numero_identificacion', label: 'Número de identificación', grupo: 'Titular' },
  { slug: 'dv', label: 'DV', grupo: 'Titular' },
  { slug: 'primer_apellido', label: 'Primer apellido', grupo: 'Titular' },
  { slug: 'segundo_apellido', label: 'Segundo apellido', grupo: 'Titular' },
  { slug: 'primer_nombre', label: 'Primer nombre', grupo: 'Titular' },
  { slug: 'otros_nombres', label: 'Otros nombres', grupo: 'Titular' },
  { slug: 'fecha_expedicion', label: 'Fecha de expedición', grupo: 'Cuenta bancaria' },
  { slug: 'entidad_financiera', label: 'Entidad financiera', grupo: 'Cuenta bancaria' },
  { slug: 'numero_cuenta', label: 'Número de cuenta', grupo: 'Cuenta bancaria' },
  { slug: 'tipo_cuenta', label: 'Tipo de cuenta', grupo: 'Cuenta bancaria' },
  { slug: 'cod_representacion', label: 'Código representación', grupo: 'Firma' },
]

const POR_TEMPLATE: Record<string, CasillaMeta[]> = {
  'formulario-010': CASILLAS_010,
  'formulario-1668': CASILLAS_1668,
}

export function humanizeSlug(slug: string): string {
  return slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function getCasillasMeta(template: string): CasillaMeta[] {
  return POR_TEMPLATE[template] ?? []
}

/** Meta de un slug para un template; si no está mapeado, etiqueta humanizada. */
export function metaDeCasilla(template: string, slug: string): CasillaMeta {
  const found = POR_TEMPLATE[template]?.find((c) => c.slug === slug)
  return found ?? { slug, label: humanizeSlug(slug), grupo: 'Otros' }
}
