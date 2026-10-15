/**
 * La simbología de aerolíneas en la propuesta HTML (brief del 2026-10-08, #1082; una pastilla por
 * tramo, #1147). Pedido de Mauricio del 2026-10-14 al ver la tabla «Vuelos» del PDF nuevo: «No
 * veo los colores de las aerolíneas». Va en todo lugar donde aparece un vuelo.
 */
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA, PROPS_EUROPA, VUELOS_EUROPA } from '../../../../../test/propuesta-europa'
import { AEROLINEAS, COLOR_SIN_IDENTIFICAR } from '@/lib/cotizaciones/aerolineas'
import { modeloDePropuesta, type EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { nombreDeAerolinea, pastillaAerolinea, pastillasDeVuelo } from './aerolinea'
import { htmlDePropuesta, type RecursosPropuesta } from './plantilla'

const RECURSOS: RecursosPropuesta = { foto: () => null, fotoDeCiudad: () => null, logo: null, marca: 'Agencia de ejemplo' }
const html = (e: EntradaModeloPropuesta = ENTRADA_EUROPA) => htmlDePropuesta(modeloDePropuesta(e), RECURSOS)
const seccion = (h: string, titulo: string) => {
  const i = h.indexOf(titulo)
  return h.slice(i, h.indexOf('</section>', i))
}
const siglas = (h: string) => [...h.matchAll(/data-aerolinea="([A-Z0-9]+)"/g)].map((x) => x[1])
const color = (sigla: string) => AEROLINEAS.find((a) => a.iata.includes(sigla))!

describe('la pastilla', () => {
  it('la sigla tal como viene, con el color de la aerolínea dueña del código y su franja', () => {
    const j6 = pastillaAerolinea('J6')
    expect(j6).toContain('>J6<')
    expect(j6).toContain(`background:linear-gradient(to top,${color('J6').franja} 0 .55mm,${color('J6').fondo} .55mm)`)
    expect(j6).toContain('color:#FFFFFF')
  })

  it('sin franja, color plano; Spirit con texto negro; sigla desconocida en gris', () => {
    expect(pastillaAerolinea('AV')).toContain('background:#FF0000;')
    expect(pastillaAerolinea('NK')).toContain('color:#000000')
    expect(pastillaAerolinea('XQ')).toContain(`background:${COLOR_SIN_IDENTIFICAR.fondo};`)
  })

  it('una por tramo; sin sigla, ninguna (dos letras inventadas se leerían como un código real)', () => {
    expect(siglas(pastillasDeVuelo('Iberia', 'IB6586 · LA4521'))).toEqual(['IB', 'LA'])
    expect(siglas(pastillasDeVuelo('Avianca', 'AV26 · AV9779'))).toEqual(['AV'])
    expect(pastillasDeVuelo('Aerolínea rara', null)).toBe('')
  })

  it('el nombre es el de la línea, salvo que el número diga que vuela otra (#1147)', () => {
    expect(nombreDeAerolinea('Iberia', 'IB3251')).toBe('Iberia')
    expect(nombreDeAerolinea('Iberia', 'LA4521')).toBe('LATAM')
    expect(nombreDeAerolinea('LATAM', '4C1234')).toBe('LATAM')
    expect(nombreDeAerolinea(null, 'AV26')).toBe('Avianca')
    expect(nombreDeAerolinea('Charter Andino', 'XQ12')).toBe('Charter Andino')
  })

  it('redonda y más chica que la etiqueta de versión, que sigue igual', () => {
    const h = html()
    const al = /\.al \{[^}]*\}/.exec(h)![0]
    expect(al).toContain('font: 700 6pt')
    expect(al).toMatch(/border-radius: 1\.8mm/)
    expect(h).toMatch(/\.tag \{[^}]*font: 700 6\.8pt/)
  })
})

describe('COT-2026-0026: la pastilla en cada lugar donde aparece un vuelo', () => {
  const h = html()

  it('tabla «Vuelos»: cada vuelo con la suya, al lado del nombre; las etiquetas de versión siguen', () => {
    const v = seccion(h, '>Vuelos<')
    expect(siglas(v)).toEqual(['AV', 'AF', 'IB', 'IB', 'LH', 'KL'])
    expect(v).toContain('data-aerolinea="AF" style="background:linear-gradient(to top,#FF0000 0 .55mm,#051040 .55mm)')
    expect(v).toMatch(/data-aerolinea="AV"[^>]*>AV<\/span><span class="fl">Avianca AV26<\/span>/)
    expect(v).toContain('<span class="tag tE">Económica</span>')
    expect(v).toContain('<span class="tag tR">Recomendada</span>')
  })

  it('las cajitas del día a día: la aerolínea de cada versión', () => {
    const d = seccion(h, 'class="sec dias"')
    const sale = d.slice(d.indexOf('<div class="d">10<small>'), d.indexOf('<div class="d">11<small>'))
    expect(siglas(sale)).toEqual(['AV', 'AF', 'IB'])
    expect(sale).toMatch(/>AV<\/span>Avianca 19:20, directo/)
    // El día que llegan solo dice la hora: sin aerolínea, sin pastilla.
    const llega = d.slice(d.indexOf('<div class="d">11<small>'), d.indexOf('<div class="d">12<small>'))
    expect(siglas(llega)).toEqual([])
  })

  it('las tarjetas de «Elijan su versión»: ida y regreso de cada una', () => {
    const tarjetas = seccion(h, '>Elijan su versión<').split('<div class="tf').slice(1)
    expect(tarjetas.map(siglas)).toEqual([['AV', 'IB'], ['AF', 'LH'], ['IB', 'KL']])
  })

  it('la ruta de un vistazo no nombra aerolínea: no lleva pastilla', () => {
    const ruta = h.slice(h.indexOf('<div class="route">'), h.indexOf('</div>\n', h.indexOf('<div class="route">')))
    expect(siglas(ruta)).toEqual([])
  })

  it('un vuelo con escala en otra aerolínea: una pastilla por tramo en la tabla, la caja y la tarjeta', () => {
    const vuelos = VUELOS_EUROPA.map((v) => (v.numeroVuelo === 'AF423' ? { ...v, numeroVuelo: 'AF423 · KL1704' } : v))
    const h2 = html({ ...ENTRADA_EUROPA, props: { ...PROPS_EUROPA, viaje: { ...PROPS_EUROPA.viaje!, vuelos } } })
    expect(siglas(seccion(h2, '>Vuelos<'))).toEqual(['AV', 'AF', 'KL', 'IB', 'IB', 'LH', 'KL'])
    const d = seccion(h2, 'class="sec dias"')
    expect(siglas(d.slice(d.indexOf('<div class="d">10<small>'), d.indexOf('<div class="d">11<small>')))).toEqual(['AV', 'AF', 'KL', 'IB'])
    const recomendada = seccion(h2, '>Elijan su versión<').split('<div class="tf').slice(1)[1]
    expect(siglas(recomendada)).toEqual(['AF', 'KL', 'LH'])
  })
})
