import { describe, it, expect } from 'vitest'
import { opcionAplica, resolverOpciones, type OpcionCondicional } from './opcion-condicional'

// Caso real (SOENA VE): un vehículo en leasing no tiene proceso de devolución de IVA,
// así que las dos opciones que la incluyen no se le ofrecen.
const SIN_LEASING = {
  source_bloque_slug: 'titularidad',
  field: 'modalidad_solicitante',
  distinto_de: ['leasing'],
  motivo: 'En leasing no hay proceso de devolución de IVA.',
}

const OPCIONES: OpcionCondicional[] = [
  { value: 'completo', label: 'Certificación UPME + devolución de IVA', solo_si: SIN_LEASING },
  { value: 'solo_upme', label: 'Solo certificación UPME' },
  { value: 'solo_iva', label: 'Solo devolución de IVA', solo_si: SIN_LEASING },
]

const desde = (valor: unknown) => () => valor

describe('opcionAplica', () => {
  it('una opción sin restricción se ofrece siempre', () => {
    expect(opcionAplica({ value: 'solo_upme' }, 'leasing')).toBe(true)
  })

  it('con leasing, las opciones con devolución de IVA no se ofrecen', () => {
    expect(opcionAplica(OPCIONES[0], 'leasing')).toBe(false)
    expect(opcionAplica(OPCIONES[2], 'leasing')).toBe(false)
  })

  it('sin leasing sí se ofrecen', () => {
    expect(opcionAplica(OPCIONES[0], 'unico')).toBe(true)
    expect(opcionAplica(OPCIONES[2], 'copropiedad')).toBe(true)
  })

  it('con la fuente SIN responder se ofrecen: no se asume la restricción', () => {
    // Esconderlas mientras no se sabe si es leasing sería adivinar en contra del usuario.
    for (const vacio of [undefined, null, '']) {
      expect(opcionAplica(OPCIONES[0], vacio)).toBe(true)
    }
  })

  it('modo value_in: se ofrece solo dentro de la lista', () => {
    const o: OpcionCondicional = {
      value: 'x',
      solo_si: { source_bloque_slug: 'b', field: 'f', value_in: ['a', 'b'] },
    }
    expect(opcionAplica(o, 'a')).toBe(true)
    expect(opcionAplica(o, 'z')).toBe(false)
  })
})

describe('resolverOpciones', () => {
  it('en leasing solo queda la opción que aplica', () => {
    const r = resolverOpciones(OPCIONES, undefined, desde('leasing'))
    expect(r.visibles.map(o => o.value)).toEqual(['solo_upme'])
    expect(r.seleccionadaYaNoAplica).toBe(false)
  })

  it('sin leasing se ofrecen las tres', () => {
    const r = resolverOpciones(OPCIONES, undefined, desde('unico'))
    expect(r.visibles).toHaveLength(3)
  })

  it('⚠️ la respuesta ya guardada que deja de aplicar NO se esconde: se marca', () => {
    // Es el punto que evita el dato fantasma. Si alguien respondió "completo" y después
    // marcó leasing, esconder la opción dejaría el valor vivo en la base e invisible en
    // pantalla, que es el patrón que ya costó caro (el bloque oculto que seguía decidiendo).
    const r = resolverOpciones(OPCIONES, 'completo', desde('leasing'))
    expect(r.visibles.map(o => o.value)).toContain('completo')
    expect(r.seleccionadaYaNoAplica).toBe(true)
    expect(r.motivo).toContain('leasing')
  })

  it('la marca solo aparece cuando la seleccionada es la que dejó de aplicar', () => {
    const r = resolverOpciones(OPCIONES, 'solo_upme', desde('leasing'))
    expect(r.seleccionadaYaNoAplica).toBe(false)
    expect(r.visibles.map(o => o.value)).toEqual(['solo_upme'])
  })
})
