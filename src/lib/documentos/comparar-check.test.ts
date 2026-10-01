/**
 * Las comparaciones de la validación del documento, con datos INVENTADOS que reproducen la
 * forma de los avisos falsos medidos en los certificados UPME de SOENA el 2026-10-01.
 */
import { describe, expect, it } from 'vitest'
import { compararCheck, evaluarCheck, resolverDesdeFuente } from './comparar-check'

describe('compararCheck', () => {
  it('tokens: la misma regla de nombres que los cruces de la línea', () => {
    expect(compararCheck('GARCIA MEJIA PEDRO', 'PEDRO GARCIA MEJIA', 'tokens')).toBe(true)
    // Letra griega leída del PDF.
    expect(compararCheck('GARCIA MEJIA PEDRO', 'GARCIA MEJIA PEDRΟ', 'tokens')).toBe(true)
    // El RUT sin el segundo apellido, con doble espacio.
    expect(compararCheck('GARCIA  PEDRO ANTONIO', 'GARCIA MEJIA PEDRO ANTONIO', 'tokens')).toBe(true)
    expect(compararCheck('GARCIA MEJIA PEDRO', 'GARCIA MEJIA LUISA', 'tokens')).toBe(false)
    expect(compararCheck('GARCIA PEDRO', 'GARCIA MEJIA PEDRO', 'tokens')).toBe(false)
  })

  it('id_prefix: el DV pegado y el «13» del tipo de documento, pero no un dígito de más en medio', () => {
    expect(compararCheck('900123456', '9001234567', 'id_prefix')).toBe(true)
    expect(compararCheck('1312345678', '12345678', 'id_prefix')).toBe(true)
    expect(compararCheck('12345678', '12345678', 'id_prefix')).toBe(true)
    expect(compararCheck('123345678', '12345678', 'id_prefix')).toBe(false)
    expect(compararCheck('12345', '12345', 'id_prefix')).toBe(false)
  })

  it('overlap: el mismo modelo con otros espacios coincide; otro modelo no', () => {
    expect(compararCheck('RAV4 2026', 'RAV 4 XLE 2026', 'overlap')).toBe(true)
    expect(compararCheck('Q5 tfsi55e 2025', 'Q5 TFSI 55E 2025', 'overlap')).toBe(true)
    expect(compararCheck('X3 xDrive30e 2023', 'X3 XDRIVE 30 E 2023', 'overlap')).toBe(true)
    // Una sola letra: antes no había palabra «significativa» y fallaba contra sí misma.
    expect(compararCheck('X 2026', 'X 2026', 'overlap')).toBe(true)
    expect(compararCheck('MG', 'MG', 'overlap')).toBe(true)
    expect(compararCheck('EV5 2025', 'EV3 LIGHT 2023', 'overlap')).toBe(false)
    expect(compararCheck('SEDAN 2026', 'COUPE 2026', 'overlap')).toBe(false)
  })

  it('subset y exact: la sigla con puntos y las tildes', () => {
    expect(compararCheck('MOTORES DEL SUR SAS', 'Motores del Sur S.A.S.', 'subset')).toBe(true)
    expect(compararCheck('Bogotá', 'BOGOTA', 'exact')).toBe(true)
    expect(compararCheck('Bogotá', 'Cali', 'exact')).toBe(false)
  })

  it('un lado vacío no coincide en los modos de texto', () => {
    expect(compararCheck('', 'GARCIA', 'tokens')).toBe(false)
    expect(compararCheck('GARCIA', '', 'exact')).toBe(false)
  })

  it('monto sigue con su tolerancia', () => {
    expect(evaluarCheck('100000000', '$ 100.000.500', 'monto').estado).toBe('ok')
    expect(evaluarCheck('100000000', '110000000', 'monto').estado).toBe('falla')
  })
})

describe('resolverDesdeFuente', () => {
  const rut = { razon_social: 'GARCIA  PEDRO ANTONIO', nombre_alterno: 'GARCIA MEJIA PEDRO ANTONIO' }
  const fuente = { source_bloque_slug: 'rut', source_etapa_orden: 6, source_bloque_nombre: 'RUT' }

  it('campo único', () => {
    const v = resolverDesdeFuente({ ...fuente, source_field: 'razon_social' }, rut, 'GARCIA MEJIA PEDRO ANTONIO', 'tokens')
    expect(v).toMatchObject({ estado: 'ok', expected: 'GARCIA  PEDRO ANTONIO' })
  })

  it('campos concatenados', () => {
    const v = resolverDesdeFuente(
      { ...fuente, source_fields: ['a', 'b'] },
      { a: 'GARCIA', b: 'MEJIA PEDRO' },
      'PEDRO GARCIA MEJIA',
      'tokens',
    )
    expect(v).toMatchObject({ estado: 'ok', expected: 'GARCIA MEJIA PEDRO' })
  })

  it('sin campo declarado: falla', () => {
    expect(resolverDesdeFuente(fuente, rut, 'X', 'tokens').estado).toBe('falla')
  })
})
