// ============================================================
// El TITULAR de la factura: a nombre de quién salen los documentos del negocio.
//
// La regla (Mauricio, 2026-09-22): factura, recibo de caja y abono se emiten a
// nombre del titular del negocio, la persona que hace el trámite. Ese titular sale
// del bloque RUT. NO va a nombre de quien hizo la transferencia.
//
// Lo nuevo: la financiera puede CORREGIR el nombre y el documento del titular antes
// de facturar, sin volver a subir el RUT (el reproceso vuelve a extraer todo el
// bloque y borra datos). La corrección:
//
//   - NO pisa el RUT extraído. Vive aparte, en `negocios.metadata.titular_corregido`,
//     con quién y cuándo, y manda sobre el RUT mientras exista.
//   - Cubre solo nombre y documento. Dirección, ciudad, correo y teléfono siguen
//     saliendo de donde salían (RUT y contacto).
//   - Vale para TODO documento posterior del negocio: la factura, el recibo de la
//     tarifa UPME y el abono del honorario. Los tres salen al mismo tercero.
//
// Módulo PURO: sin DB ni red. Lo usan el servidor (emisión, cola, recibos) y la
// pantalla (el editor de la revisión), así que las dos leen la misma regla.
// ============================================================

import { calcularDvNit } from '@/lib/dian/nit'

/**
 * Tipos de documento que se pueden poner al corregir. Lista CERRADA: son los que
 * el borrador del tercero sabe tratar sin adivinar.
 *
 * - `13` y `22` son personas: Siigo pide el nombre partido en nombres y apellidos.
 * - `31` es NIT y se trata como EMPRESA (una sola razón social), igual que ya lo
 *   hace el borrador que sale del RUT (`codigoTipoDocumento` en `mapeo.ts`).
 *
 * Fuera a propósito: el pasaporte (41) y los documentos extranjeros, porque son
 * alfanuméricos y todo el camino a Siigo trata la identificación como dígitos.
 */
export const TIPOS_DOCUMENTO_TITULAR = [
  { code: '13', etiqueta: 'Cédula de ciudadanía', sigla: 'CC', empresa: false },
  { code: '22', etiqueta: 'Cédula de extranjería', sigla: 'CE', empresa: false },
  { code: '31', etiqueta: 'NIT', sigla: 'NIT', empresa: true },
] as const

export type CodigoTipoDocumento = (typeof TIPOS_DOCUMENTO_TITULAR)[number]['code']

const CODIGOS = new Set<string>(TIPOS_DOCUMENTO_TITULAR.map(t => t.code))

export function esCodigoTipoDocumento(v: unknown): v is CodigoTipoDocumento {
  return typeof v === 'string' && CODIGOS.has(v)
}

/** Sigla del documento para mostrar: `CC 79782266`, `NIT 900123456-7`. */
export function siglaDocumento(code: string | null | undefined): string {
  return TIPOS_DOCUMENTO_TITULAR.find(t => t.code === code)?.sigla ?? 'Doc.'
}

export function esDocumentoDeEmpresa(code: string | null | undefined): boolean {
  return TIPOS_DOCUMENTO_TITULAR.find(t => t.code === code)?.empresa ?? false
}

/** Lo que la pantalla manda. Todo texto: se valida y normaliza en el servidor. */
export interface TitularEditado {
  tipo_documento: string
  numero: string
  /** Solo cuenta para NIT. Vacío = se calcula. */
  dv?: string
  /** Persona (CC, CE). */
  nombres?: string
  apellidos?: string
  /** Empresa (NIT). */
  razon_social?: string
}

/**
 * El titular ya validado, en la forma que el borrador del tercero consume.
 *
 * `nombre` va como lo pide Siigo: `[nombres, apellidos]` para una persona,
 * `[razón social]` para una empresa.
 */
export interface TitularParaBorrador {
  tipo_documento: CodigoTipoDocumento
  numero: string
  dv: string
  nombre: string[]
}

