import { describe, expect, it } from 'vitest'

import {
  claveTarifa,
  renombreDeRanura,
  esTarifaConNombre,
  NOMBRES_TARIFA,
  tarifasQueFaltan,
} from './tarifas'

describe('NOMBRES_TARIFA', () => {
  it('son EXACTAMENTE los tres que ve el cliente, con tilde', () => {
    // Viajan al PDF. Si esta prueba cae, cambió el documento del cliente.
    expect([...NOMBRES_TARIFA]).toEqual(['Económica', 'Recomendada', 'Premium'])
  })
})

describe('tarifasQueFaltan', () => {
  it('sin nada creado, faltan las tres en orden de presentación', () => {
    expect(tarifasQueFaltan([])).toEqual(['Económica', 'Recomendada', 'Premium'])
  })

  it('no repite las que ya están', () => {
    expect(tarifasQueFaltan(['Recomendada'])).toEqual(['Económica', 'Premium'])
    expect(tarifasQueFaltan([...NOMBRES_TARIFA])).toEqual([])
  })

  it('⚠️ reconoce la tilde escrita a mano: «Economica» YA existe', () => {
    // Sin esto se crearía una segunda Económica, con otro precio, y ninguna forma de
    // saber cuál es la que va al cliente. El nombre es texto libre desde T6.
    expect(tarifasQueFaltan(['Economica'])).toEqual(['Recomendada', 'Premium'])
    expect(tarifasQueFaltan(['  PREMIUM  '])).toEqual(['Económica', 'Recomendada'])
  })

  it('las filas sin nombre y las de otro nombre no cuentan', () => {
    expect(tarifasQueFaltan([null, undefined, '', '   ', 'Opción 4'])).toEqual([
      'Económica',
      'Recomendada',
      'Premium',
    ])
  })
})

describe('esTarifaConNombre', () => {
  it.each([
    ['Económica', true],
    ['economica', true],
    ['PREMIUM', true],
    ['Recomendada para el cliente', false],
    ['Opción 1', false],
    ['', false],
    [null, false],
  ])('%s → %s', (nombre, esperado) => {
    expect(esTarifaConNombre(nombre)).toBe(esperado)
  })
})

describe('claveTarifa', () => {
  it('normaliza tildes, mayúsculas y espacios', () => {
    expect(claveTarifa('  Económica ')).toBe('economica')
    expect(claveTarifa(null)).toBe('')
  })
})

// ── Renombrar una ranura ──────────────────────────────────────

describe('renombreDeRanura', () => {
  it('le pone nombre a la primera sin inventarle ordinal', () => {
    const r = renombreDeRanura('vuelo', 'Bogotá a San Andrés', ['vuelo', 'hotel'])
    expect(r).toEqual({ ok: true, grupo: 'vuelo: Bogotá a San Andrés' })
  })

  it('⚠️ CONSERVA el ordinal: si no, la siguiente ranura se llamaría 2 otra vez', () => {
    const r = renombreDeRanura('vuelo 2', 'San Andrés a Providencia', ['vuelo', 'vuelo 2'])
    expect(r).toEqual({ ok: true, grupo: 'vuelo 2: San Andrés a Providencia' })
  })

  it('renombrar una ya nombrada reemplaza el nombre, no lo encadena', () => {
    const r = renombreDeRanura('vuelo 2: San Andrés a Providencia', 'A Providencia', [
      'vuelo',
      'vuelo 2: San Andrés a Providencia',
    ])
    expect(r).toEqual({ ok: true, grupo: 'vuelo 2: A Providencia' })
  })

  it('un nombre vacío lo devuelve a su forma corta', () => {
    const r = renombreDeRanura('vuelo 2: San Andrés a Providencia', '   ', ['vuelo 2: San Andrés a Providencia'])
    expect(r).toEqual({ ok: true, grupo: 'vuelo 2' })
  })

  it('conservar el ordinal IMPIDE por construcción fundir «Vuelo» con «Vuelo 2»', () => {
    // Le pongo a «vuelo 2» el mismo nombre que tiene «vuelo». No chocan, y está bien:
    // el ordinal las mantiene separadas, así que las dos siguen sumando. Esta prueba
    // existe porque lo primero que se escribió fue el caso contrario — y comprobarlo
    // mostró que el riesgo de fundirlas ya lo cierra el ordinal, no el guard.
    const r = renombreDeRanura('vuelo 2', 'Bogotá a San Andrés', [
      'vuelo: Bogotá a San Andrés',
      'vuelo 2',
    ])
    expect(r).toEqual({ ok: true, grupo: 'vuelo 2: Bogotá a San Andrés' })
  })

  it('⚠️⚠️ RECHAZA el choque que SÍ es alcanzable: dos ranuras con el mismo ordinal', () => {
    // Se llega escribiendo «vuelo 2» a mano en el campo de grupo propio mientras ya
    // existe «vuelo 2: San Andrés a Providencia». Quitarle el nombre a la segunda la
    // dejaría escrita igual que la primera: las dos columnas se vuelven una, sus líneas
    // pasan a COMPETIR y el precio baja sin que nada falle.
    const r = renombreDeRanura('vuelo 2: San Andrés a Providencia', '', [
      'vuelo 2',
      'vuelo 2: San Andrés a Providencia',
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('choca')
    expect(r.detalle).toContain('Se fundirían en una')
  })

  it('el choque se detecta SIN tildes: «Bogota» y «Bogotá» son la misma ranura', () => {
    // Comparar el texto crudo dejaría pasar las dos y se fundirían igual al releer el
    // grupo, porque el catálogo resuelve normalizando.
    const r = renombreDeRanura('vuelo', 'Bogota a San Andres', [
      'vuelo',
      'vuelo: Bogotá a San Andrés',
    ])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('choca')
  })

  it('renombrarse a lo que ya se llama NO es un choque consigo misma', () => {
    const r = renombreDeRanura('vuelo: Bogotá a San Andrés', 'Bogotá a San Andrés', [
      'vuelo: Bogotá a San Andrés',
    ])
    expect(r).toEqual({ ok: true, grupo: 'vuelo: Bogotá a San Andrés' })
  })

  it('un grupo propio no se renombra por aquí', () => {
    // «dia-1» y «seguro» no son ranuras del catálogo: su nombre ES el grupo y se edita
    // en el selector de la línea. Dejarlo pasar escribiría un grupo que nadie resuelve.
    const r = renombreDeRanura('dia-1', 'Primer día', ['dia-1'])
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.motivo).toBe('no_es_ranura')
  })

  it('una ranura de OTRO tipo no estorba: hotel y vuelo pueden llamarse igual', () => {
    const r = renombreDeRanura('vuelo', 'Cancún', ['vuelo', 'hotel: Cancún'])
    expect(r).toEqual({ ok: true, grupo: 'vuelo: Cancún' })
  })
})
