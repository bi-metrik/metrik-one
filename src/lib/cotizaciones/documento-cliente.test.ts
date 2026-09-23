/**
 * Las reglas del texto para el cliente (Trappvel): qué ve el modelo, qué ve el cliente y
 * cuándo un texto quedó viejo.
 *
 * Las líneas son las de COT-2026-0006 (San Andrés - Providencia), con dos trampas
 * agregadas a propósito: una línea sin ranura cuyo nombre trae el nombre del cliente y
 * un precio, y un hotel con precio en su lectura. Si algo de eso llega al JSON del
 * modelo, estas pruebas lo dicen.
 */
import { describe, expect, it } from 'vitest'

import {
  EJEMPLOS_TEXTO_INICIALES,
  avisoDelTextoEnPdf,
  contenidoDelRedactor,
  describirAlertaDeEstilo,
  estadoDelTexto,
  leerConfigTextoDeLinea,
  revisarEstilo,
  hayViajeQueRedactar,
  huellaDeViaje,
  leerDocumentoCliente,
  limpiarTextoLibre,
  normalizarTexto,
  promptDelRedactor,
  textoDelModelo,
  textoDesactualizado,
  textoImprimible,
  textoParaElViaje,
  viajeParaRedactar,
  type DocumentoCliente,
  type EntradaRedactor,
  type TextoCliente,
} from './documento-cliente'
import { TERMINOS_BASE_TRAPPVEL } from './__fixtures__/terminos-base-trappvel'

const campos = (o: Record<string, string>) => Object.entries(o).map(([label, valor]) => ({ label, valor }))
const lectura = (c: Record<string, string>) => ({
  casillas: { grupo_completo: { total: 1, moneda: 'COP', campos: campos(c) } },
})

const AVIANCA = {
  id: 'i1',
  nombre: 'AVIANCA BOG - ADZ',
  grupo: 'avianca bog - adz',
  tarifa_pax: lectura({
    'Aerolínea': 'Avianca', 'Origen': 'Bogotá', 'Destino': 'San Andrés Isla', 'Salida': '2026-11-23',
    'Regreso': '2026-11-28', 'Nº de vuelo': '9782, 9779', 'Escalas': '0', 'Precio': '6208296',
  }),
}
const SATENA = {
  id: 'i2',
  nombre: 'SATENA ADZ - PROVIDENCIA',
  grupo: 'vuelo',
  tarifa_pax: lectura({
    'Aerolínea': 'SATENA', 'Origen': 'San Andrés Isla ADZ', 'Destino': 'Providencia PVA', 'Salida': '2026-11-23',
    'Regreso': '2026-11-25', 'Nº de vuelo': '8832 · 8833', 'Escalas': '0', 'Precio': '3292196',
  }),
}
const HOTEL = {
  id: 'i3',
  nombre: 'DECAMERON AQUARIUM',
  grupo: 'hotel',
  tarifa_pax: lectura({
    'Hotel': 'Decameron Aquarium', 'Ciudad': 'San Andrés', 'Habitación': 'Estándar', 'Régimen': 'Todo incluido',
    'Check-in': '2026-11-25', 'Check-out': '2026-11-28', 'Noches': '3', 'Precio': '4150000',
  }),
}
const TRASLADO = {
  id: 'i4',
  nombre: 'TRASLADO ADZ',
  grupo: 'traslado',
  tarifa_pax: lectura({ 'Trayecto': 'Aeropuerto - hotel - aeropuerto', 'Vehículo': 'Compartido' }),
}
/** La trampa: una línea suelta con el nombre del cliente y un precio en el nombre. */
const SEGURO = { id: 'i5', nombre: 'SEGURO DE VIAJE LIGIA SÁNCHEZ $ 350.000', grupo: null, tarifa_pax: null }
const AJUSTE = { id: 'i6', nombre: 'AJUSTE REDONDEO 12.345', grupo: null, tarifa_pax: null, es_ajuste: true }

