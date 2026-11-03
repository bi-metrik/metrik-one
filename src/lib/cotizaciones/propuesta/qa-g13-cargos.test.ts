/**
 * QA Trappvel de punta a punta (2026-10-29), ronda 3, grupo G13: lo que llega al cliente sobre lo
 * que se paga allá. Cada caso es un código de `hallazgos.md` de
 * `proyectos/trappvel/clarity/qa/2026-10-29_punta-a-punta-10-viajes/`.
 *
 * | Hallazgo | Caso                                                                   |
 * |----------|------------------------------------------------------------------------|
 * | V-17     | destination fee por noche: se llama por su nombre y dice el total       |
 * | V-17     | por persona y por persona y noche: el total con los huéspedes           |
 * | V-17     | la tarjeta de la opción dice la unidad                                  |
 * | V-13     | el ingreso al PNN Tayrona se lee y sale «Se paga en destino»            |
 */
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA } from '../../../../test/propuesta-europa'
import { cargoParaElCliente, modeloDePropuesta } from './modelo-documento'
import { htmlDePropuesta } from '@/lib/pdf/html/trappvel/plantilla'
import { cargosEnDestinoDeItems, pagosEnDestinoDeItems, textoUnidadDelCargo } from '@/lib/cotizaciones/detalle-viaje'
import { ranuraDeGrupo } from '@/lib/cotizaciones/ranuras-pantallazo'

const recursos = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de ejemplo' }

const hotel = (campos: { label: string; valor: string }[]) => ({
  nombre: 'WESTIN TIMES SQUARE',
  grupo: 'hotel: Hotel en Nueva York',
  tarifa_pax: {
    composicion: { adultos: 2, ninos: 0, infantes: 0 },
    casillas: {
      grupo_completo: {
        moneda: 'USD',
        total: 2395,
        campos: [
          { label: 'Hotel', valor: 'The Westin New York at Times Square' },
          { label: 'Ciudad', valor: 'Nueva York' },
          { label: 'Check-in', valor: '2027-05-06' },
          { label: 'Check-out', valor: '2027-05-11' },
          { label: 'Impuestos en destino', valor: '35' },
          { label: 'Moneda de los impuestos en destino', valor: 'USD' },
          ...campos,
        ],
      },
    },
  },
})

describe('V-17 · el cargo del hotel dice qué es, su unidad y el total', () => {
  it('destination fee por noche: «Destination fee (cargo del hotel)», 35 USD por noche y 175 USD por 5 noches', () => {
    const [c] = cargosEnDestinoDeItems([hotel([
      { label: 'Concepto del cargo en destino', valor: 'Destination fee' },
      { label: 'El cargo en destino es', valor: 'por_noche' },
    ])])
    expect(cargoParaElCliente(c)).toEqual({
      concepto: 'Destination fee (cargo del hotel)',
      monto: '35 USD por noche (175 USD por 5 noches)',
    })
  })

  it('por persona: el total con los huéspedes de la captura', () => {
    const [c] = cargosEnDestinoDeItems([hotel([
      { label: 'Concepto del cargo en destino', valor: 'Tasa turística' },
      { label: 'El cargo en destino es', valor: 'por_persona' },
      { label: 'Adultos en la captura', valor: '2' },
      { label: 'Niños en la captura', valor: '1' },
    ])])
    expect(cargoParaElCliente(c)).toEqual({ concepto: 'Tasa turística', monto: '35 USD por persona (105 USD por 3 personas)' })
  })

  it('por persona y por noche: huéspedes × noches; sin los huéspedes, solo la cifra por unidad', () => {
    const [c] = cargosEnDestinoDeItems([hotel([
      { label: 'Concepto del cargo en destino', valor: 'City tax' },
      { label: 'El cargo en destino es', valor: 'por_persona_noche' },
      { label: 'Adultos en la captura', valor: '2' },
    ])])
    expect(cargoParaElCliente(c).monto).toBe('35 USD por persona por noche (350 USD por 2 personas y 5 noches)')
    const [sin] = cargosEnDestinoDeItems([hotel([{ label: 'El cargo en destino es', valor: 'por_persona_noche' }])])
    expect(cargoParaElCliente(sin).monto).toBe('35 USD por persona por noche')
  })

  it('la lectura pide las cuatro unidades', () => {
    const def = ranuraDeGrupo('hotel: Hotel en Nueva York')!
    expect(def.campos.find((c) => c.slug === 'impuestos_destino_base')?.opciones).toEqual(['total', 'por_noche', 'por_persona', 'por_persona_noche'])
  })

  it('la tarjeta de la opción dice la unidad junto a la cifra', () => {
    expect(textoUnidadDelCargo(hotel([{ label: 'El cargo en destino es', valor: 'por_noche' }]))).toBe(' por noche')
    expect(textoUnidadDelCargo(hotel([]))).toBe('')
  })
})

describe('V-13 · lo que se paga en destino y no es del hotel', () => {
  const ecohabs = {
    nombre: 'ECOHABS TAYRONA',
    grupo: 'hotel: Hotel en Parque Tayrona',
    tarifa_pax: {
      composicion: { adultos: 4, ninos: 0, infantes: 0 },
      casillas: {
        grupo_completo: {
          moneda: 'COP',
          total: 8960000,
          campos: [
            { label: 'Hotel', valor: 'Ecohabs Tayrona' },
            { label: 'Otro pago en destino', valor: 'Ingreso al PNN Tayrona, en taquilla, por persona.' },
          ],
        },
      },
    },
  }

  it('la lectura del hotel y de la actividad lo piden', () => {
    expect(ranuraDeGrupo('hotel: Hotel')!.campos.some((c) => c.slug === 'pago_destino_otro')).toBe(true)
    expect(ranuraDeGrupo('actividad: Caminata')!.campos.some((c) => c.slug === 'pago_destino_otro')).toBe(true)
  })

  it('se deriva de la lectura, sin monto inventado', () => {
    expect(pagosEnDestinoDeItems([ecohabs])).toEqual([{ texto: 'Ingreso al PNN Tayrona, en taquilla, por persona' }])
    expect(cargosEnDestinoDeItems([ecohabs])).toEqual([])
  })

  it('el documento lo dice en «No incluido» como «Se paga en destino»', () => {
    const v = ENTRADA_EUROPA.props.viaje!
    const m = modeloDePropuesta({
      ...ENTRADA_EUROPA,
      props: { ...ENTRADA_EUROPA.props, viaje: { ...v, pagosEnDestino: pagosEnDestinoDeItems([ecohabs]) } },
    })
    expect(m.precio.noIncluye).toContain('Se paga en destino: ingreso al PNN Tayrona, en taquilla, por persona')
    expect(htmlDePropuesta(m, recursos)).toContain('Se paga en destino: ingreso al PNN Tayrona, en taquilla, por persona')
  })
})
