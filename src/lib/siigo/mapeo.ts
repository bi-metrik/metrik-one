// ============================================================
// Mapeo ONE → Siigo. Funciones PURAS (sin DB, sin red) para poder probarlas
// contra documentos reales sin emitir nada.
//
// Principio de diseño (Mauricio, 2026-08-06): **ONE sugiere, la financiera
// edita.** Ningún campo es inamovible: hay casos en que la factura sale a
// nombre de otra persona o de una empresa. Por eso el resultado se llama
// "borrador" y viaja con `_faltantes`: lo que ONE no pudo resolver se muestra
// para que lo llenen, en vez de inventarlo o de fallar en silencio.
// ============================================================

import { resolverCodigosUbicacion } from '@/lib/dian/divipola'
import { calcularDvNit, nitSinDv } from '@/lib/dian/nit'
import type { SiigoConfig } from './client'

/** Campos del bloque `rut` tal como los deja la extracción con IA. */
export interface RutExtraido {
  numero_identificacion?: string
  nit?: string
  dv?: string
  razon_social?: string
  primer_nombre?: string
  otros_nombres?: string
  primer_apellido?: string
  segundo_apellido?: string
  tipo_persona?: string
  tipo_documento?: string
  direccion?: string
  telefono?: string
  email?: string
  municipio?: string
  departamento?: string
  pais?: string
  codigo_municipio?: string
  codigo_departamento?: string
  codigo_pais?: string
}

export interface DatosContacto {
  email?: string | null
  telefono?: string | null
}

export interface BorradorCliente {
  person_type: 'Person' | 'Company'
  id_type: { code: string }
  identification: string
  check_digit: string
  name: string[]
  commercial_name?: string
  vat_responsible: boolean
  address: {
    address: string
    city: { country_code: string; state_code: string; city_code: string }
  }
  phones: Array<{ number: string }>
  contacts: Array<{ first_name: string; last_name: string; email: string }>
}

export interface Borrador<T> {
  /** Lo que se enviaría a Siigo. Editable antes de enviar. */
  payload: T
  /** Campos que ONE no pudo resolver. Si hay alguno, NO se envía sin revisar. */
  faltantes: string[]
}

const limpiar = (s: string | null | undefined): string => (s ?? '').trim()

/**
 * Tipo de documento de Siigo. `13` cédula de ciudadanía, `31` NIT.
 * Se decide por el tipo de persona, no por el largo del número: un NIT de
 * persona natural existe y confundirlos cambia el documento fiscal.
 */
function codigoTipoDocumento(rut: RutExtraido): string {
  const tp = limpiar(rut.tipo_persona).toLowerCase()
  if (tp.startsWith('jur')) return '31'
  const td = limpiar(rut.tipo_documento).toLowerCase()
  if (td.includes('nit')) return '31'
  return '13'
}

/**
 * Siigo espera el nombre como ARREGLO: para persona natural ["NOMBRES",
 * "APELLIDOS"], para empresa ["RAZÓN SOCIAL"]. El RUT trae los cuatro campos
 * por separado, así que se arma desde ahí; `razon_social` es el respaldo,
 * pero viene en orden apellidos-nombres y NO se puede partir a ciegas.
 */
export function nombreParaSiigo(rut: RutExtraido, esEmpresa: boolean): string[] {
  if (esEmpresa) return [limpiar(rut.razon_social) || limpiar(rut.primer_nombre)]
  const nombres = [rut.primer_nombre, rut.otros_nombres].map(limpiar).filter(Boolean).join(' ')
  const apellidos = [rut.primer_apellido, rut.segundo_apellido].map(limpiar).filter(Boolean).join(' ')
  if (nombres && apellidos) return [nombres, apellidos]
  // Sin los campos desglosados no se adivina dónde termina el nombre y empieza
  // el apellido: se manda la razón social entera y que la revisen.
  return [limpiar(rut.razon_social)]
}

/**
 * Código de ciudad de Siigo: 5 dígitos (departamento + municipio DANE).
 *
 * ⚠️ Los códigos que trae el RUT extraído NO sirven: se midió en producción que
 * `codigo_departamento` llega con el código de PAÍS (169) y `codigo_municipio`
 * con un sufijo suelto. Por eso se resuelven desde los NOMBRES con DIVIPOLA y
 * los códigos extraídos NO se pasan como respaldo.
 */
export function ciudadParaSiigo(rut: RutExtraido): { country_code: string; state_code: string; city_code: string } | null {
  const cod = resolverCodigosUbicacion(rut.pais ?? 'Colombia', rut.departamento, rut.municipio)
  if (!cod.codigo_departamento || !cod.codigo_municipio) return null
  return {
    country_code: 'Co',
    state_code: cod.codigo_departamento,
    city_code: `${cod.codigo_departamento}${cod.codigo_municipio}`,
  }
}