/** La corrección guardada en `negocios.metadata.titular_corregido`. */
export interface TitularCorregido extends TitularParaBorrador {
  /** Nombre de quien corrigió. */
  por: string | null
  /** `staff.id` de quien corrigió. */
  por_staff_id: string | null
  at: string
  /**
   * Qué decía el RUT al corregir. La corrección NO lo borra, pero sin esto el
   * negocio no podría decir qué se reemplazó ni volver a mostrarlo.
   */
  rut: { identificacion: string | null; nombre: string | null }
}

/** Clave en `negocios.metadata`. Una sola fuente para no escribirla dos veces. */
export const CLAVE_TITULAR_CORREGIDO = 'titular_corregido'

const LARGO_MAXIMO_NOMBRE = 100

/** Espacios colapsados y sin bordes. NO cambia mayúsculas: lo que se escribió, se respeta. */
function limpiarTexto(s: string | null | undefined): string {
  return String(s ?? '').replace(/\s+/g, ' ').trim()
}

/** Para comparar nombres: sin tildes, sin mayúsculas, sin espacios de más. */
export function nombreComparable(partes: Array<string | null | undefined>): string {
  return partes
    .map(limpiarTexto)
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
}

/**
 * Valida lo que escribió la financiera y lo deja listo para el borrador.
 *
 * Deliberadamente estricta con el DOCUMENTO y laxa con el nombre: un dígito de más
 * o de menos es otro tercero en Siigo (y otra persona ante la DIAN), mientras que
 * un nombre raro puede ser perfectamente real.
 */
export function validarTitular(
  e: TitularEditado,
): { ok: true; titular: TitularParaBorrador } | { ok: false; mensaje: string } {
  const tipo = limpiarTexto(e.tipo_documento)
  if (!esCodigoTipoDocumento(tipo)) {
    return { ok: false, mensaje: 'Escoge el tipo de documento del titular' }
  }
  const empresa = esDocumentoDeEmpresa(tipo)

  // Puntos y espacios son separadores de miles («79.782.266»): se quitan. Un NIT
  // escrito con su DV pegado por guion («900123456-7») se parte ahí, que es donde
  // el propio documento lo separa. Cualquier otro carácter es un error de dedo y se
  // dice, en vez de borrarlo en silencio y facturarle a un número que nadie escribió.
  let numeroCrudo = String(e.numero ?? '').replace(/[.\s]/g, '')
  let dvDelNumero: string | null = null
  if (empresa) {
    const m = /^(\d+)-(\d)$/.exec(numeroCrudo)
    if (m) { numeroCrudo = m[1]; dvDelNumero = m[2] }
  }
  if (!numeroCrudo) return { ok: false, mensaje: 'Falta el número de documento del titular' }
  if (!/^\d+$/.test(numeroCrudo)) {
    return { ok: false, mensaje: `"${e.numero}" no es un número de documento: solo van dígitos` }
  }
  // 15 es el tope del algoritmo del DV de la DIAN; 3 deja pasar las cédulas viejas.
  if (numeroCrudo.length < 3 || numeroCrudo.length > 15) {
    return { ok: false, mensaje: `El documento ${numeroCrudo} tiene ${numeroCrudo.length} dígitos: revísalo` }
  }
  const numero = numeroCrudo

  // El DV que viaja es SIEMPRE el calculado: el escrito solo sirve para revisar el NIT.
  const dv = calcularDvNit(numero) ?? ''
  if (empresa) {
    const dvEscrito = limpiarTexto(e.dv) || dvDelNumero || ''
    if (dvEscrito && dvEscrito !== dv) {
      // El DV es determinista (módulo 11): si no cuadra, lo que está mal es el NIT
      // o el DV, y cualquiera de los dos es facturarle a otra empresa.
      return {
        ok: false,
        mensaje: `El DV ${dvEscrito} no corresponde al NIT ${numero} (el que le toca es ${dv}). Revisa el NIT.`,
      }
    }
  }

  let nombre: string[]
  if (empresa) {
    const razon = limpiarTexto(e.razon_social)
    if (!razon) return { ok: false, mensaje: 'Falta la razón social del titular' }
    nombre = [razon]
  } else {
    const nombres = limpiarTexto(e.nombres)
    const apellidos = limpiarTexto(e.apellidos)
    // Siigo parte el nombre de una persona en dos: sin cualquiera de las dos
    // mitades, el tercero sale con un apellido vacío o un nombre vacío.
    if (!nombres) return { ok: false, mensaje: 'Faltan los nombres del titular' }
    if (!apellidos) return { ok: false, mensaje: 'Faltan los apellidos del titular' }
    nombre = [nombres, apellidos]
  }
  if (nombre.some(p => p.length > LARGO_MAXIMO_NOMBRE)) {
    return { ok: false, mensaje: `El nombre del titular pasa de ${LARGO_MAXIMO_NOMBRE} caracteres` }
  }

  return { ok: true, titular: { tipo_documento: tipo, numero, dv, nombre } }
}

