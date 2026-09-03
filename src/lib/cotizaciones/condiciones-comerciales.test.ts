import { describe, it, expect } from 'vitest'
import {
  MAX_CARACTERES_PALABRA,
  parsearCondicionesComerciales,
  partirPalabraLarga,
  vigenciaEnDias,
} from './condiciones-comerciales'

describe('parsearCondicionesComerciales', () => {
  it('sin texto no devuelve párrafos', () => {
    expect(parsearCondicionesComerciales(null)).toEqual([])
    expect(parsearCondicionesComerciales('')).toEqual([])
    expect(parsearCondicionesComerciales('   \n  ')).toEqual([])
  })

  it('separa rótulo y texto en cada línea', () => {
    const r = parsearCondicionesComerciales(
      'Forma de Pago: 50% anticipo y 50% contra entrega.\nExclusiones: no incluye obra civil.',
    )
    expect(r).toEqual([
      { rotulo: 'Forma de Pago', texto: '50% anticipo y 50% contra entrega.' },
      { rotulo: 'Exclusiones', texto: 'no incluye obra civil.' },
    ])
  })

  it('NO toma por rótulo el primer ":" de una hora dentro de una frase', () => {
    // Sin este corte, "El personal trabaja de 8" saldría en negrita en el PDF
    // que se le manda al cliente.
    const r = parsearCondicionesComerciales('El personal trabaja de 8:00 a 17:00.')
    expect(r).toEqual([{ rotulo: null, texto: 'El personal trabaja de 8:00 a 17:00.' }])
  })

  it('NO toma por rótulo una oración larga con dos puntos al final', () => {
    const r = parsearCondicionesComerciales(
      'Se entiende que el cliente entrega el sitio libre de obstáculos y con energía: esto es condición previa.',
    )
    expect(r[0].rotulo).toBeNull()
  })

  it('un texto sin rótulos sale como un solo párrafo', () => {
    const r = parsearCondicionesComerciales(
      'Esta oferta no incluye impuestos distintos al IVA.',
    )
    expect(r).toEqual([
      { rotulo: null, texto: 'Esta oferta no incluye impuestos distintos al IVA.' },
    ])
  })

  it('las líneas sin rótulo continúan el párrafo abierto', () => {
    const r = parsearCondicionesComerciales(
      'Personal: cuadrilla de dos técnicos\ncon supervisión permanente.',
    )
    expect(r).toEqual([
      { rotulo: 'Personal', texto: 'cuadrilla de dos técnicos con supervisión permanente.' },
    ])
  })

  it('quita viñetas del principio de la línea', () => {
    const r = parsearCondicionesComerciales('· Garantía: 12 meses.\n- Soporte: remoto.')
    expect(r).toEqual([
      { rotulo: 'Garantía', texto: '12 meses.' },
      { rotulo: 'Soporte', texto: 'remoto.' },
    ])
  })

  it('un rótulo solo en su línea conserva el rótulo con texto vacío', () => {
    const r = parsearCondicionesComerciales('Inventario:\nse levanta en la visita inicial.')
    expect(r).toEqual([
      { rotulo: 'Inventario', texto: 'se levanta en la visita inicial.' },
    ])
  })

  it('las líneas en blanco no producen párrafos vacíos', () => {
    const r = parsearCondicionesComerciales('Uno: a.\n\n\nDos: b.\n\n')
    expect(r).toHaveLength(2)
    expect(r.map((p) => p.rotulo)).toEqual(['Uno', 'Dos'])
  })

  it('reproduce los nueve rótulos del formato real de Termotech', () => {
    const texto = [
      'Inventario: se levanta en la visita inicial.',
      'Gestión de Activos: hoja de vida por equipo.',
      'Forma de Pago: mes vencido a 30 días.',
      'Personal: técnicos certificados.',
      'Materiales e Insumos: incluidos los de rutina.',
      'Exclusiones: no incluye repuestos mayores.',
      'Emergencias: atención en menos de 4 horas.',
      'Mantenimiento Correctivo: se cotiza aparte.',
      'Acompañamiento Estratégico: informe mensual.',
    ].join('\n')
    const r = parsearCondicionesComerciales(texto)
    expect(r).toHaveLength(9)
    expect(r.every((p) => p.rotulo !== null && p.texto !== '')).toBe(true)
    expect(r[4].rotulo).toBe('Materiales e Insumos')
  })
})

describe('vigenciaEnDias', () => {
  it('devuelve la diferencia en días entre envío y validez', () => {
    expect(vigenciaEnDias('2026-09-03T04:56:52.802+00:00', '2026-10-02')).toBe(29)
  })

  it('devuelve null si falta cualquiera de las dos fechas', () => {
    expect(vigenciaEnDias(null, '2026-10-02')).toBeNull()
    expect(vigenciaEnDias('2026-09-03', null)).toBeNull()
    expect(vigenciaEnDias(null, null)).toBeNull()
  })

  it('devuelve null ante una fecha ilegible', () => {
    expect(vigenciaEnDias('no-es-fecha', '2026-10-02')).toBeNull()
  })

  it('nunca devuelve cero ni negativo: el piso es un día', () => {
    expect(vigenciaEnDias('2026-10-02', '2026-10-02')).toBe(1)
    expect(vigenciaEnDias('2026-10-02', '2026-09-30')).toBe(1)
  })
})

describe('partirPalabraLarga', () => {
  it('devuelve entera cualquier palabra del español de uso corriente', () => {
    for (const palabra of [
      'URGENCIAS',
      'ADMINISTRACIÓN',
      'MANTENIMIENTO',
      'electroencefalografista',
      'CONTRAPRESTACIONES',
    ]) {
      expect(partirPalabraLarga(palabra)).toEqual([palabra])
    }
  })

  it('parte solo lo que no cabe, y en trozos que sí caben', () => {
    // Medido con el render: sin partir, este código se desborda sobre la columna
    // CANT. y rompe la tabla.
    const codigo = 'SUMINISTROEINSTALACIONDEELECTROBOMBACENTRIFUGAMULTIETAPAVERTICAL'
    const trozos = partirPalabraLarga(codigo)
    expect(trozos.length).toBeGreaterThan(1)
    expect(trozos.every((t) => t.length <= MAX_CARACTERES_PALABRA)).toBe(true)
    expect(trozos.join('')).toBe(codigo)
  })

  it('el límite es inclusivo: justo en el máximo no se parte', () => {
    const justo = 'A'.repeat(MAX_CARACTERES_PALABRA)
    expect(partirPalabraLarga(justo)).toEqual([justo])
    expect(partirPalabraLarga(justo + 'A')).toHaveLength(2)
  })

  it('no pierde ni duplica caracteres', () => {
    const larga = 'X'.repeat(200)
    expect(partirPalabraLarga(larga).join('')).toBe(larga)
  })
})
