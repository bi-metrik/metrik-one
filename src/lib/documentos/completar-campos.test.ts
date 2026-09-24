import { describe, expect, it } from 'vitest'
import { completarCampos, faltanCampos } from './completar-campos'

const SLUGS = ['compradores', 'cantidad_compradores']
const EXTRAIDO = {
  compradores: { value: 'A (1); B (2)', confidence: 0.95, manual: false },
  cantidad_compradores: { value: '2', confidence: 0.95, manual: false },
  // La IA devolvió además un campo que NO se pidió: no debe colarse.
  marca: { value: 'OTRA', confidence: 0.99, manual: false },
}

describe('completarCampos', () => {
  it('agrega solo los campos pedidos y deja intactos los demás', () => {
    const actuales = { marca: { value: 'BMW', confidence: 0.6, manual: true } }
    const r = completarCampos(actuales, EXTRAIDO, SLUGS)
    expect(r.agregados).toEqual(SLUGS)
    expect(r.campos.marca).toEqual({ value: 'BMW', confidence: 0.6, manual: true })
    expect(r.campos.compradores.value).toBe('A (1); B (2)')
  })

  it('no pisa un campo que ya existe, ni corregido a mano ni vacío de un intento anterior', () => {
    const actuales = {
      compradores: { value: 'CORREGIDO (9)', confidence: 0.5, manual: true, edicion: { editado_por_id: 'x', editado_por_nombre: 'D', editado_en: 't' } },
      cantidad_compradores: { value: null, confidence: 0, manual: true },
    }
    const r = completarCampos(actuales, EXTRAIDO, SLUGS)
    expect(r.agregados).toEqual([])
    expect(r.campos).toEqual(actuales)
  })

  it('lo que la IA no pudo leer queda como vacío manual, para llenarlo en pantalla', () => {
    const r = completarCampos({}, { compradores: EXTRAIDO.compradores }, SLUGS)
    expect(r.campos.cantidad_compradores).toEqual({ value: null, confidence: 0, manual: true })
  })
})

describe('faltanCampos', () => {
  it('distingue el bloque que nunca se intentó del que ya se completó', () => {
    expect(faltanCampos({ marca: EXTRAIDO.marca }, SLUGS)).toBe(true)
    expect(faltanCampos(null, SLUGS)).toBe(true)
    expect(faltanCampos({ compradores: EXTRAIDO.compradores, cantidad_compradores: EXTRAIDO.cantidad_compradores }, SLUGS)).toBe(false)
  })
})
