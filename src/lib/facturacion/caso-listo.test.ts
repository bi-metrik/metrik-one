import { describe, it, expect } from 'vitest'
import { casoListoParaFacturar, faltantesDelCaso } from './caso-listo'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

const base = { faltan_factura: [] as string[], faltan_cliente: [] as string[], falta_saldo: 0 }

describe('casoListoParaFacturar', () => {
  it('con datos completos y el honorario recaudado, está listo', () => {
    expect(casoListoParaFacturar(base)).toBe(true)
  })

  it('un dato faltante del cliente lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_cliente: ['email'] })).toBe(false)
  })

  it('un dato faltante de la factura lo saca de listos', () => {
    expect(casoListoParaFacturar({ ...base, faltan_factura: ['honorario aprobado'] })).toBe(false)
  })

  it('con saldo del honorario pendiente NO está listo', () => {
    // Es plata que no entró, no un dato que falte. Mostrarlo como listo haría que
    // la bandeja prometa una factura que el gate del servidor va a rechazar.
    expect(casoListoParaFacturar({ ...base, falta_saldo: 250_000 })).toBe(false)
  })

  it('un residuo por debajo de la materialidad no frena', () => {
    // Misma vara que los demás gates del producto: un remanente no cobrable en la
    // práctica no puede dejar un caso sin facturar para siempre.
    expect(casoListoParaFacturar({ ...base, falta_saldo: TOLERANCIA_SALDO_COP })).toBe(true)
    expect(casoListoParaFacturar({ ...base, falta_saldo: TOLERANCIA_SALDO_COP + 1 })).toBe(false)
  })
})

describe('faltantesDelCaso', () => {
  it('no repite un faltante que aparece en las dos listas', () => {
    const f = faltantesDelCaso({ ...base, faltan_cliente: ['identificación'], faltan_factura: ['identificación'] })
    expect(f).toEqual(['identificación'])
  })

  it('nombra el recaudo pendiente como una falta más', () => {
    expect(faltantesDelCaso({ ...base, falta_saldo: 100_000 })).toContain('recaudo del honorario')
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
