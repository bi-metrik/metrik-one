import { describe, expect, it } from 'vitest'
import {
  cumpleCondicion,
  soloSiCumple,
  textoValorCondicion,
  valorCumpleCondicion,
  type CondicionBloque,
  type FuentesCondicion,
} from './condicion-bloque'

// La rama de IVA de SOENA VE, tal como queda tras retirar el interruptor
// `requiere_devolucion_iva`: se decide directo con lo que contrató el cliente.
const RAMA_IVA: CondicionBloque = {
  field: 'servicio',
  value_in: ['completo', 'solo_iva'],
  source_bloque_slug: 'servicio_contratado',
  source_etapa_orden: 4,
}

const conServicio = (servicio: unknown): FuentesCondicion => ({
  porSlug: servicio === undefined ? {} : { servicio_contratado: { servicio } },
  porEtapaOrden: {},
})

describe('valorCumpleCondicion', () => {
  it('value compara exacto', () => {
    expect(valorCumpleCondicion('true', { value: 'true' })).toBe(true)
    expect(valorCumpleCondicion(true, { value: 'true' })).toBe(true)
    expect(valorCumpleCondicion('True', { value: 'true' })).toBe(false)
  })

  it('value_in compara normalizado contra cualquiera de la lista', () => {
    expect(valorCumpleCondicion('solo_iva', { value_in: ['completo', 'solo_iva'] })).toBe(true)
    expect(valorCumpleCondicion(' Completo ', { value_in: ['completo', 'solo_iva'] })).toBe(true)
    expect(valorCumpleCondicion('solo_upme', { value_in: ['completo', 'solo_iva'] })).toBe(false)
  })

  it('el vacío no está en ninguna lista', () => {
    expect(valorCumpleCondicion(undefined, { value_in: ['completo', 'solo_iva'] })).toBe(false)
    expect(valorCumpleCondicion(null, { value_in: ['completo', 'solo_iva'] })).toBe(false)
    expect(valorCumpleCondicion('', { value_in: ['completo', 'solo_iva'] })).toBe(false)
  })
})

describe('cumpleCondicion — rama de IVA por servicio contratado', () => {
  it('aplica a completo y a solo_iva', () => {
    expect(cumpleCondicion(RAMA_IVA, conServicio('completo'))).toBe(true)
    expect(cumpleCondicion(RAMA_IVA, conServicio('solo_iva'))).toBe(true)
  })

  it('no aplica a solo_upme ni a un servicio sin responder', () => {
    expect(cumpleCondicion(RAMA_IVA, conServicio('solo_upme'))).toBe(false)
    expect(cumpleCondicion(RAMA_IVA, conServicio(undefined))).toBe(false)
  })
})

describe('soloSiCumple — guardia de la siembra de cita DIAN', () => {
  const guardia = { bloque_slug: 'servicio_contratado', field: 'servicio', value_in: ['completo', 'solo_iva'] }

  // ⚠️ El defecto que cierra: la siembra comparaba solo `value`. Con `value_in` daba false
  // SIEMPRE, y un false ahí retira la respuesta ya sembrada de "¿requiere cita?".
  it('acepta value_in: completo y solo_iva siembran, solo_upme no', () => {
    expect(soloSiCumple(guardia, [{ servicio: 'completo' }])).toBe(true)
    expect(soloSiCumple(guardia, [{ servicio: 'solo_iva' }])).toBe(true)
    expect(soloSiCumple(guardia, [{ servicio: 'solo_upme' }])).toBe(false)
  })

  it('basta una instancia que cumpla', () => {
    expect(soloSiCumple(guardia, [{}, null, { servicio: 'completo' }])).toBe(true)
  })

  it('sin instancias o sin el campo no cumple', () => {
    expect(soloSiCumple(guardia, [])).toBe(false)
    expect(soloSiCumple(guardia, [{}, null])).toBe(false)
  })

  it('la forma de siempre (value exacto) sigue igual', () => {
    const vieja = { bloque_slug: 'devolucion_de_iva', field: 'requiere_devolucion_iva', value: 'true' }
    expect(soloSiCumple(vieja, [{ requiere_devolucion_iva: true }])).toBe(true)
    expect(soloSiCumple(vieja, [{ requiere_devolucion_iva: 'true' }])).toBe(true)
    expect(soloSiCumple(vieja, [{ requiere_devolucion_iva: false }])).toBe(false)
    expect(soloSiCumple(vieja, [{}])).toBe(false)
  })
})

describe('textoValorCondicion', () => {
  it('muestra value, o la lista de value_in', () => {
    expect(textoValorCondicion({ value: 'true' })).toBe('true')
    expect(textoValorCondicion(RAMA_IVA)).toBe('completo o solo_iva')
  })

  it('null cuando no hay valor que mostrar', () => {
    expect(textoValorCondicion(null)).toBeNull()
    expect(textoValorCondicion({})).toBeNull()
    expect(textoValorCondicion({ value_in: [] })).toBeNull()
  })
})