/**
 * Lee la corrección guardada. Defensiva: lo que no tenga la forma completa NO es
 * una corrección y se ignora (vuelve a mandar el RUT), en vez de armar un tercero
 * a medias con un pedazo de ella.
 */
export function leerTitularCorregido(
  metadata: Record<string, unknown> | null | undefined,
): TitularCorregido | null {
  const t = (metadata ?? {})[CLAVE_TITULAR_CORREGIDO]
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null
  const c = t as Partial<TitularCorregido>
  if (!esCodigoTipoDocumento(c.tipo_documento)) return null
  if (typeof c.numero !== 'string' || !/^\d+$/.test(c.numero)) return null
  if (!Array.isArray(c.nombre) || c.nombre.length === 0) return null
  if (!c.nombre.every(p => typeof p === 'string' && p.trim() !== '')) return null
  if (esDocumentoDeEmpresa(c.tipo_documento) ? c.nombre.length !== 1 : c.nombre.length !== 2) return null
  return {
    tipo_documento: c.tipo_documento,
    numero: c.numero,
    dv: typeof c.dv === 'string' && c.dv ? c.dv : (calcularDvNit(c.numero) ?? ''),
    nombre: c.nombre,
    por: typeof c.por === 'string' ? c.por : null,
    por_staff_id: typeof c.por_staff_id === 'string' ? c.por_staff_id : null,
    at: typeof c.at === 'string' ? c.at : '',
    rut: {
      identificacion: typeof c.rut?.identificacion === 'string' ? c.rut.identificacion : null,
      nombre: typeof c.rut?.nombre === 'string' ? c.rut.nombre : null,
    },
  }
}

/** Lo mínimo para comparar dos titulares. `tipo_documento` como texto: el del RUT llega así. */
type TitularComparable = { tipo_documento: string; numero: string; nombre: string[] }

/** ¿Dos titulares son el mismo, para efectos del documento que se emite? */
export function mismoTitular(a: TitularComparable | null, b: TitularComparable | null): boolean {
  if (!a || !b) return a === b
  return a.tipo_documento === b.tipo_documento
    && a.numero === b.numero
    && nombreComparable(a.nombre) === nombreComparable(b.nombre)
}

/** `CC 79782266` o `NIT 900123456-7`. */
export function documentoLegible(t: { tipo_documento: string; numero: string; dv: string | null }): string {
  const sigla = siglaDocumento(t.tipo_documento)
  return esDocumentoDeEmpresa(t.tipo_documento) && t.dv
    ? `${sigla} ${t.numero}-${t.dv}`
    : `${sigla} ${t.numero}`
}

/**
 * La línea del timeline. `activity_log.contenido` tiene CHECK de 280 caracteres y
 * un nombre largo tumbaría el INSERT entero: se recorta aquí, no se confía en que
 * quepa.
 */
export function textoActividadTitular(
  nuevo: TitularParaBorrador | null,
  rut: { identificacion: string | null; nombre: string | null },
): string {
  const delRut = [rut.nombre, rut.identificacion].filter(Boolean).join(' · ') || 'sin datos'
  const texto = nuevo
    ? `Titular de la factura corregido: ${nuevo.nombre.join(' ')} (${documentoLegible(nuevo)}). `
      + `El RUT dice: ${delRut}. La factura, el recibo de caja y los abonos saldrán a este titular.`
    : `Titular de la factura: se quitó la corrección, vuelve a ser el del RUT (${delRut}).`
  return texto.length <= 280 ? texto : `${texto.slice(0, 279)}…`
}
