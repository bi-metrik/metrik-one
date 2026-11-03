/**
 * La plantilla HTML de la propuesta de Trappvel, sin navegador: lo que el HTML dice y lo que NO
 * puede decir (decisiones de Mauricio del 2026-10-14), y el formato de Edgar del 2026-10-14
 * adaptado a cotización (decisión del 2026-10-27).
 */
import { describe, expect, it } from 'vitest'
import { ENTRADA_EUROPA, PRECIO_E, PRECIO_P, PRECIO_R, PROPS_EUROPA } from '../../../../../test/propuesta-europa'
import { ENTRADA_CURAZAO, PRECIO_CUR_P, PRECIO_CUR_R, TERMINOS_CURAZAO } from '../../../../../test/propuesta-curazao'
import { modeloDePropuesta, type EntradaModeloPropuesta } from '@/lib/cotizaciones/propuesta/modelo-documento'
import { bloquesDeTerminos, creditoCortoDePortada, esc, fotoDePortada, htmlDePropuesta, ROTULO_IMAGEN_PORTADA, pesos, pieDeHoja, type RecursosPropuesta } from './plantilla'

const RECURSOS: RecursosPropuesta = {
  foto: (url) => (url ? { src: `data:image/jpeg;base64,FOTO`, foco: null } : null),
  fotoDeCiudad: () => null,
  logo: null,
  marca: 'Agencia de ejemplo',
}

