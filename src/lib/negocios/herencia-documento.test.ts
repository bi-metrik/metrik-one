import { describe, it, expect } from 'vitest'
import { llavesDeHerenciaDocumento } from './herencia-documento'

/**
 * El defecto que cierra esta regla: todos los bloques de documento comparten un
 * `bloque_definition_id`, así que heredar por él entrega cualquier documento del negocio.
 * Los casos de abajo son los reales, medidos en SOENA el 2026-09-08.
 */

const DEF = '61988509-deb4-40fa-a0c0-5afe66fe7f6c'

/** Lo que hace el auto-init: prueba las llaves en orden y se queda con la primera que pega. */
function heredaDe(
  completados: Record<string, string>,
  label: string | null,
  nombre?: string | null,
): string | null {
  for (const llave of llavesDeHerenciaDocumento(DEF, label, nombre)) {
    if (completados[llave]) return completados[llave]
  }
  return null
}

describe('de qué casilla hereda su archivo un documento', () => {
  const YA_CARGADOS = {
    [`${DEF}:004_FACTURA`]: 'factura.pdf',
    [`${DEF}:007_RUT`]: 'rut.pdf',
    [`${DEF}:Factura emitida`]: 'siigo.pdf',
  }

  it('hereda del documento con su mismo label', () => {
    expect(heredaDe(YA_CARGADOS, '004_FACTURA')).toBe('factura.pdf')
    expect(heredaDe(YA_CARGADOS, '007_RUT')).toBe('rut.pdf')
  })

  it('NO hereda de otro documento aunque compartan definition_id', () => {
    // El caso medido: la copia de 007A_RUT_2 se quedaba con la factura, y la casilla
    // afirmaba tener un RUT del segundo solicitante que nunca llegó.
    expect(heredaDe(YA_CARGADOS, '007A_RUT_2')).toBeNull()
    expect(heredaDe(YA_CARGADOS, '009_CARTA_AUTORIZACION')).toBeNull()
  })

  it('una copia de solo lectura sin label cae al nombre', () => {
    // «Factura emitida» y «Propuesta económica firmada» no declaran label: sin este
    // respaldo sus copias nacerían vacías, cuando su único trabajo es mostrar el original.
    expect(heredaDe(YA_CARGADOS, null, 'Factura emitida')).toBe('siigo.pdf')
  })

  it('una casilla editable no usa el respaldo por nombre', () => {
    // Sin `nombre`: ahí carga una persona, y una casilla que aparece llena sola invita a
    // dar por recibido un documento que nadie subió.
    expect(heredaDe(YA_CARGADOS, null)).toBeNull()
  })

  it('el nombre no repite la llave cuando ya es igual al label', () => {
    expect(llavesDeHerenciaDocumento(DEF, '004_FACTURA', '004_FACTURA'))
      .toEqual([`${DEF}:004_FACTURA`])
  })

  it('sin label ni nombre no se hereda: nace vacía', () => {
    expect(llavesDeHerenciaDocumento(DEF, null, null)).toEqual([])
    expect(llavesDeHerenciaDocumento(DEF, undefined)).toEqual([])
  })

  it('el orden es label primero, nombre después', () => {
    // Importa cuando ambos existen y apuntan a documentos distintos: manda el label,
    // que es de donde sale el nombre del archivo en Drive.
    expect(llavesDeHerenciaDocumento(DEF, '004_FACTURA', 'Factura Venta Vehículo'))
      .toEqual([`${DEF}:004_FACTURA`, `${DEF}:Factura Venta Vehículo`])
  })
})