export function borradorCliente(rut: RutExtraido, contacto: DatosContacto): Borrador<BorradorCliente> {
  const faltantes: string[] = []
  const idType = codigoTipoDocumento(rut)
  const esEmpresa = idType === '31'

  // `nitSinDv` y `calcularDvNit` devuelven null cuando el dato no sirve. Se
  // colapsa a cadena vacia y se declara faltante: el payload debe seguir siendo
  // mostrable en pantalla para que lo corrijan, no romperse a medio armar.
  const identification = nitSinDv(limpiar(rut.numero_identificacion) || limpiar(rut.nit)) ?? ''
  if (!identification) faltantes.push('identificación')

  // El DV del RUT se respeta; si no vino, se calcula (módulo 11, determinista).
  const check_digit = limpiar(rut.dv) || (identification ? calcularDvNit(identification) ?? '' : '')

  const name = nombreParaSiigo(rut, esEmpresa)
  if (name.length === 0 || !name[0]) faltantes.push('nombre')

  const ciudad = ciudadParaSiigo(rut)
  if (!ciudad) faltantes.push('ciudad (no se pudo resolver el código DANE)')

  const direccion = limpiar(rut.direccion)
  if (!direccion) faltantes.push('dirección')

  // El contacto es el dato que el comercial mantiene vivo; el RUT es una foto
  // del documento. Se prefiere el contacto y se cae al RUT.
  const email = limpiar(contacto.email) || limpiar(rut.email)
  if (!email) faltantes.push('email')
  const telefono = limpiar(contacto.telefono) || limpiar(rut.telefono)

  return {
    payload: {
      person_type: esEmpresa ? 'Company' : 'Person',
      id_type: { code: idType },
      identification,
      check_digit,
      name,
      vat_responsible: false,
      address: {
        address: direccion,
        city: ciudad ?? { country_code: 'Co', state_code: '', city_code: '' },
      },
      // Se quita el indicativo de pais: ONE guarda "+57 300…" y Siigo espera el
      // numero nacional. Dejarlo pegado produce un telefono de 12 digitos.
      phones: telefono ? [{ number: telefono.replace(/[^\d]/g, '').replace(/^57(?=\d{10}$)/, '') }] : [],
      contacts: [{
        first_name: name[0] ?? '',
        last_name: name[1] ?? '',
        email,
      }],
    },
    faltantes,
  }
}

export interface BorradorRecibo {
  document: { id: number }
  date: string
  type: 'AdvancePayment'
  customer: { identification: string; branch_office: number }
  payment: { id: number; value: number }
  observations: string
}

/**
 * Recibo de caja del recaudo de la tarifa UPME.
 *
 * NO es ingreso: SOENA solo recauda y desembolsa a la UPME. Por eso va como
 * `AdvancePayment` (anticipo, que contablemente es pasivo) y NUNCA como factura.
 * El valor sale del comprobante de pago cargado en la etapa Pago UPME, que es
 * lo efectivamente pagado, no un estimado.
 */
export function borradorRecibo(
  cfg: SiigoConfig,
  identificacion: string,
  valorPagado: number | null,
  fecha: string,
): Borrador<BorradorRecibo> {
  const faltantes: string[] = []
  if (!identificacion) faltantes.push('identificación')
  if (valorPagado == null || !(valorPagado > 0)) faltantes.push('valor pagado a la UPME')

  return {
    payload: {
      document: { id: cfg.reciboDocumentId },
      date: fecha,
      type: 'AdvancePayment',
      customer: { identification: identificacion, branch_office: 0 },
      payment: { id: cfg.reciboPaymentId, value: valorPagado ?? 0 },
      observations: 'Valor recaudado para pago ante la UPME',
    },
    faltantes,
  }
}

export interface BorradorFactura {
  document: { id: number }
  date: string
  customer: { identification: string; branch_office: number }
  seller: number
  items: Array<{ code: string; quantity: number; price: number; taxes: Array<{ id: number }> }>
  payments: Array<{ id: number; value: number; due_date: string }>
  observations?: string
  stamp?: { send: boolean }
  mail?: { send: boolean }
}

/**
 * Factura del HONORARIO. La tarifa UPME queda fuera a propósito (va por recibo).
 *
 * ⚠️ `precio_aprobado` de ONE es el honorario CON IVA (verificado contra las
 * facturas reales de SOENA: precio 318.750 ⇄ total 318.750, base 267.857,14).
 * Siigo espera en `items[].price` la BASE gravable y él calcula el impuesto, así
 * que hay que DIVIDIR por (1 + iva), no multiplicar. Mandar el precio con IVA
 * facturaría un 19% de más.
 */
export function borradorFactura(
  cfg: SiigoConfig,
  identificacion: string,
  honorarioConIva: number | null,
  fecha: string,
  ivaPct: number,
  opciones?: { emitir?: boolean; enviarCorreo?: boolean; observaciones?: string },
): Borrador<BorradorFactura> {
  const faltantes: string[] = []
  if (!identificacion) faltantes.push('identificación')
  if (honorarioConIva == null || !(honorarioConIva > 0)) faltantes.push('honorario aprobado')

  const total = honorarioConIva ?? 0
  // Redondeo a 2 decimales: Siigo acepta hasta 6 en price, pero más precisión
  // solo arrastra ruido de coma flotante al total que valida la DIAN.
  const base = Math.round((total / (1 + ivaPct / 100)) * 100) / 100

  return {
    payload: {
      document: { id: cfg.facturaDocumentId },
      date: fecha,
      customer: { identification: identificacion, branch_office: 0 },
      seller: cfg.sellerId,
      items: [{
        code: cfg.productoCode,
        quantity: 1,
        price: base,
        taxes: [{ id: cfg.ivaId }],
      }],
      payments: [{ id: cfg.facturaPaymentId, value: total, due_date: fecha }],
      ...(opciones?.observaciones ? { observations: opciones.observaciones } : {}),
      // Por defecto NO se radica ante la DIAN ni se manda al cliente: la emisión
      // electrónica es irreversible y la decide una persona, no el flujo.
      stamp: { send: opciones?.emitir === true },
      mail: { send: opciones?.enviarCorreo === true },
    },
    faltantes,
  }
}
