import { describe, it, expect } from 'vitest'
import {
  categoriaPorPalabras,
  normalizarPropuestaIA,
  proponerPorPalabras,
  CATEGORIA_A_CLASIFICACION,
} from './clasificar-gasto'

describe('categoriaPorPalabras', () => {
  it('reconoce el gasto típico de Omar sin que nadie elija categoría', () => {
    expect(categoriaPorPalabras('Arriendo bodega septiembre')).toBe('arriendo')
    expect(categoriaPorPalabras('Gasolina camioneta')).toBe('transporte')
    expect(categoriaPorPalabras('Tubería y soldadura para el montaje')).toBe('materiales')
  })

  it('ignora tildes y mayúsculas', () => {
    // Mutación que mata: sin `normalize('NFD')` esto no engancha y el gasto cae a
    // "sin señal", que es justo la fricción que se quería quitar.
    expect(categoriaPorPalabras('SUSCRIPCIÓN mensual')).toBe('software')
    expect(categoriaPorPalabras('Alimentación del equipo')).toBe('alimentacion')
  })

  it('la señal más específica gana sobre la genérica', () => {
    // "soldadura" está en materiales, pero un curso de soldadura es capacitación.
    expect(categoriaPorPalabras('Curso de soldadura')).toBe('capacitacion')
  })

  it('devuelve null cuando no hay señal, no "otros"', () => {
    // "otros" y "no sé" no son lo mismo: con null el formulario se queda callado en vez
    // de proponer una categoría que no dedujo.
    expect(categoriaPorPalabras('xyz')).toBeNull()
    expect(categoriaPorPalabras('   ')).toBeNull()
  })
})

describe('proponerPorPalabras', () => {
  it('trae la clasificación que le corresponde a la categoría', () => {
    expect(proponerPorPalabras('Arriendo de la bodega')).toEqual({
      categoria: 'arriendo', clasificacion: 'fijo', origen: 'palabras',
    })
    expect(proponerPorPalabras('Flete de material')).toEqual({
      categoria: 'transporte', clasificacion: 'variable', origen: 'palabras',
    })
  })

  it('sin señal no propone nada', () => {
    expect(proponerPorPalabras('pago varios')).toBeNull()
  })
})

describe('normalizarPropuestaIA', () => {
  it('acepta lo que el modelo devuelve bien', () => {
    expect(normalizarPropuestaIA({ categoria: 'software', clasificacion: 'fijo' })).toEqual({
      categoria: 'software', clasificacion: 'fijo', origen: 'ia',
    })
  })

  it('descarta entera una categoría que no existe en el catálogo', () => {
    // Dejarla pasar mete en gastos.categoria un valor que ningún reporte agrupa.
    expect(normalizarPropuestaIA({ categoria: 'combustible', clasificacion: 'variable' })).toBeNull()
    expect(normalizarPropuestaIA({ categoria: '', clasificacion: 'fijo' })).toBeNull()
    expect(normalizarPropuestaIA(null)).toBeNull()
  })

  it('una clasificación inválida cae al default de la categoría, sin perder la categoría', () => {
    const r = normalizarPropuestaIA({ categoria: 'arriendo', clasificacion: 'semifijo' })
    expect(r).toEqual({ categoria: 'arriendo', clasificacion: 'fijo', origen: 'ia' })
    expect(r?.clasificacion).toBe(CATEGORIA_A_CLASIFICACION.arriendo)
  })

  it('respeta no_operativo cuando el modelo lo dice', () => {
    expect(normalizarPropuestaIA({ categoria: 'otros', clasificacion: 'no_operativo' })?.clasificacion)
      .toBe('no_operativo')
  })
})

describe('la señal se busca como palabra, no como subcadena', () => {
  it('"tubería" no es transporte aunque contenga "uber"', () => {
    // El bug que esto cierra: con `includes`, "uber" engancha dentro de "tuberia" y un
    // gasto de material salía clasificado como transporte. Nadie lo reporta, porque la
    // propuesta se ve plausible.
    expect(categoriaPorPalabras('Tubería galvanizada')).toBe('materiales')
  })

  it('sigue reconociendo la palabra suelta', () => {
    expect(categoriaPorPalabras('Uber al aeropuerto')).toBe('transporte')
  })
})
