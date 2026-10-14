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
    for (const s of ['Lo que van a vivir', 'Itinerario día a día', 'Dónde duermen', 'Vuelos', 'Trenes y traslados', 'Planes para los días libres', 'Elijan su versión', 'Qué incluye y cuándo se paga', 'Términos y condiciones']) {
      expect(t).toContain(s)
    }
    // 14 días de viaje, una tarjeta por día.
    expect((h.match(/<div class="day">/g) ?? []).length).toBe(14)
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