const entrada = (over: Partial<EntradaRedactor> = {}): EntradaRedactor => ({
  items: [AVIANCA, SATENA, HOTEL, TRASLADO, SEGURO, AJUSTE],
  destino: 'San Andrés - Providencia',
  fechas: { inicio: '2026-11-23', fin: '2026-11-28' },
  composicion: { adultos: 6, ninos: 1, infantes: 1 },
  nombresDelCliente: ['Ligia Sanchez', 'Familia Sanchez Rojas'],
  ...over,
})

describe('lo que ve el modelo', () => {
  const viaje = viajeParaRedactar(entrada())
  const json = contenidoDelRedactor(viaje)

  it('⚠️⚠️ ni el nombre del cliente ni un precio llegan al modelo', () => {
    const plano = json.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    expect(plano).not.toContain('ligia')
    expect(plano).not.toContain('sanchez')
    for (const cifra of ['6208296', '3292196', '4150000', '350.000', '350000', '12.345']) {
      expect(json).not.toContain(cifra)
    }
    // Ninguna clave del JSON habla de plata.
    expect(json).not.toMatch(/"(precio|valor|monto|costo|total)[^"]*"\s*:/i)
  })

  it('⚠️ el nombre interno de un vuelo o un hotel no se copia: se describe el servicio', () => {
    expect(json).not.toContain('AVIANCA BOG - ADZ')
    expect(json).not.toContain('DECAMERON AQUARIUM')
    expect(viaje.vuelos.map(v => v.aerolinea)).toEqual(['Avianca', 'SATENA'])
    expect(viaje.hoteles[0]).toMatchObject({ nombre: 'Decameron Aquarium', noches: 3, regimen: 'Todo incluido' })
  })

  it('la línea suelta aporta su nombre, limpio; el ítem de cuadre no aporta nada', () => {
    expect(viaje.otrosServicios).toEqual(['SEGURO DE VIAJE'])
  })

  it('trae destino, fechas, viajeros y traslados', () => {
    expect(viaje.destino).toBe('San Andrés - Providencia')
    expect(viaje.fechaSalida).toBe('2026-11-23')
    expect(viaje.viajeros).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
    expect(viaje.traslados).toEqual(['Aeropuerto - hotel - aeropuerto · Compartido'])
  })

  it('⚠️ una actividad cuya lectura no dice QUÉ es lleva el nombre de la línea, limpio', () => {
    const tour = {
      id: 'i7',
      nombre: 'TOUR JOHNNY CAY LIGIA SANCHEZ',
      grupo: 'actividad',
      tarifa_pax: lectura({ 'Duración': 'Día completo', 'Ciudad': 'San Andrés' }),
    }
    const v = viajeParaRedactar(entrada({ items: [tour] }))
    expect(v.actividades).toEqual(['TOUR JOHNNY CAY · Día completo · San Andrés'])
    const conNombre = { ...tour, tarifa_pax: lectura({ 'Actividad': 'Tour Johnny Cay y Acuario', 'Duración': 'Día completo' }) }
    expect(viajeParaRedactar(entrada({ items: [conNombre] })).actividades).toEqual(['Tour Johnny Cay y Acuario · Día completo'])
  })

  it('el prompt exige no inventar y prohíbe precios y nombres', () => {
    const p = promptDelRedactor()
    expect(p).toContain('No inventes nada que no esté en el JSON')
    expect(p).toContain('Nada de precios')
    expect(p).toContain('No uses nombres de personas')
  })

  it('sin destino ni servicios no hay nada que redactar', () => {
    expect(hayViajeQueRedactar(viaje)).toBe(true)
    expect(hayViajeQueRedactar(viajeParaRedactar(entrada({ items: [SEGURO], destino: null })))).toBe(false)
  })
})

