/**
 * La plantilla HTML de la propuesta de Trappvel, sin navegador: lo que el HTML dice y lo que NO
 * puede decir (decisiones de Mauricio del 2026-10-14).
 */
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA, PRECIO_E, PRECIO_P, PRECIO_R, PROPS_EUROPA } from '../../../../../test/propuesta-europa'
import { modeloDePropuesta, type EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { esc, htmlDePropuesta, pesos, pieDeHoja, type RecursosPropuesta } from './plantilla'

const RECURSOS: RecursosPropuesta = {
  foto: (url) => (url ? { src: `data:image/jpeg;base64,FOTO`, foco: null } : null),
  fotoDeCiudad: () => null,
  logo: null,
  marca: 'Agencia de ejemplo',
}

const html = (e: EntradaModeloPropuesta = ENTRADA_EUROPA) => htmlDePropuesta(modeloDePropuesta(e), RECURSOS)
/** Sin etiquetas, para buscar frases como las lee el cliente. */
const texto = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')

describe('htmlDePropuesta · COT-2026-0026 de muestra', () => {
  const h = html()
  const t = texto(h)

  it('las cifras: el precio de cada versión, en el orden del cliente', () => {
    const iE = t.indexOf(pesos(PRECIO_E))
    const iR = t.indexOf(pesos(PRECIO_R))
    const iP = t.indexOf(pesos(PRECIO_P))
    expect(iE).toBeGreaterThan(-1)
    expect(iE).toBeLessThan(iR)
    expect(iR).toBeLessThan(iP)
  })

  it('las secciones del prototipo v5', () => {
    for (const s of ['Lo que van a vivir', 'Así se ve cada día', 'Dónde duermen', 'Vuelos', 'Trenes y traslados', 'Planes para los días libres', 'Elijan su versión', 'Qué incluye y cuándo se paga', 'Términos y condiciones']) {
      expect(t).toContain(s)
    }
    // 14 días de viaje, una tarjeta por día.
    expect((h.match(/<div class="day">/g) ?? []).length).toBe(14)
  })

  it('saltos: la tabla de vuelos fluye detrás de los hoteles; solo cada tramo no se parte', () => {
    const vuelos = h.slice(h.indexOf('>Vuelos<'), h.indexOf('</section>', h.indexOf('>Vuelos<')))
    // La tabla entera con «nobr» saltaba de hoja y dejaba 3/4 de página en blanco.
    expect(vuelos).not.toMatch(/<table class="nobr"/)
    expect(vuelos).toContain('<thead>')
    // Ida y regreso: dos bloques que no se parten.
    expect((vuelos.match(/<tbody class="nobr">/g) ?? []).length).toBe(2)
    const trenes = h.slice(h.indexOf('>Trenes y traslados<'))
    expect(trenes.slice(0, trenes.indexOf('</table>'))).not.toMatch(/<table class="nobr"/)
  })

  it('léxico: «Premium» se le dice «Superior» al cliente', () => {
    expect(t).toContain('Superior')
    expect(t).not.toMatch(/premium/i)
  })

  it('decisión 2: ninguna política de cancelación, aunque el hotel y el opcional la traigan', () => {
    expect(PROPS_EUROPA.viaje!.hoteles.some((x) => x.cancelacion)).toBe(true)
    expect(t).not.toMatch(/cancelaci[oó]n/i)
    expect(t).not.toMatch(/no reembolsable/i)
  })

  it('decisión 3: el anticipo asignado y el botón al WhatsApp de la asesora, sin porcentaje fijo', () => {
    expect(t).toContain(`Apártenlo con ${pesos(5_421_000)}.`)
    expect(t).toContain('Con esto les bloqueamos los hoteles')
    expect(h).toContain('https://wa.me/573000000000?text=')
    expect(t).not.toMatch(/10\s?%/)
    expect(h).not.toMatch(/bold\.co|checkout|link de pago/i)
  })

  it('los trenes van aparte de los traslados', () => {
    const tabla = h.slice(h.indexOf('Trenes y traslados'))
    expect((tabla.match(/<b>[^<]*(AVE|TGV|Eurostar)[^<]*<\/b>/g) ?? []).length).toBe(3)
  })

  it('el texto revisado del cliente sale; los datos de la agencia son los del pie', () => {
    expect(t).toContain('Europa en familia: Madrid, Barcelona, París y Ámsterdam')
    expect(t).toContain('Antes de viajar')
    expect(pieDeHoja({ texto: 'www.agencia.example', codigo: 'COT-2026-0026' })).toContain('COT-2026-0026 · <span class="pageNumber"></span> de <span class="totalPages"></span>')
  })
})

describe('decisión 3 sin anticipo', () => {
  it('no imprime ninguna cifra para apartar: solo el llamado y el WhatsApp', () => {
    const h = html({ ...ENTRADA_EUROPA, anticipo: null })
    const t = texto(h)
    expect(t).not.toContain('Apártenlo con')
    expect(t).toContain('¿Les gusta? Escríbannos y se lo apartamos.')
    const cta = h.slice(h.indexOf('<div class="cta'), h.indexOf('</section>', h.indexOf('<div class="cta')))
    expect(cta).not.toMatch(/\$\s?\d/)
    expect(cta).toContain('wa.me/573000000000')
  })

  it('sin WhatsApp de la asesora no hay botón (nunca un enlace a un número inventado)', () => {
    const h = html({ ...ENTRADA_EUROPA, anticipo: null, asesora: { nombre: 'Asesora', whatsapp: null } })
    expect(h).not.toContain('wa.me')
    expect(h).toContain('class="cta solo"')
  })
})

describe('decisión 1: nombres de los viajeros', () => {
  const viajeros = [
    { nombre: 'Laura Ocampo', menor: false },
    { nombre: 'Juan Camilo', menor: false },
    { nombre: 'Martín', menor: true },
  ]
  it('sin la autorización de menores, el niño no se nombra', () => {
    const t = texto(html({ ...ENTRADA_EUROPA, viajeros, menoresAutorizados: false }))
    expect(t).toContain('Laura y Juan')
    expect(t).not.toContain('Martín')
  })
  it('con la autorización de menores, sí', () => {
    expect(texto(html({ ...ENTRADA_EUROPA, viajeros, menoresAutorizados: true }))).toContain('Laura, Juan y Martín')
  })
})

describe('una sola manera de hacer el viaje (sin tarifas)', () => {
  it('«Precio del viaje» con el total y sin etiquetas de versión', () => {
    const props = { ...PROPS_EUROPA, itinerarios: null }
    const h = html({ ...ENTRADA_EUROPA, props })
    const t = texto(h)
    expect(t).toContain('Precio del viaje')
    expect(t).toContain(pesos(PRECIO_R))
    expect(t).not.toContain('Elijan su versión')
  })
})

describe('escape', () => {
  it('lo que viene de los datos no se vuelve HTML', () => {
    expect(esc('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    const hoteles = PROPS_EUROPA.viaje!.hoteles.map((x, i) => (i === 0 ? { ...x, hotel: '<script>alert(1)</script>' } : x))
    const h = html({ ...ENTRADA_EUROPA, props: { ...PROPS_EUROPA, viaje: { ...PROPS_EUROPA.viaje!, hoteles } } })
    expect(h).not.toContain('<script>alert(1)</script>')
    expect(h).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('«Así se ve cada día» como el prototipo v4', () => {
  const h = html()
  const inicio = h.indexOf('class="sec brk dias"')
  const dias = h.slice(inicio, h.indexOf('</section>', inicio))
  /** El bloque de un día, por su número («13»). */
  const dia = (n: number) => {
    const i = dias.indexOf(`<div class="d">${n}<small>`)
    const fin = dias.indexOf('<div class="day">', i + 1)
    return dias.slice(i, fin === -1 ? undefined : fin)
  }

  it('el número del día grande con «jue · dic» debajo, título y ciudad; sin las píldoras del v5', () => {
    expect(dia(10)).toContain('<div class="d">10<small>jue · dic</small></div>')
    expect(texto(dia(10))).toContain('Salida desde Bogotá')
    expect(texto(dia(14))).toContain('En tren a Barcelona Madrid → Barcelona')
    expect(dias).not.toContain('class="pill"')
  })

  it('las cajitas de las tres versiones SOLO el día de un vuelo', () => {
    const conCajas = [...dias.matchAll(/<div class="d">(\d+)<small>/g)]
      .map((x) => Number(x[1]))
      .filter((n) => dia(n).includes('class="opt3"'))
    // Sale (10), llega a Madrid (11) y regresa (23). Los hoteles ya no se repiten por día.
    expect(conCajas).toEqual([10, 11, 23])
    expect(texto(dia(10))).toContain('Avianca 19:20, directo')
    expect(texto(dia(10))).toContain('Air France 18:45, vía París')
    expect(texto(dia(11))).toContain('llega 11:15')
    expect(texto(dia(23))).toContain('Iberia 06:25, vía Madrid · llega 15:45')
    expect(texto(dias)).not.toContain('Catalonia Puerta del Sol')
  })

  it('un renglón por hecho, en frase: traslados, trenes e incluidas', () => {
    expect(texto(dia(11))).toContain('al llegar Traslado Aeropuerto Barajas T4 → hotel · privado, van con silla de bebé')
    expect(texto(dia(14))).toContain('Tren AVE 03071 Renfe, Estándar · Madrid Atocha → Barcelona Sants')
    expect(texto(dia(12))).toContain('Museo del Prado con guía en español · 2 h. Incluida.')
  })

  it('el día libre propone los planes de su ciudad', () => {
    expect(texto(dia(13))).toContain('Día libre')
    expect(texto(dia(13))).toContain('Libre para ustedes. Opcional: Palacio Real de Madrid o Tour del Bernabéu (ver «Planes para los días libres»).')
    expect(texto(dia(16))).toContain('Opcional: Park Güell con guía o Aquàrium de Barcelona')
  })

  it('separador fino entre días y un día que no se parte', () => {
    expect(h).toMatch(/\.dias \.day \{[^}]*border-bottom: 1px solid var\(--line\)/)
    expect(h).toMatch(/\.day \{[^}]*break-inside: avoid/)
  })

  it('los ganchos del texto generado: título y sugerencia, si llegan', () => {
    const m = modeloDePropuesta(ENTRADA_EUROPA)
    m.dias[2] = { ...m.dias[2], titulo: 'Arte para toda la familia', sugerencia: 'Parque del Retiro y el Palacio de Cristal.' }
    const t = texto(htmlDePropuesta(m, RECURSOS))
    expect(t).toContain('Arte para toda la familia Madrid')
    expect(t).toContain('Sugerencia: Parque del Retiro y el Palacio de Cristal.')
  })
})