const html = (e: EntradaModeloPropuesta = ENTRADA_EUROPA, r: RecursosPropuesta = RECURSOS) => htmlDePropuesta(modeloDePropuesta(e), r)
/** Sin etiquetas, para buscar frases como las lee el cliente. */
const texto = (h: string) => h.replace(/<style>[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ')
/** El HTML de una sección, por su título. */
const seccionDe = (doc: string, titulo: string) => {
  const i = doc.indexOf(`>${titulo}<`)
  return doc.slice(i, doc.indexOf('</section>', i))
}

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

  it('las secciones del formato de Edgar, en su orden, y la hoja de precios al final', () => {
    const orden = ['Vuelos y tren', 'Hospedaje', 'Traslados', 'Itinerario día a día', 'Planes para los días libres', 'Información útil', 'Elijan su versión', 'Cuánto pagan y cuándo', 'Qué incluye y condiciones']
    const posiciones = orden.map((s) => h.indexOf(`>${s}<`))
    expect(posiciones.every((p) => p > -1)).toBe(true)
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones)
    // 14 días de viaje, una tarjeta por día.
    expect((h.match(/<div class="day">/g) ?? []).length).toBe(14)
    // Las del prototipo v5 que el formato de Edgar no tiene ya no salen.
    expect(t).not.toContain('Lo que van a vivir')
    expect(h).not.toContain('class="route"')
  })

  it('carta, Inter y Poppins, los colores de Edgar', () => {
    expect(h).toContain('@page { size: Letter;')
    expect(h).toMatch(/h2 \{ font: 700 15\.7pt\/1\.1 Poppins/)
    expect(h).toContain('--rosa:#e6197a')
    expect(h).toContain('--morado:#7b2fbe')
    expect(h).toContain('--ink:#1f2340')
  })

  it('una cotización no dice lo de un itinerario confirmado', () => {
    expect(t).toContain('Propuesta de viaje · COT-2026-0026')
    expect(t).not.toMatch(/confirmad|localizador|e-ticket|realizado|conf\. hotel/i)
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

  it('los trenes van en «Vuelos y tren», como tarjetas, y no en los traslados', () => {
    const vuelos = seccionDe(h, 'Vuelos y tren')
    expect((vuelos.match(/<span class="bd" style="background:#5a2a82;color:#fff">Tren<\/span>/g) ?? []).length).toBe(3)
    expect(texto(vuelos)).toContain('AVE 03071 Renfe')
    expect(texto(vuelos)).toContain('MADRID ATOCHA')
    expect(seccionDe(h, 'Traslados')).not.toMatch(/AVE|TGV|Eurostar/)
  })

  it('el texto revisado del cliente sale; los datos de la agencia son los del pie', () => {
    expect(t).toContain('Europa en familia: Madrid, Barcelona, París y Ámsterdam')
    expect(t).toContain('Antes de viajar')
    expect(pieDeHoja({ texto: 'www.agencia.example', codigo: 'COT-2026-0026' })).toContain('COT-2026-0026 · <span class="pageNumber"></span> de <span class="totalPages"></span>')
  })
})

describe('portada como la de Edgar', () => {
  it('con imagen aprobada del destino: esa sola, con «Imagen ilustrativa» y su crédito; sin ella, la portada de siempre (regla de fotos del 2026-10-29)', () => {
    const m = modeloDePropuesta(ENTRADA_CURAZAO)
    const r: RecursosPropuesta = {
      ...RECURSOS,
      foto: (url) => (url ? { src: `data:${url.split('/').pop()}`, foco: null } : null),
    }
    // Sin imagen del destino: el collage de siempre (los hoteles de la Recomendada), nunca la banda de colores.
    expect(fotoDePortada(m, r)).toBeNull()
    const sin = htmlDePropuesta(m, r)
    const heroSin = sin.slice(sin.indexOf('<div class="hero'), sin.indexOf('<div class="aviso"'))
    expect(heroSin).toMatch(/^<div class="hero conaviso"><div class="fotos" style="grid-template-columns:repeat\(2,1fr\)">/)
    expect(heroSin).not.toContain(ROTULO_IMAGEN_PORTADA)
    expect(sin).not.toMatch(/hero marca|#e6197a,#8a2cb5 55%,#1ca2b8\); \}\n\.hero/)
    // Con imagen del destino: esa sola, con el rótulo y el crédito corto.
    m.portada.foto = { url: '/banco/curazao.jpg', rotulo: 'CURAZAO', credito: 'Handelskade, Willemstad, Charles Hoffman (Wikimedia Commons, CC BY-SA 2.0)' }
    expect(fotoDePortada(m, r)?.src).toBe('data:curazao.jpg')
    const con = htmlDePropuesta(m, r)
    const heroCon = con.slice(con.indexOf('<div class="hero'), con.indexOf('<div class="aviso"'))
    expect(heroCon).toContain('<div class="hero confoto conaviso"><div class="foto" style="background-image:url(data:curazao.jpg)')
    expect(heroCon).toContain(`<span class="ilustrativa">${ROTULO_IMAGEN_PORTADA}</span><span class="ilustrativa credito">Foto: Charles Hoffman · CC BY-SA 2.0</span>`)
    expect((heroCon.match(/background-image/g) ?? []).length).toBe(1)
    expect(heroCon).not.toContain('class="fotos"')
    // La sombra más oscura del PDF final y el rótulo siempre encima.
    expect(con).toMatch(/\.hero\.confoto::after \{[^}]*rgba\(27,31,59,\.72\) 100%[^}]*rgba\(27,31,59,\.62\) 0%/)
    expect(con).toMatch(/\.hero \.ilustrativa \{[^}]*z-index:2/)
  })

  it('el crédito corto de la portada', () => {
    expect(creditoCortoDePortada('Handelskade, Willemstad, Charles Hoffman (Wikimedia Commons, CC BY-SA 2.0)')).toBe('Foto: Charles Hoffman · CC BY-SA 2.0')
    expect(creditoCortoDePortada('Felviper (Wikimedia Commons, CC BY-SA 4.0)')).toBe('Foto: Felviper · CC BY-SA 4.0')
    expect(creditoCortoDePortada(null)).toBeNull()
  })

  it('sin ninguna foto, la banda queda con el degradado oscuro de siempre (sin collage)', () => {
    const h = html(ENTRADA_CURAZAO, { ...RECURSOS, foto: () => null })
    expect(h).toContain('<div class="hero conaviso"><div class="in">')
    expect(h).not.toContain('class="fotos"')
  })

  it('el aviso lleva el texto revisado; sin él, no hay aviso', () => {
    const h = html(ENTRADA_CURAZAO)
    expect(texto(h)).toContain('Propuesta de viaje para Andrés de la Torre 5 noches en Willemstad con todo incluido.')
    const m = modeloDePropuesta(ENTRADA_CURAZAO)
    m.portada.intro = null
    const sinIntro = htmlDePropuesta(m, RECURSOS)
    expect(sinIntro).not.toContain('class="aviso"')
    expect(sinIntro).toMatch(/<div class="hero(?: confoto)?">/)
  })

  it('las 4 tarjetas rosadas y una ficha por viajero con sus iniciales (los menores sin autorización no salen)', () => {
    const h = html(ENTRADA_CURAZAO)
    expect(h).toContain('<div class="facts" style="grid-template-columns:repeat(4,1fr)">')
    expect(texto(h.slice(h.indexOf('<div class="facts"'), h.indexOf('<div class="viajeros"')))).toBe(
      ' Duración 6 días · 5 noches Destinos Willemstad (5N) Viajeros 2 adultos y 1 niño Cotizada para Andrés de la Torre ',
    )
    expect(h).toContain('<div class="vj"><i>AN</i><b>Ana</b></div>')
    expect(h).toContain('<div class="vj"><i>LU</i><b>Luis</b></div>')
    expect(texto(h)).not.toContain('Tomás')
  })
})

describe('a quién va dirigida (Mauricio, 2026-10-27)', () => {
  const facts = (h: string) => texto(h.slice(h.indexOf('<div class="facts"'), h.indexOf('<div class="viajeros"')))
  const aviso = (h: string) => texto(h.slice(h.indexOf('<div class="aviso"'), h.indexOf('<div class="facts"')))

  it('con contacto: el aviso y la cuarta tarjeta lo nombran con nombre propio, no a los pasajeros', () => {
    const h = html(ENTRADA_CURAZAO)
    expect(aviso(h)).toContain('Propuesta de viaje para Andrés de la Torre')
    expect(aviso(h)).not.toContain('Ana y Luis')
    expect(facts(h)).toContain('Cotizada para Andrés de la Torre')
    expect(facts(h)).not.toContain('Incluye')
    // Persona natural con el mismo nombre: la empresa no se repite.
    expect(texto(h)).not.toMatch(/ANDRÉS|Andrés de la Torre · /)
  })

  it('persona jurídica: el contacto y la empresa, tal como está guardada', () => {
    const h = html({ ...ENTRADA_CURAZAO, cliente: { contacto: 'ana gómez', empresa: 'Viajes XYZ S.A.S.', tipoPersona: 'juridica' } })
    expect(aviso(h)).toContain('Propuesta de viaje para Ana Gómez · Viajes XYZ S.A.S.')
    expect(facts(h)).toContain('Cotizada para Ana Gómez · Viajes XYZ S.A.S.')
  })

  it('sin contacto: el aviso vuelve a los pasajeros y la cuarta tarjeta a «Incluye»', () => {
    const h = html({ ...ENTRADA_CURAZAO, cliente: { contacto: null, empresa: 'Viajes XYZ S.A.S.', tipoPersona: 'juridica' } })
    expect(aviso(h)).toContain('Propuesta de viaje para Ana y Luis')
    expect(facts(h)).toContain('Incluye Vuelos, 5 noches y 2 traslados')
    expect(facts(h)).not.toContain('Cotizada para')
    const sinCliente = html({ ...ENTRADA_CURAZAO, cliente: undefined })
    expect(facts(sinCliente)).toContain('Incluye Vuelos, 5 noches y 2 traslados')
  })
})

describe('COT-2026-0004 de muestra (dos versiones, mismos vuelos)', () => {
  const h = html(ENTRADA_CURAZAO)
  const t = texto(h)

  it('un vuelo una sola vez aunque lo lleven las dos versiones: sin etiqueta, «iguales en todas»', () => {
    const v = seccionDe(h, 'Vuelos')
    expect((v.match(/<div class="vc">/g) ?? []).length).toBe(2)
    expect(v).not.toContain('class="tag')
    expect(texto(v)).toContain('Iguales en todas las versiones.')
    // Origen, hora, fecha, línea, destino y la tarifa a la derecha; el equipaje debajo.
    expect(texto(v)).toContain('Avianca AV92 BOG 07:30 Jue 26 nov Vuelo directo CUR 10:30 Jue 26 nov Tarifa Light Standard economy Artículo personal + equipaje de mano')
  })

  it('el título de «Vuelos» va pegado a la primera tarjeta', () => {
    expect(h).toMatch(/<div class="nobr"><div class="sh">[\s\S]*?>Vuelos<[\s\S]*?<\/div><\/div><\/div>\n<div class="vc">/)
    expect(h).toMatch(/\.vc \{[^}]*break-inside: avoid/)
  })

  it('hospedaje: tarjeta por hotel con su versión, estrellas sobre la foto y la tabla clave/valor sin datos inventados', () => {
    const s = seccionDe(h, 'Hospedaje')
    expect((s.match(/<div class="hc">/g) ?? []).length).toBe(2)
    expect(s).toContain('<span class="tags"><span class="tag tR">Recomendada</span></span><span class="stars">★★★</span>')
    expect(s).toContain('<span class="tag tP">Superior</span>')
    expect(texto(s)).toContain('Kunuku Resort All Inclusive Curacao Willemstad')
    expect(texto(s)).toContain('Estancia 26 nov – 1 dic (5 noches) Habitación Doble, una cama doble, no fumadores Régimen Todo incluido')
    expect(texto(s)).not.toMatch(/Dirección|Teléfono|Localizador/)
    // Dos tarjetas por fila, y la primera fila va con el título.
    expect(h).toContain('<div class="nobr"><div class="sh"><div class="sq"><svg class="ic" viewBox="0 0 24 24"><use href="#bed"/>')
    expect((s.match(/<div class="hg">/g) ?? []).length).toBe(1)
  })

  it('traslados en filas: «fecha · trayecto» y el servicio', () => {
    expect(texto(seccionDe(h, 'Traslados'))).toContain('26 nov · Aeropuerto Hato → hotel Compartido, shuttle estándar')
    expect(texto(seccionDe(h, 'Traslados'))).toContain('1 dic · Hotel → aeropuerto Hato Compartido, shuttle estándar')
  })

  it('el itinerario: píldora de la ciudad pegada a su día, círculo «DÍA n», fecha larga y hora en morado', () => {
    const d = seccionDe(h, 'Itinerario día a día')
    expect((d.match(/class="pill"/g) ?? []).length).toBe(1)
    expect(d).toMatch(/<div class="nobr"><div class="pill"><span>.*?Willemstad<\/span><\/div>\n<div class="day">/)
    expect(d).toContain('<div class="dn"><small>DÍA</small>6</div>')
    expect(texto(d)).toContain('martes 1 de diciembre Regreso a casa')
    expect(texto(d)).toContain('07:30 Vuelo Bogotá (BOG) → Curazao (CUR)')
    expect(texto(d)).toContain('Día libre en Willemstad Libre Día abierto para ustedes.')
  })

  it('los precios siguen a lo anterior: versiones, apartar, cuotas con su total, incluye y términos', () => {
    const i = h.indexOf('<section class="sec precios">')
    expect(i).toBeGreaterThan(-1)
    const p = h.slice(i)
    const tp = texto(p)
    expect(tp).toContain(pesos(PRECIO_CUR_R))
    expect(tp).toContain(pesos(PRECIO_CUR_P))
    expect(tp).toContain('¿Les gusta? Escríbannos y se lo apartamos.')
    // El total va en la misma tabla que las cuotas, dentro de un bloque que no se parte.
    const pagos = p.slice(p.indexOf('>Cuánto pagan y cuándo<'))
    const tabla = pagos.slice(pagos.indexOf('<table'), pagos.indexOf('</table>'))
    expect(texto(tabla)).toMatch(/Al confirmar \(anticipo\).*Total \$ 9\.552\.219 \$ 15\.964\.024/)
    expect(p).toMatch(/<div class="sec nobr"><div class="sh">[\s\S]*?>Cuánto pagan y cuándo</)
    // Incluye y términos en tarjetas de a tres.
    expect(tp).toMatch(/Qué incluye y condiciones Incluido en todas .* Condiciones generales .* Medios de pago/)
    expect(p).toContain('grid-template-columns:repeat(3,1fr)')
  })

  it('nada de lo que la cotización no tiene', () => {
    expect(t).not.toMatch(/confirmad|localizador|e-ticket|realizado/i)
  })
})

describe('términos en tarjetas', () => {
  it('un renglón corto sin punto abre una tarjeta; lo demás son sus puntos', () => {
    expect(bloquesDeTerminos(TERMINOS_CURAZAO)).toEqual([
      { titulo: 'Condiciones generales', puntos: expect.arrayContaining(['Los servicios que no se tomen no son reembolsables.']) },
      { titulo: 'Medios de pago', puntos: expect.arrayContaining(['PSE, tarjeta de crédito o link de pago, con un recargo promedio del 3 %.']) },
    ])
    expect(bloquesDeTerminos(TERMINOS_CURAZAO)[0].puntos).toHaveLength(3)
  })

  it('sin títulos, un solo bloque; vacío, nada', () => {
    expect(bloquesDeTerminos('- Uno.\n- Dos.')).toEqual([{ titulo: null, puntos: ['Uno.', 'Dos.'] }])
    expect(bloquesDeTerminos(null)).toEqual([])
    // Un renglón con cifras no es título («Banco 123»), ni el último renglón.
    expect(bloquesDeTerminos('Cuenta 123\nFin')).toEqual([{ titulo: null, puntos: ['Cuenta 123', 'Fin'] }])
  })
})

describe('decisión 3 sin anticipo', () => {
  it('no imprime ninguna cifra para apartar: solo el llamado y el WhatsApp', () => {
    const h = html({ ...ENTRADA_EUROPA, anticipo: null })
    const t = texto(h)
    expect(t).not.toContain('Apártenlo con')
    expect(t).toContain('¿Les gusta? Escríbannos y se lo apartamos.')
    const i = h.indexOf('<div class="cta')
    const cta = h.slice(i, h.indexOf('<div class="sec nobr">', i))
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

describe('«Itinerario día a día» como el de Edgar', () => {
  const h = html()
  const inicio = h.indexOf('class="sec dias"')
  const dias = h.slice(inicio, h.indexOf('</section>', inicio))
  /** El bloque de un día, por su número («DÍA 4»). */
  const dia = (n: number) => {
    const i = dias.indexOf(`<small>DÍA</small>${n}</div>`)
    const fin = dias.indexOf('<div class="day">', i + 1)
    return dias.slice(i, fin === -1 ? undefined : fin)
  }

  it('sin salto de hoja forzado, y el título pegado al primer día (no queda solo al pie de la hoja)', () => {
    expect(h).not.toContain('class="sec brk dias"')
    const pegado = dias.slice(dias.indexOf('<div class="nobr">'), dias.indexOf('<div class="day">') + 1)
    expect(dias.indexOf('<div class="nobr">')).toBeGreaterThan(-1)
    expect(pegado).toContain('Itinerario día a día')
    expect((dias.match(/<div class="day">/g) ?? []).length).toBe(14)
  })

  it('una píldora por ciudad, cuando cambia, pegada a su día', () => {
    const pildoras = [...dias.matchAll(/<div class="pill"><span><svg[^>]*><use href="#pin"\/><\/svg>([^<]+)<\/span>/g)].map((x) => x[1])
    expect(pildoras).toEqual(['Madrid', 'Barcelona', 'París', 'Ámsterdam'])
    expect((dias.match(/<div class="nobr"><div class="pill">/g) ?? []).length).toBe(4)
  })

  it('círculo «DÍA n», la fecha larga en rosa y el título del día', () => {
    expect(dia(1)).toContain('<div class="df">jueves 10 de diciembre</div>')
    expect(texto(dia(1))).toContain('Salida desde Bogotá')
    expect(texto(dia(5))).toContain('Madrid → Barcelona en tren')
    expect(h).toMatch(/\.day \.dn \{[^}]*border-radius: 50%/)
  })

  it('las versiones en chips SOLO el día de un vuelo', () => {
    const conChips = Array.from({ length: 14 }, (_, i) => i + 1).filter((n) => /class="chip"><span class="c/.test(dia(n)))
    // Sale (1), llega a Madrid (2) y regresa (14). Los hoteles no se repiten por día.
    expect(conChips).toEqual([1, 2, 14])
    expect(texto(dia(1))).toContain('Avianca 19:20, directo')
    expect(texto(dia(1))).toContain('Air France 18:45, vía París')
    expect(texto(dia(2))).toContain('llega 11:15')
    expect(texto(dia(14))).toContain('Iberia 06:25, vía Madrid · llega 15:45')
    expect(texto(dias)).not.toContain('Catalonia Puerta del Sol')
  })

  it('un renglón por hecho: la hora o la palabra del hecho a la izquierda, el texto en frase', () => {
    expect(texto(dia(2))).toContain('Al llegar Traslado Aeropuerto Barajas T4 → hotel · privado, van con silla de bebé')
    expect(texto(dia(5))).toContain('Tren AVE 03071 Renfe, Estándar · Madrid Atocha → Barcelona Sants')
    expect(texto(dia(3))).toContain('Incluida Museo del Prado con guía en español · 2 h.')
  })

  it('el día libre propone los planes de su ciudad en un chip', () => {
    expect(texto(dia(4))).toContain('Día libre en Madrid')
    expect(texto(dia(4))).toContain('Libre Día abierto para ustedes. Opcional: Palacio Real de Madrid o Tour del Bernabéu (ver «Planes para los días libres»)')
    expect(texto(dia(7))).toContain('Opcional: Park Güell con guía o Aquàrium de Barcelona')
  })

  it('la foto del día: la de la actividad incluida; si no, la de la ciudad el primer día allí', () => {
    const r: RecursosPropuesta = {
      ...RECURSOS,
      fotoDeCiudad: (c) => (c === 'Madrid' ? { src: 'data:madrid', foco: null } : null),
      fotoDeActividad: (n) => (n.startsWith('Sagrada Familia') ? { src: 'data:sagrada', foco: null } : null),
    }
    const h2 = html(ENTRADA_EUROPA, r)
    const d2 = h2.slice(h2.indexOf('class="sec dias"'))
    expect((d2.match(/class="ph" style="background-image:url\(data:madrid\)/g) ?? []).length).toBe(1)
    expect((d2.match(/class="ph" style="background-image:url\(data:sagrada\)/g) ?? []).length).toBe(1)
    expect((d2.match(/class="cuerpo foto"/g) ?? []).length).toBe(2)
  })

  it('un día que no se parte', () => {
    expect(h).toMatch(/\.day \{[^}]*break-inside: avoid/)
  })

  it('los ganchos del texto generado: título y sugerencia, si llegan', () => {
    const m = modeloDePropuesta(ENTRADA_EUROPA)
    m.dias[2] = { ...m.dias[2], titulo: 'Arte para toda la familia', sugerencia: 'Parque del Retiro y el Palacio de Cristal.' }
    const t = texto(htmlDePropuesta(m, RECURSOS))
    expect(t).toContain('Arte para toda la familia')
    expect(t).toContain('Idea Parque del Retiro y el Palacio de Cristal.')
  })
})

describe('htmlDePropuesta · saltos de hoja y la etiqueta del plan', () => {
  const h = html()
  const seccion = (titulo: string) => seccionDe(h, titulo)
  const filas = (tbody: string) => (tbody.match(/<tr>/g) ?? []).length

  it('«Traslados»: el título nunca queda al pie con menos de 3 filas, ni una fila sola arriba', () => {
    const tbodies = [...seccion('Traslados').matchAll(/<tbody( class="nobr")?>([\s\S]*?)<\/tbody>/g)]
    expect(tbodies).toHaveLength(3)
    expect(tbodies[0][1]).toBe(' class="nobr"')
    expect(filas(tbodies[0][2])).toBe(3)
    expect(tbodies[1][1]).toBeUndefined()
    expect(tbodies[2][1]).toBe(' class="nobr"')
    expect(filas(tbodies[2][2])).toBe(2)
    // El encabezado va en el mismo bloque que no se parte con las primeras filas: un `.sh` suelto
    // quedaba solo al pie de la hoja 1 (muestra sin fotos del 2026-10-27).
    expect(h).toMatch(/<div class="nobr"><div class="sh">(?:(?!<\/section>)[\s\S])*?>Traslados<[\s\S]*?<table class="tr fija">[\s\S]*?<\/table><\/div>/)
    expect(h).toMatch(/\.sh \{[^}]*break-after: avoid/)
  })

  it('una tabla corta va en un solo tramo que no se parte', () => {
    const m = modeloDePropuesta(ENTRADA_EUROPA)
    m.trayectos = { ...m.trayectos, filas: m.trayectos.filas.slice(0, 4) }
    const tr = seccionDe(htmlDePropuesta(m, RECURSOS), 'Traslados')
    expect(tr.match(/<tbody class="nobr">/g) ?? []).toHaveLength(1)
    expect(tr).not.toMatch(/<tbody>/)
  })

  it('«Elijan su versión»: ninguna tarjeta se parte y el bloque de las tres va con su título', () => {
    expect(seccion('Elijan su versión')).toContain('<div class="tarifas nobr"')
    expect(h).toMatch(/\.tf \{[^}]*break-inside: avoid/)
    expect(h).toMatch(/\.nobr \{ break-inside: avoid; \}/)
  })

  it('ningún salto de hoja forzado entre secciones (pedido de Edgar del 2026-10-28: menos blanco)', () => {
    for (const doc of [h, html(ENTRADA_CURAZAO)]) {
      expect(doc).not.toMatch(/break-before:\s*page|page-break-before|break-after:\s*page|page-break-after:\s*always/)
      expect(doc).not.toMatch(/class="[^"]*\bbrk\b/)
    }
    expect(h).toContain('<section class="sec precios">')
  })

  it('las secciones grandes no son un bloque entero: se parten por sus tarjetas', () => {
    // Ninguna de estas secciones va entera en `.nobr` (solo el título con su primer bloque).
    for (const titulo of ['Hospedaje', 'Itinerario día a día', 'Planes para los días libres', 'Qué incluye y condiciones']) {
      const antes = h.slice(0, h.indexOf(`>${titulo}<`))
      expect(antes.slice(antes.lastIndexOf('class="sec')), titulo).toMatch(/^class="sec(?: [a-z]+)?"><?\n?<div class="nobr">/)
      expect(antes.slice(antes.lastIndexOf('class="sec')), titulo).not.toMatch(/^class="sec nobr"/)
    }
    // Los 8 planes en dos filas de 4: la primera con el título, la segunda suelta.
    const planes = seccion('Planes para los días libres')
    expect((planes.match(/<div class="opcs">/g) ?? []).length).toBe(2)
    expect(h).toMatch(/<div class="nobr"><div class="sh">(?:(?!<\/section>)[\s\S])*?>Planes para los días libres<[\s\S]*?<div class="opcs">[\s\S]*?<\/div>\n<div class="opcs">/)
    expect(h).toMatch(/\.oc \{[^}]*break-inside: avoid/)
    expect(h).toMatch(/\.card \{[^}]*break-inside: avoid/)
  })

  it('la firma va pegada a la última fila de condiciones (nunca sola arriba de una hoja)', () => {
    // Una sola fila: el título, la fila y la firma en el mismo bloque que no se parte.
    const desde = h.lastIndexOf('<div class="sec"><div class="nobr">', h.indexOf('>Qué incluye y condiciones<'))
    const bloque = h.slice(desde)
    expect(bloque).toMatch(/^<div class="sec"><div class="nobr"><div class="sh">(?:(?!<div class="nobr">)[\s\S])*?<div class="cards"(?:(?!<div class="nobr">)[\s\S])*?<div class="sign">/)
    // Con más de tres bloques, dos filas: la primera con el título y la última con la firma.
    const largo = TERMINOS_CURAZAO + '\nCambios\nCada cambio tiene un costo.\nEquipaje\nSegún la aerolínea.'
    const m = modeloDePropuesta({ ...ENTRADA_CURAZAO, props: { ...ENTRADA_CURAZAO.props, cotizacion: { ...ENTRADA_CURAZAO.props.cotizacion, terminos_condiciones: largo } } })
    const dos = htmlDePropuesta(m, RECURSOS)
    const sec = dos.slice(dos.indexOf('>Qué incluye y condiciones<'))
    expect((sec.match(/<div class="cards"/g) ?? []).length).toBe(2)
    expect(sec).toMatch(/<\/div><div class="nobr"><div class="cards"[\s\S]*?<div class="sign">/)
  })

  it('«Antes de viajar» no queda solo al pie: va con su lista, en la tarjeta de «Información útil»', () => {
    expect(seccion('Información útil')).toMatch(/<div class="card"><span class="caps">Antes de viajar<\/span><ul>/)
    expect(h).toContain('<section class="sec nobr">\n<div class="sh"><div class="sq"><svg class="ic" viewBox="0 0 24 24"><use href="#info"/>')
  })

  it('la foto de cada plan lleva su ciudad y el día en que el día a día lo propone', () => {
    const conFoto = htmlDePropuesta(modeloDePropuesta(ENTRADA_EUROPA), { ...RECURSOS, fotoDeOpcional: () => ({ src: 'data:image/jpeg;base64,FOTO', foco: null }) })
    const planes = seccionDe(conFoto, 'Planes para los días libres')
    expect(planes).toContain('<div class="where">Madrid · dom 13</div></div><div class="b"><div class="n">Palacio Real de Madrid')
    expect(planes).toContain('<div class="where">Barcelona · mié 16</div></div><div class="b"><div class="n">Park Güell con guía')
    expect((planes.match(/class="where"/g) ?? []).length).toBe(8)
  })

  it('sin ninguna foto de plan, la tarjeta va sin imagen y el lugar en el texto', () => {
    const planes = seccion('Planes para los días libres')
    expect(planes).not.toContain('class="where"')
    expect(planes).toContain('<div class="n">Palacio Real de Madrid</div><div class="caps">Madrid · dom 13</div>')
  })
})

describe('QA del #1359 · la versión compacta (solo se imprime si ahorra una hoja)', () => {
  const m = modeloDePropuesta(ENTRADA_CURAZAO)
  const normal = htmlDePropuesta(m, RECURSOS)
  const compacta = htmlDePropuesta(m, RECURSOS, { compacto: true })
  const dias = (h: string) => seccionDe(h, 'Itinerario día a día')

  it('sin la opción, el documento de siempre: un bloque por día', () => {
    expect(htmlDePropuesta(m, RECURSOS, {})).toBe(normal)
    expect(normal).toContain('<body>')
    expect((dias(normal).match(/<div class="day">/g) ?? []).length).toBe(m.dias.length)
    expect(normal).not.toContain('DÍAS</small>')
  })

  it('los días libres seguidos van en un bloque «Días 2–5», con el rango de fechas', () => {
    const d = dias(compacta)
    expect(compacta).toContain('<body class="compacto">')
    expect(d).toContain('<div class="dn rango"><small>DÍAS</small>2–5</div>')
    expect(texto(d)).toContain('viernes 27 al lunes 30 de noviembre Días libres en Willemstad Libres Días abiertos para ustedes.')
    // Los días con algo (la salida y el regreso) siguen solos, igual que en la normal.
    expect(d).toContain('<div class="dn"><small>DÍA</small>1</div>')
    expect(d).toContain('<div class="dn"><small>DÍA</small>6</div>')
    expect((d.match(/<div class="day">/g) ?? []).length).toBe(3)
  })

  it('lo demás dice lo mismo: solo cambian los días libres', () => {
    const sinDias = (h: string) => texto(h.replace(/<section class="sec dias">[\s\S]*?<\/section>/, ''))
    expect(sinDias(compacta)).toBe(sinDias(normal))
  })

  it('un día libre con plan opcional o con foto no se junta', () => {
    const conFoto: RecursosPropuesta = { ...RECURSOS, fotoDeCiudad: () => ({ src: 'data:image/jpeg;base64,CIUDAD', foco: null }) }
    const d = dias(htmlDePropuesta(modeloDePropuesta(ENTRADA_CURAZAO), conFoto, { compacto: true }))
    // La foto de la ciudad va el primer día en ella: ese día sigue solo, y los libres que siguen se juntan.
    expect(d).toContain('<div class="dn"><small>DÍA</small>1</div>')
    expect(d).toContain('<small>DÍAS</small>2–5')
    const europa = modeloDePropuesta(ENTRADA_EUROPA)
    const conPlan = europa.dias.filter((x) => x.opcionales.length > 0).map((x) => x.numero)
    expect(conPlan.length).toBeGreaterThan(0)
    const de = dias(htmlDePropuesta(europa, RECURSOS, { compacto: true }))
    for (const n of conPlan) expect(de).toContain(`<div class="dn"><small>DÍA</small>${n}</div>`)
  })
})
