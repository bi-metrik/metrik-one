import { describe, it, expect } from 'vitest'
import { STATUS_CONTACTO, resolverStatusContacto } from './constants'

/**
 * El 2026-07-31 el juego de status cambió, pero la validación de
 * `updateContactoSegmento` se quedó con los cuatro valores viejos: rechazaba
 * TODOS los nuevos, así que tocar el chip en la lista de contactos no guardaba
 * nada y el defecto vivió tres días sin que nadie lo viera (el detalle seguía
 * guardando por otra vía). Estas pruebas fijan el acuerdo entre el catálogo, el
 * ciclo del chip y el estado con el que nacen los contactos.
 */

// Copia del ciclo del chip en `contactos-list.tsx`. Si allá se agrega un status
// que aquí no esté, la prueba de "todos los del ciclo existen" lo delata.
const CICLO_DEL_CHIP = [
  'primer_contacto', 'segundo_contacto', 'tercer_contacto',
  'conectado', 'no_contesto', 'standby', 'descartado',
]

// Estado con el que nacen los contactos: el default del alta manual
// (`crearContacto`) y el `segmento_inicial` del webhook de Meta.
const ESTADO_DE_NACIMIENTO = 'sin_contactar'

describe('catálogo de status de contacto', () => {
  it('incluye el estado con el que nacen los contactos', () => {
    const valores = STATUS_CONTACTO.map(s => s.value)
    expect(valores).toContain(ESTADO_DE_NACIMIENTO)
  })

  it('acepta todos los status que el ciclo del chip puede producir', () => {
    const valores = STATUS_CONTACTO.map(s => s.value) as readonly string[]
    const huerfanos = CICLO_DEL_CHIP.filter(v => !valores.includes(v))
    expect(huerfanos).toEqual([])
  })

  it('el estado de nacimiento se muestra con su nombre, no en gris como desconocido', () => {
    const { label, chipClass } = resolverStatusContacto(ESTADO_DE_NACIMIENTO)
    expect(label).toBe('Sin contactar')
    expect(chipClass).not.toContain('#6B7280') // el chip de "valor desconocido"
  })

  it('sigue tolerando los valores legacy sin romper la pantalla', () => {
    expect(resolverStatusContacto('convertido').label).toBe('convertido')
    expect(resolverStatusContacto(null).label).toBe('Sin definir')
  })
})
