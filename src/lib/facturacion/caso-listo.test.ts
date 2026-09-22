/**
 * El criterio de la cola de facturación.
 *
 * Desde el 2026-09-22 el recaudo del honorario ya NO entra (decisión de Mauricio): la
 * factura sale a crédito en cualquier momento y los pagos se le abonan. Este archivo
 * fijaba la banda de materialidad del 1% y los tres estados del recaudo (`cubierto`,
 * `descuadre_menor`, `retenido`); esas funciones ya no existen. Lo que queda es lo de
 * siempre: los datos del borrador y la etiqueta del RUT.
 */
import { describe, it, expect } from 'vitest'
import * as casoListo from './caso-listo'
import { casoListoParaFacturar, faltantesDelCaso } from './caso-listo'

const base = {
  faltan_factura: [] as string[],
  faltan_cliente: [] as string[],
}

describe('casoListoParaFacturar', () => {
  it('con datos completos, está listo', () => {
    expect(casoListoParaFacturar(base)).toBe(true)
  })

  it('un dato faltante del cliente lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_cliente: ['email'] })).toBe(false)
  })

  it('un dato faltante de la factura lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_factura: ['honorario aprobado'] })).toBe(false)
  })

  it('el recaudo no puede frenarla: el módulo ya no expone el gate', () => {
    // Si alguien lo reintroduce, la pantalla y la bandeja volverían a esconder casos
    // que sí se pueden facturar. Fijarlo por nombre es más barato que redescubrirlo.
    expect(Object.keys(casoListo)).not.toContain('estadoDeRecaudo')
    expect(Object.keys(casoListo)).not.toContain('bandaMaterialidadFacturacion')
    expect(Object.keys(casoListo)).not.toContain('razonDeRetencion')
  })
})

describe('faltantesDelCaso', () => {
  it('no repite un faltante que aparece en las dos listas', () => {
    const f = faltantesDelCaso({ ...base, faltan_cliente: ['identificación'], faltan_factura: ['identificación'] })
    expect(f).toEqual(['identificación'])
  })

  it('sin faltas, lista vacía', () => {
    expect(faltantesDelCaso(base)).toEqual([])
  })
})

describe('faltantesDelCaso — sin RUT se nombra la causa, no las consecuencias', () => {
  // Los cinco casos con pago y sin recibo de caja medidos el 2026-09-08 (V0231,
  // V0442, V0443, V0453, V0471) llegaban así: el RUT nunca se cargó, y la tarjeta
  // pintaba cuatro etiquetas de datos personales como si fueran para teclear.
  const sinRut = {
    ...base,
    sin_rut: true,
    faltan_cliente: ['identificación', 'nombre', 'dirección', 'ciudad (no se pudo resolver el código DANE)'],
  }

  it('reemplaza los faltantes derivados del RUT por una sola etiqueta', () => {
    expect(faltantesDelCaso(sinRut)).toEqual(['RUT sin cargar'])
  })

  it('conserva lo que le falta a la FACTURA, que no sale del RUT', () => {
    // El honorario no está en el RUT: sigue faltando el día que el documento llegue.
    const f = faltantesDelCaso({ ...sinRut, faltan_factura: ['honorario aprobado'] })
    expect(f).toEqual(['RUT sin cargar', 'honorario aprobado'])
  })

  it('con RUT cargado los faltantes del cliente se muestran uno a uno', () => {
    // Ahí sí son datos sueltos por corregir, y decir "RUT sin cargar" mentiría.
    const f = faltantesDelCaso({ ...base, sin_rut: false, faltan_cliente: ['email'] })
    expect(f).toEqual(['email'])
  })

  it('sigue sin estar listo para facturar', () => {
    // La etiqueta cambia lo que se lee, no el gate: sin identificación no hay tercero.
    expect(casoListoParaFacturar(sinRut)).toBe(false)
  })
})
