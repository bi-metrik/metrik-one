// ============================================================
// El titular en la pantalla de «Revisar y facturar»: con qué arranca el editor,
// cuándo hay de verdad una corrección que mandar, y qué avisar antes de facturar.
//
// Puro y compartido por la pantalla y sus pruebas. La regla de fondo (qué es un
// titular válido, cómo se guarda) vive en `@/lib/siigo/titular`, la misma que usa
// el servidor: la pantalla no valida con un criterio propio.
// ============================================================

import type { CasoPorFacturar } from '@/lib/actions/facturacion-actions'
import {
  documentoLegible,
  esDocumentoDeEmpresa,
  mismoTitular,
  nombreComparable,
  validarTitular,
  type TitularEditado,
} from '@/lib/siigo/titular'

/** Lo que el editor tiene escrito. Todo texto, como un formulario. */
export interface TitularEnPantalla {
  tipo_documento: string
  numero: string
  dv: string
  nombres: string
  apellidos: string
  razon_social: string
}

type CasoTitular = Pick<CasoPorFacturar, 'titular' | 'tercero_siigo' | 'recibos_emitidos'>

/**
 * El editor arranca con el titular VIGENTE (el corregido, o el del RUT): la pantalla
 * es una revisión, no un formulario en blanco.
 */
export function titularInicial(caso: Pick<CasoPorFacturar, 'titular'>): TitularEnPantalla {
  const t = caso.titular
  const empresa = esDocumentoDeEmpresa(t.tipo_documento)
  return {
    tipo_documento: t.tipo_documento,
    numero: t.numero ?? '',
    dv: empresa ? (t.dv ?? '') : '',
    nombres: empresa ? '' : (t.nombre[0] ?? ''),
    apellidos: empresa ? '' : (t.nombre[1] ?? ''),
    razon_social: empresa ? (t.nombre[0] ?? '') : '',
  }
}

/** Lo que viaja al servidor. Solo los campos del tipo escogido. */
export function titularParaEnviar(e: TitularEnPantalla): TitularEditado {
  return esDocumentoDeEmpresa(e.tipo_documento)
    ? { tipo_documento: e.tipo_documento, numero: e.numero, dv: e.dv, razon_social: e.razon_social }
    : { tipo_documento: e.tipo_documento, numero: e.numero, nombres: e.nombres, apellidos: e.apellidos }
}

/**
 * ¿Hay de verdad algo que corregir? Abrir el editor y no tocar nada NO es corregir:
 * si viajara igual, el servidor reescribiría la corrección (autor y fecha nuevos) sin
 * que nadie la pidiera.
 */
export function titularCambio(caso: Pick<CasoPorFacturar, 'titular'>, e: TitularEnPantalla): boolean {
  const v = validarTitular(titularParaEnviar(e))
  // Lo que no valida sí "cambió": hay que mostrar el error, no esconderlo.
  if (!v.ok) return true
  return !mismoTitular(v.titular, {
    tipo_documento: caso.titular.tipo_documento,
    numero: caso.titular.numero ?? '',
    nombre: caso.titular.nombre,
  })
}

/** El error de lo escrito, con la MISMA regla del servidor; null si está bien. */
export function errorDelTitular(e: TitularEnPantalla): string | null {
  const v = validarTitular(titularParaEnviar(e))
  return v.ok ? null : v.mensaje
}

/**
 * Lo que hay que saber ANTES de facturar con un titular distinto.
 *
 * No bloquea: la corrección es una decisión de la financiera. Lo que hace es decir lo
 * que la decisión arrastra, porque nada de esto se ve después en la factura.
 */
export function avisosDeTitular(caso: CasoTitular, e: TitularEnPantalla): string[] {
  const v = validarTitular(titularParaEnviar(e))
  if (!v.ok || !titularCambio(caso, e)) return []
  const nuevo = v.titular
  const avisos: string[] = []

  const rut = caso.titular.corregido?.rut ?? null
  const vuelveAlRut = rut != null
    && rut.identificacion === nuevo.numero
    && nombreComparable([rut.nombre]) === nombreComparable(nuevo.nombre)
  if (vuelveAlRut) {
    avisos.push('Queda otra vez el titular del RUT: se quita la corrección.')
  }

  const actual = caso.titular.numero ?? ''
  if (nuevo.numero !== actual) {
    const anterior = caso.tercero_siigo ?? actual
    avisos.push(
      `${documentoLegible(nuevo)} es otro tercero en Siigo: ONE lo busca por ese documento y, `
      + 'si no existe, lo crea con la dirección y la ciudad del RUT. Si ya existe, se usa tal como está allá. '
      + (anterior ? `El tercero ${anterior} no se toca.` : ''),
    )
  }

  if (caso.recibos_emitidos.length > 0) {
    avisos.push(
      `Ya salió ${caso.recibos_emitidos.join(', ')} con el titular anterior y no cambia. `
      + 'Desde ahora la factura, el recibo de la tarifa UPME y los abonos salen a este titular.',
    )
  }
  return avisos
}