describe('limpiarTextoLibre', () => {
  it('quita el nombre del cliente sin importar tildes ni mayúsculas', () => {
    expect(limpiarTextoLibre('SEGURO LIGIA SÁNCHEZ', ['Ligia Sanchez'])).toBe('SEGURO')
  })

  it('quita cifras de dinero en sus formas comunes', () => {
    expect(limpiarTextoLibre('Tarjeta turismo COP 350000', [])).toBe('Tarjeta turismo')
    expect(limpiarTextoLibre('Seguro USD 90', [])).toBe('Seguro')
    expect(limpiarTextoLibre('Impuesto 7.303.878', [])).toBe('Impuesto')
    expect(limpiarTextoLibre('Cargo 6208296', [])).toBe('Cargo')
  })

  it('conserva un número de vuelo: cuatro dígitos no son plata', () => {
    expect(limpiarTextoLibre('Vuelo 8832', [])).toBe('Vuelo 8832')
  })

  it('si no queda ninguna letra, devuelve null', () => {
    expect(limpiarTextoLibre('$ 1.200.000', [])).toBeNull()
    expect(limpiarTextoLibre('Ligia Sanchez', ['Ligia Sanchez'])).toBeNull()
  })
})

const BASE: Omit<DocumentoCliente, 'revisado_en' | 'revisado_por' | 'revisado_por_nombre'> = {
  titular: 'San Andrés y Providencia: dos islas, un mismo mar',
  intro: 'Seis días entre el mar de siete colores y la calma de Providencia.',
  incluye: ['Tiquetes Bogotá - San Andrés - Bogotá con Avianca'],
  antes_de_viajar: ['Tramite la tarjeta de turismo de San Andrés.'],
  origen: 'ia',
  modelo: 'gemini-2.5-flash',
  redactado_en: '2026-09-22T20:00:00.000Z',
  fuente_hash: 'abc',
}
const BORRADOR: DocumentoCliente = { ...BASE, revisado_en: null, revisado_por: null, revisado_por_nombre: null }
const REVISADO: DocumentoCliente = {
  ...BASE, revisado_en: '2026-09-22T21:00:00.000Z', revisado_por: 'staff-1', revisado_por_nombre: 'Edgar Alarcón',
}

describe('lo que ve el cliente', () => {
  it('⚠️⚠️ un borrador de ONE no se imprime: solo el texto que una persona guardó', () => {
    expect(textoImprimible(BORRADOR)).toBeNull()
    expect(textoParaElViaje(BORRADOR)).toEqual({})
    expect(textoImprimible(REVISADO)?.titular).toBe(BASE.titular)
    expect(textoParaElViaje(REVISADO)).toEqual({
      titular: BASE.titular,
      intro: BASE.intro,
      incluye: BASE.incluye,
      antesDeViajar: BASE.antes_de_viajar,
    })
  })

  it('sin texto, el viaje no gana ni una clave', () => {
    expect(textoParaElViaje(null)).toEqual({})
  })

  it('el estado y el aviso del PDF: solo el borrador avisa', () => {
    expect(estadoDelTexto(null)).toBe('sin_texto')
    expect(estadoDelTexto(BORRADOR)).toBe('borrador')
    expect(estadoDelTexto(REVISADO)).toBe('revisado')
    expect(avisoDelTextoEnPdf(BORRADOR)).toContain('borrador de ONE sin revisar')
    expect(avisoDelTextoEnPdf(REVISADO)).toBeNull()
    expect(avisoDelTextoEnPdf(null)).toBeNull()
  })

  it('un jsonb roto se lee como ausente, nunca a medias', () => {
    expect(leerDocumentoCliente(null)).toBeNull()
    expect(leerDocumentoCliente([])).toBeNull()
    expect(leerDocumentoCliente({ titular: '   ', incluye: [] })).toBeNull()
    expect(leerDocumentoCliente({ titular: 'Hola', origen: 'otro' })?.origen).toBe('persona')
    expect(leerDocumentoCliente({ titular: 'Hola' })?.revisado_en).toBeNull()
  })

  it('normaliza: sin espacios de más, sin renglones vacíos ni repetidos, con tope', () => {
    const t = normalizarTexto({
      titular: '  San   Andrés  ',
      incluye: ['A', ' a ', '', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    })
    expect(t.titular).toBe('San Andrés')
    expect(t.incluye).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'])
  })

  it('un renglón de lista pierde el punto final: sale seguido de « · » en «Antes de viajar»', () => {
    const t = normalizarTexto({ antes_de_viajar: ['Lleve pasaporte vigente.', 'Llegue con tiempo; ', 'Etc...'] })
    expect(t.antes_de_viajar).toEqual(['Lleve pasaporte vigente', 'Llegue con tiempo', 'Etc'])
  })
})

describe('la huella del viaje', () => {
  it('es estable para la misma entrada', () => {
    expect(huellaDeViaje(viajeParaRedactar(entrada()))).toBe(huellaDeViaje(viajeParaRedactar(entrada())))
  })

  it('cambia si cambia una línea que el texto describe', () => {
    const otra = { ...HOTEL, tarifa_pax: lectura({ 'Hotel': 'Decameron Aquarium', 'Ciudad': 'San Andrés', 'Noches': '4' }) }
    const a = huellaDeViaje(viajeParaRedactar(entrada()))
    const b = huellaDeViaje(viajeParaRedactar(entrada({ items: [AVIANCA, SATENA, otra, TRASLADO, SEGURO] })))
    expect(a).not.toBe(b)
  })

  it('NO cambia si solo cambia el precio: el texto no habla de plata', () => {
    const caro = { ...HOTEL, tarifa_pax: lectura({ ...Object.fromEntries(HOTEL.tarifa_pax.casillas.grupo_completo.campos.map(c => [c.label, c.valor])), 'Precio': '9999999' }) }
    expect(huellaDeViaje(viajeParaRedactar(entrada({ items: [AVIANCA, SATENA, caro, TRASLADO, SEGURO, AJUSTE] }))))
      .toBe(huellaDeViaje(viajeParaRedactar(entrada())))
  })

  it('un texto escrito con otras líneas queda desactualizado; sin huella no se afirma nada', () => {
    expect(textoDesactualizado({ ...REVISADO, fuente_hash: 'x' }, 'y')).toBe(true)
    expect(textoDesactualizado({ ...REVISADO, fuente_hash: 'x' }, 'x')).toBe(false)
    expect(textoDesactualizado({ ...REVISADO, fuente_hash: null }, 'y')).toBe(false)
    expect(textoDesactualizado(null, 'y')).toBe(false)
  })
})

describe('lo que devuelve el modelo', () => {
  it('descarta el renglón que trae plata y conserva el resto', () => {
    const t = textoDelModelo({
      titular: 'San Andrés desde $ 1.200.000',
      intro: 'Seis días de mar.',
      incluye: ['Tiquetes con Avianca', 'Hotel por COP 4150000', 'Traslados'],
      antes_de_viajar: ['Lleve bloqueador'],
    })
    expect(t.titular).toBeNull()
    expect(t.intro).toBe('Seis días de mar.')
    expect(t.incluye).toEqual(['Tiquetes con Avianca', 'Traslados'])
    expect(t.antes_de_viajar).toEqual(['Lleve bloqueador'])
  })

  it('una respuesta sin forma es texto vacío, no un error a medias', () => {
    expect(textoDelModelo('hola')).toEqual({ titular: null, intro: null, incluye: [], antes_de_viajar: [] })
  })
})

// ── Brief del 2026-09-23: estilo, términos base y la voz de Trappvel ─────────

const texto = (over: Partial<TextoCliente> = {}): TextoCliente => ({
  titular: null,
  intro: null,
  incluye: [],
  antes_de_viajar: [],
  ...over,
})

describe('el validador de estilo (C4)', () => {
  it('el ejemplo bueno del brief no tiene nada que revisar', () => {
    expect(revisarEstilo(texto({
      titular: 'Cinco noches en Cancún, en un hotel todo incluido frente al mar',
      intro: 'Cinco noches en el Riu Caribe, en la zona hotelera de Cancún. El mar es turquesa todo el año.',
      incluye: ['Tiquetes aéreos Bogotá – Cancún – Bogotá con Avianca'],
      antes_de_viajar: ['Lleve el pasaporte vigente', 'El conductor lo espera en la salida del aeropuerto'],
    }))).toEqual([])
  })

  it('⚠️⚠️ marca las fórmulas vetadas en la forma de USTED que de verdad escribe el modelo', () => {
    const a = revisarEstilo(texto({
      titular: 'Descubra el paraíso caribeño',
      intro: 'Un rincón de ensueño que le espera. No se lo pierda.',
      antes_de_viajar: ['Sumérjase en sus aguas cristalinas'],
    }))
    const vetadas = a.filter(x => x.motivo === 'vetada').map(x => `${x.campo}:${x.texto}`)
    expect(vetadas).toEqual(expect.arrayContaining([
      'titular:Descubra', 'titular:paraíso', 'intro:rincón', 'intro:de ensueño', 'intro:le espera',
      'intro:No se lo pierda', 'antes_de_viajar:Sumérjase', 'antes_de_viajar:aguas cristalinas',
    ]))
  })

  it('no marca palabras que solo se parecen: la letra de al lado cuenta, con tildes', () => {
    // «joyería» no es «joya»; «rinconera» no es «rincón»; «lo esperamos» no es «le espera».
    expect(revisarEstilo(texto({ intro: 'Visita a la joyería y a la rinconera del hotel. Lo esperamos.' }))).toEqual([])
    expect(revisarEstilo(texto({ antes_de_viajar: ['Conviene prepararse para el frío de la noche'] }))).toEqual([])
  })

  it('⚠️ una frase entusiasta pasa, aunque traiga dos de la lista permitida: así abre Trappvel', () => {
    expect(revisarEstilo(texto({ intro: '¡Prepárese para vivir una experiencia única en Chile! Hemos seleccionado los servicios necesarios.' }))).toEqual([])
    for (const e of EJEMPLOS_TEXTO_INICIALES) expect(revisarEstilo(e)).toEqual([])
  })

  it('⚠️ el entusiasmo en dos frases se marca, y también dos exclamaciones', () => {
    const a = revisarEstilo(texto({
      titular: '¡Déjese sorprender por Perú!',
      intro: '¡Prepárese para una experiencia única! Cinco noches en Cusco.',
    }))
    expect(a.map(x => x.motivo)).toEqual(expect.arrayContaining(['repetida', 'exclamaciones']))
    expect(a.find(x => x.motivo === 'exclamaciones')!.texto).toBe('2 exclamaciones')
    // Una sola exclamación en todo el texto está permitida.
    expect(revisarEstilo(texto({ titular: '¡Perú lo espera!', intro: 'Cinco noches en Cusco.' }))).toEqual([])
  })

  it('marca el guion largo y los emojis; el guion de una ruta (–) no', () => {
    const a = revisarEstilo(texto({ titular: 'Cancún — cinco noches', incluye: ['Traslado aeropuerto – hotel 🚐'] }))
    expect(a).toContainEqual({ motivo: 'guion_largo', texto: '—', campo: 'titular' })
    expect(a).toContainEqual({ motivo: 'emoji', texto: '🚐', campo: 'incluye' })
    expect(a.filter(x => x.motivo === 'guion_largo')).toHaveLength(1)
  })

  it('cada alerta se dice en una frase, con el campo donde está', () => {
    expect(describirAlertaDeEstilo({ motivo: 'vetada', texto: 'Descubra', campo: 'intro' })).toBe('«Descubra» (Presentación): suena a folleto.')
    expect(describirAlertaDeEstilo({ motivo: 'guion_largo', texto: '—', campo: 'titular' })).toContain('Guion largo «—» (Titular)')
    expect(describirAlertaDeEstilo({ motivo: 'exclamaciones', texto: '3 exclamaciones', campo: null })).toBe('3 exclamaciones: se permite una en todo el texto.')
  })

  it('las alertas guardadas se leen sin confiar en su forma; un texto limpio no lleva la clave', () => {
    const base = { titular: 'Cancún', origen: 'ia', revisado_en: null }
    const d = leerDocumentoCliente({
      ...base,
      estilo_por_revisar: [{ motivo: 'vetada', texto: 'Descubra', campo: 'intro' }, { motivo: 'otro', texto: 'x' }, 'basura'],
    })!
    expect(d.estilo_por_revisar).toEqual([{ motivo: 'vetada', texto: 'Descubra', campo: 'intro' }])
    expect(leerDocumentoCliente(base)).not.toHaveProperty('estilo_por_revisar')
  })
})

describe('lo que declara la línea (config_extra)', () => {
  it('terminos_base se lee con sus saltos de línea; sin la clave, null', () => {
    expect(leerConfigTextoDeLinea({ terminos_base: 'Condiciones\n- Uno  \n\n\n- Dos' }).terminosBase).toBe('Condiciones\n- Uno\n\n- Dos')
    expect(leerConfigTextoDeLinea({ recargo: { valor: 100000 } }).terminosBase).toBeNull()
    expect(leerConfigTextoDeLinea(null)).toMatchObject({ terminosBase: null })
    expect(leerConfigTextoDeLinea('basura')).toMatchObject({ terminosBase: null })
  })

  it('el texto base provisional de Trappvel entra entero, con su sub-lista de cuentas', () => {
    expect(leerConfigTextoDeLinea({ terminos_base: TERMINOS_BASE_TRAPPVEL }).terminosBase).toBe(TERMINOS_BASE_TRAPPVEL)
  })

  it('sin ejemplos declarados, la voz inicial de Trappvel; con una lista, esa y solo esa', () => {
    expect(leerConfigTextoDeLinea({}).ejemplos).toEqual(EJEMPLOS_TEXTO_INICIALES)
    expect(leerConfigTextoDeLinea({ ejemplos_texto: 'no es lista' }).ejemplos).toEqual(EJEMPLOS_TEXTO_INICIALES)
    // Una lista vacía apaga los ejemplos: el prompt funciona igual sin ellos.
    expect(leerConfigTextoDeLinea({ ejemplos_texto: [] }).ejemplos).toEqual([])
  })

  it('un ejemplo puede ser un texto suelto (presentación) o un objeto con los cuatro campos', () => {
    const { ejemplos } = leerConfigTextoDeLinea({
      ejemplos_texto: [
        'Cinco noches en Cancún, frente al mar.',
        { titular: 'Perú en ocho días', incluye: ['Tiquetes con LATAM', 'Hoteles con desayuno'] },
        null,
        42,
      ],
    })
    expect(ejemplos).toEqual([
      { titular: null, intro: 'Cinco noches en Cancún, frente al mar.', incluye: [], antes_de_viajar: [] },
      { titular: 'Perú en ocho días', intro: null, incluye: ['Tiquetes con LATAM', 'Hoteles con desayuno'], antes_de_viajar: [] },
    ])
  })

  it('⚠️ el renglón de un ejemplo con una cifra de dinero se cae: enseñaría a poner precios', () => {
    const { ejemplos } = leerConfigTextoDeLinea({
      ejemplos_texto: [{ intro: 'Cancún desde $ 2.500.000 por persona.', incluye: ['Tiquetes con Avianca', 'Hotel por COP 4150000'] }],
    })
    expect(ejemplos).toEqual([{ titular: null, intro: null, incluye: ['Tiquetes con Avianca'], antes_de_viajar: [] }])
  })

  it('entran como mucho cinco', () => {
    const muchos = Array.from({ length: 8 }, (_, i) => `Ejemplo número ${i + 1} de la agencia.`)
    expect(leerConfigTextoDeLinea({ ejemplos_texto: muchos }).ejemplos).toHaveLength(5)
  })

  it('⚠️ la voz inicial trata de usted, como el documento: ningún ejemplo tutea', () => {
    const tuteo = /(?<!\p{L})(?:prepárate|déjate|descubre|disfrutes|te preocupes|tu viaje)(?!\p{L})/iu
    for (const e of EJEMPLOS_TEXTO_INICIALES) expect(e.intro ?? '').not.toMatch(tuteo)
    expect(EJEMPLOS_TEXTO_INICIALES.map(e => e.intro)).toEqual([
      '¡Prepárese para vivir una experiencia única en Chile! Hemos seleccionado los servicios necesarios para que solo se preocupe por disfrutar.',
      '¡Déjese sorprender por Perú! Hemos preparado esta propuesta pensando en cada detalle para que disfrute un viaje cómodo y seguro.',
      'Glaciares, cataratas, ciudades históricas y buenos vinos: Argentina tiene de todo.',
    ])
  })
})

describe('el prompt del redactor (C3 y C4)', () => {
  it('C3 · «antes de viajar» son consejos: nunca validez, disponibilidad, cancelaciones ni pagos', () => {
    const p = promptDelRedactor()
    expect(p).toContain('"antes_de_viajar" son consejos para el viajero, no condiciones de la reserva')
    expect(p).toContain('nunca incluye validez de tarifas, disponibilidad, cambios, cancelaciones, penalidades ni formas de pago')
  })

  it('C4 · la medida del entusiasmo, la lista vetada, el guion largo y los emojis', () => {
    const p = promptDelRedactor()
    expect(p).toContain('UNA sola frase entusiasta en todo el texto')
    expect(p).toContain('UNA sola exclamación en todo el texto')
    for (const f of ['sumérgete', 'descubre', 'paraíso', 'experiencia inolvidable', 'no te pierdas', 'ideal para']) expect(p).toContain(`"${f}"`)
    expect(p).toContain('Nada de guion largo (—)')
    expect(p).toContain('Nada de emojis')
    expect(p).toContain('trátalo de usted')
    // El prompt no se contradice: ya no pide un titular que «dé ganas de viajar».
    expect(p).not.toContain('dé ganas de viajar')
  })

  it('sin ejemplos no hay sección de ejemplos, y el cierre sigue pidiendo solo JSON', () => {
    const p = promptDelRedactor()
    expect(p).not.toContain('EJEMPLOS DE LA VOZ DE TRAPPVEL')
    expect(p.trim().endsWith('Responde SOLO con JSON válido, siguiendo exactamente el esquema pedido.')).toBe(true)
  })

  it('con ejemplos, van como voz a imitar y nunca como datos; como mucho cinco', () => {
    const seis = Array.from({ length: 6 }, (_, i) => texto({ intro: `Presentación de muestra ${i + 1}.` }))
    const p = promptDelRedactor(seis)
    expect(p).toContain('EJEMPLOS DE LA VOZ DE TRAPPVEL')
    expect(p).toContain('NUNCA copies sus datos')
    expect(p).toContain('Presentación de muestra 5.')
    expect(p).not.toContain('Presentación de muestra 6.')
    // Un ejemplo solo lleva los campos que trae.
    expect(p).not.toContain('"incluye": []')
    expect(p.trim().endsWith('Responde SOLO con JSON válido, siguiendo exactamente el esquema pedido.')).toBe(true)
  })
})
