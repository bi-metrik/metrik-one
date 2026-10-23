/**
 * Los tres textos de la ficha (P11, §1.8): oferta, mensaje directo y bienvenida al grupo. Datos de EJEMPLO con la ficha
 * de «El extraño mundo de Jack» (los textos de Sabor, tal cual los escribió Paula); el lugar es inventado y marcado.
 *
 * La prueba obligatoria de §1.8 es `fechasDelTexto`: busca con un PATRÓN, sin mirar la plantilla, cada fecha, día de
 * la semana y hora que aparece en el texto generado, y exige que cada una sea un dato de la función o de su preventa.
 */
import { describe, expect, it } from 'vitest'
import {
  contarBytes,
  contarCaracteres,
  funcionesALaVenta,
  generarBienvenida,
  generarMensajeDirecto,
  generarOferta,
  LIMITE_DIRECTO_BYTES,
  LIMITE_POST_CARACTERES,
  pesosTexto,
  type FichaTextos,
  type FuncionTextos,
  type NegocioTextos,
} from './textos'
import type { TarifaPublica } from './tipos'

// ── Datos de EJEMPLO ────────────────────────────────────────────────────────

const FICHA: FichaTextos = {
  titulo_oferta: '🎃💀 EL EXTRAÑO MUNDO DE JACK llega a CENA Y PELÍCULA en BOGOTÁ 🎄🖤',
  frase_gancho: '¿Qué pasa cuando Halloween y Navidad se encuentran? 🎃🎁✨',
  intro:
    'Vive una experiencia inmersiva inspirada en El Extraño Mundo de Jack, donde la gastronomía, la fantasía y el encanto oscuro se unen para transportarte a un mundo extraordinario. 🕯️🖤',
  que_incluye: ['🍽️ 5 tiempos inspirados en la película', '🥂 2 bebidas especiales', '🎬 Proyección de la película'],
  emojis_tema: '🎃🖤',
  saludo_grupo: '🎃💀 ¡Hola, habitantes de Halloween Town, criaturas de la noche y amantes de la Navidad! 🎄🖤✨\n\n¡Bienvenidos al grupo oficial!',
  relato_grupo: '💀🎁 ¡Que comience nuestra extraña y maravillosa celebración!',
}

const NEGOCIO: NegocioTextos = {
  direccion: '[EJEMPLO] Calle 100 #10-10, Bogotá',
  piso: 'Segundo piso',
  recepcion: 'Al llegar, en el primer piso los recibe nuestro staff. 🎃🎁✨',
  parqueadero: 'Contamos con una bahía de parqueo justo en frente.',
  firma: 'El equipo de [EJEMPLO] 🕯️✨',
}

const tarifa = (t: Partial<TarifaPublica> = {}): TarifaPublica => ({
  tarifa: 'completa', precio_persona: 180_000, precio_completo_persona: null, preventa_hasta: null, abono_persona: 100_000, permite_pago_total: true, ...t,
})
const preventa = (hasta: string | null, precio = 170_000): TarifaPublica =>
  tarifa({ tarifa: 'preventa', precio_persona: precio, precio_completo_persona: 180_000, preventa_hasta: hasta })

// Sábado 24 de octubre de 2026, 1:00 p. m. y 4:00 p. m.; domingo 25, 8:00 p. m. (hora de Bogotá, UTC−5).
const SAB_1PM = '2026-10-24T18:00:00.000Z'
const SAB_4PM = '2026-10-24T21:00:00.000Z'
const DOM_8PM = '2026-10-26T01:00:00.000Z'
const AHORA = Date.parse('2026-10-14T15:00:00.000Z')

const funcion = (inicia_at: string, t: TarifaPublica = tarifa(), o: Partial<FuncionTextos> = {}): FuncionTextos => ({
  inicia_at, estado: 'activa', llena: false, tarifa: t, ...o,
})

const AGENDA: FuncionTextos[] = [
  funcion(SAB_4PM, preventa('2026-10-15')),
  funcion(SAB_1PM, preventa('2026-10-15')),
  funcion(DOM_8PM),
]

// ── La prueba de fechas por patrón (independiente de la plantilla) ──────────

const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const RE_FECHA = new RegExp(`(?:(${DIAS.join('|')})\\s+)?(\\d{1,2})\\s+de\\s+(${MESES.join('|')})`, 'gi')
const RE_DIA_SUELTO = new RegExp(`\\b(${DIAS.join('|')})\\b(?!\\s+\\d)`, 'gi')
const RE_HORA = /\b(\d{1,2})[:.](\d{2})(?!\d)\s*(?:([ap])\.?\s*m\.?)?/gi
const RE_NUMERICA = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g

interface Dato { fecha: string; hora?: string }

/** Lo que la función y su preventa autorizan a que aparezca: días con su día de la semana, y horas. */
function autorizados(datos: Dato[], margenes: number[] = [0]) {
  const dias = new Map<string, string>() // «24 de octubre» → «sábado»
  const horas = new Set<string>()
  for (const d of datos) {
    const ms = d.hora ? Date.parse(d.hora) - 5 * 3_600_000 : Date.parse(`${d.fecha}T12:00:00Z`)
    const x = new Date(ms)
    dias.set(`${x.getUTCDate()} de ${MESES[x.getUTCMonth()]}`, DIAS[x.getUTCDay()])
    if (d.hora) {
      for (const m of margenes) {
        const y = new Date(Date.parse(d.hora) - 5 * 3_600_000 + m * 60_000)
        const h = y.getUTCHours()
        horas.add(`${h % 12 === 0 ? 12 : h % 12}:${String(y.getUTCMinutes()).padStart(2, '0')} ${h < 12 ? 'a' : 'p'}`)
      }
    }
  }
  return { dias, horas }
}

/** Los errores de fecha de un texto: cada fecha, día y hora tiene que ser un dato. Vacío = limpio. */
function fechasDelTexto(texto: string, datos: Dato[], margenes: number[] = [0]): string[] {
  const { dias, horas } = autorizados(datos, margenes)
  const errores: string[] = []
  for (const m of texto.matchAll(RE_FECHA)) {
    const clave = `${Number(m[2])} de ${m[3].toLowerCase()}`
    if (!dias.has(clave)) errores.push(`fecha que no es de la función: «${m[0]}»`)
    else if (m[1] && m[1].toLowerCase() !== dias.get(clave)) errores.push(`día de la semana equivocado: «${m[0]}» (es ${dias.get(clave)})`)
  }
  for (const m of texto.matchAll(RE_DIA_SUELTO)) errores.push(`día de la semana sin fecha: «${m[0]}»`)
  for (const m of texto.matchAll(RE_NUMERICA)) errores.push(`fecha numérica: «${m[0]}»`)
  for (const m of texto.matchAll(RE_HORA)) {
    if (!m[3]) {
      errores.push(`hora sin a. m./p. m.: «${m[0]}»`)
      continue
    }
    if (!horas.has(`${Number(m[1])}:${m[2]} ${m[3].toLowerCase()}`)) errores.push(`hora que no es de la función: «${m[0].trim()}»`)
  }
  return errores
}

const datosAgenda = (fs: FuncionTextos[]): Dato[] =>
  fs.flatMap((f) => [{ fecha: f.inicia_at.slice(0, 10), hora: f.inicia_at }, ...(f.tarifa.preventa_hasta ? [{ fecha: f.tarifa.preventa_hasta }] : [])])

const SIN_NEQUI = /nequi|daviplata|davi\s*plata/i

// ── Pruebas ─────────────────────────────────────────────────────────────────

describe('la prueba de fechas por patrón ve los errores de los mensajes de hoy', () => {
  it('una bienvenida con la fecha de otra función, un día de la semana equivocado o una preventa copiada no pasan', () => {
    const datos: Dato[] = [{ fecha: '2026-10-24', hora: SAB_1PM }]
    expect(fechasDelTexto('📅 FECHA Y HORA\nDomingo 18 de octubre | 8:00 p. m.', datos)).toEqual([
      'fecha que no es de la función: «Domingo 18 de octubre»',
      'hora que no es de la función: «8:00 p. m.»',
    ])
    expect(fechasDelTexto('Domingo 24 de octubre 1:00 p. m.', datos)).toEqual(['día de la semana equivocado: «Domingo 24 de octubre» (es sábado)'])
    expect(fechasDelTexto('Preventa (hasta el 15 de octubre)', datos)).toEqual(['fecha que no es de la función: «15 de octubre»'])
    expect(fechasDelTexto('Sábado 24  de octubre 1:00pm', datos)).toEqual([])
    expect(fechasDelTexto('Nos vemos el sábado. Llegada 7:50.', datos)).toHaveLength(2)
    expect(fechasDelTexto('El 24/10 a la 1:00 p. m.', datos)).toEqual(['fecha numérica: «24/10»'])
  })
})

describe('a) la oferta: el post de Instagram con todas las funciones', () => {
  const o = generarOferta({ ficha: FICHA, negocio: NEGOCIO, funciones: AGENDA, ahoraMs: AHORA })

  it('sigue el orden y los emojis del mensaje real, con cada función completa y su preventa debajo', () => {
    expect(o.faltantes).toEqual([])
    expect(o.copiable).toBe(true)
    expect(o.texto).toBe(
      [
        FICHA.titulo_oferta,
        FICHA.frase_gancho,
        FICHA.intro,
        '✨ INCLUYE:\n🍽️ 5 tiempos inspirados en la película\n🥂 2 bebidas especiales\n🎬 Proyección de la película',
        [
          '📅',
          '',
          'Sábado 24 de octubre, 1:00 p. m.',
          '🎟️ Preventa: $170.000 por persona (hasta el 15 de octubre)',
          'Sábado 24 de octubre, 4:00 p. m.',
          '🎟️ Preventa: $170.000 por persona (hasta el 15 de octubre)',
          'Domingo 25 de octubre, 8:00 p. m.',
          '🎫 Boletería regular: $180.000',
        ].join('\n'),
        '✨ Reserva con $100.000 por cupo y paga el saldo 1 día antes.',
        '📍 [EJEMPLO] Calle 100 #10-10, Bogotá',
        '📝 Para reservar: nombre completo, cédula, celular y horario elegido.',
        '💳 Te enviamos el link de pago por este chat.',
        '🎃🖤 ¡Cupos limitados! Elige tu horario y prepárate para una experiencia inolvidable. ✨',
      ].join('\n\n'),
    )
  })

  it('cada fecha y hora del texto es de una función o de su preventa', () => {
    expect(fechasDelTexto(o.texto, datosAgenda(AGENDA))).toEqual([])
    // Y la prueba muerde: con la agenda de otra función, el mismo texto no pasa.
    expect(fechasDelTexto(o.texto, datosAgenda([funcion(DOM_8PM)])).length).toBeGreaterThan(0)
  })

  it('sin Nequi, sin Daviplata y sin «comprobante de pago»; el pago va por el link', () => {
    expect(o.texto).not.toMatch(SIN_NEQUI)
    expect(o.texto).not.toMatch(/comprobante/i)
    expect(o.texto).toContain('💳 Te enviamos el link de pago por este chat.')
  })

  it('si el precio regular cambia entre funciones va debajo de cada una; la preventa vencida (tarifa completa) no se anuncia', () => {
    const t = generarOferta({
      ficha: FICHA, negocio: NEGOCIO, ahoraMs: AHORA,
      funciones: [funcion(SAB_1PM, tarifa({ precio_persona: 190_000 })), funcion(DOM_8PM)],
    }).texto
    expect(t).toContain('Sábado 24 de octubre, 1:00 p. m.\n🎫 Boletería regular: $190.000\nDomingo 25 de octubre, 8:00 p. m.\n🎫 Boletería regular: $180.000')
    expect(t).not.toContain('Preventa')
  })

  it('solo las funciones a la venta: activas, futuras y con cupo', () => {
    const todas = [
      funcion(SAB_1PM),
      funcion(SAB_4PM, tarifa(), { llena: true }),
      funcion(DOM_8PM, tarifa(), { estado: 'pausada' }),
      funcion('2026-10-10T18:00:00.000Z'),
      funcion('2026-10-31T18:00:00.000Z', tarifa(), { estado: 'cancelada' }),
    ]
    expect(funcionesALaVenta(todas, AHORA).map((f) => f.inicia_at)).toEqual([SAB_1PM])
    const t = generarOferta({ ficha: FICHA, negocio: NEGOCIO, funciones: todas, ahoraMs: AHORA }).texto
    expect(t.match(/de octubre, /g)).toHaveLength(1)
  })

  it('pasado el límite de 2.200 caracteres no corta: dice cuánto sobra y qué se podría recortar', () => {
    const muchas = Array.from({ length: 60 }, (_, i) => funcion(new Date(Date.parse(SAB_1PM) + i * 3_600_000).toISOString(), preventa('2026-10-15')))
    const g = generarOferta({ ficha: FICHA, negocio: NEGOCIO, funciones: muchas, ahoraMs: AHORA })
    expect(g.caracteres).toBeGreaterThan(LIMITE_POST_CARACTERES)
    expect(g.sobra).toBe(g.caracteres - LIMITE_POST_CARACTERES)
    expect(g.copiable).toBe(false)
    expect(g.recortaria[0].parte).toBe('la lista de funciones (60)')
    expect(g.motivo).toContain(`Sobran ${g.sobra} caracteres`)
    // El texto va entero: la última función y el cierre siguen ahí.
    expect(g.texto).toContain('🎃🖤 ¡Cupos limitados!')
    expect(fechasDelTexto(g.texto, datosAgenda(muchas))).toEqual([])
  })
})

describe('b) la oferta por mensaje directo: sin la lista de funciones, hasta 1.000 bytes', () => {
  const d = generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'El extraño mundo de Jack · octubre' }, funciones: AGENDA, ahoraMs: AHORA })

  it('nombra la campaña y ofrece los horarios aparte; no inventa un precio que no sea de todas', () => {
    expect(d.texto).toContain('📅 El extraño mundo de Jack · octubre: te compartimos por este chat los horarios disponibles.')
    expect(d.texto).not.toMatch(/\d{1,2}:\d{2}/)
    // La preventa es de dos de las tres funciones.
    expect(d.texto).toContain('🎟️ Preventa en algunos horarios: $170.000 por persona (hasta el 15 de octubre)\n🎫 Boletería regular: $180.000')
    expect(fechasDelTexto(d.texto, datosAgenda(AGENDA))).toEqual([])
    expect(d.texto).not.toMatch(SIN_NEQUI)
    expect(d.texto).not.toMatch(/comprobante/i)
  })

  it('con preventas distintas o regulares distintos, no da números', () => {
    const t = generarMensajeDirecto({
      ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'Jack' }, ahoraMs: AHORA,
      funciones: [funcion(SAB_1PM, preventa('2026-10-15', 170_000)), funcion(DOM_8PM, tarifa({ tarifa: 'preventa', precio_persona: 160_000, precio_completo_persona: 190_000, preventa_hasta: '2026-10-20' }))],
    }).texto
    expect(t).toContain('🎟️ Preventa en algunos horarios: te contamos el precio con cada horario.\n🎫 Boletería regular: te contamos el precio con cada horario.')
    expect(t).not.toMatch(/\$1[6-9]0\.000/)
  })

  it('cuenta BYTES: tildes y ñ pesan 2 y los emojis 4', () => {
    expect([contarCaracteres('ñ'), contarBytes('ñ'), contarCaracteres('🎃'), contarBytes('🎃')]).toEqual([1, 2, 1, 4])
    expect(d.bytes).toBe(new TextEncoder().encode(d.texto).length)
    expect(d.bytes).toBeGreaterThan(d.caracteres)
    // La ficha de Jack con un nombre de campaña corto cabe; con el de arriba pasa por poco (ver la prueba de abajo).
    const corto = generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'Jack' }, funciones: AGENDA, ahoraMs: AHORA })
    expect(corto.bytes).toBeLessThanOrEqual(LIMITE_DIRECTO_BYTES)
    expect(corto.copiable).toBe(true)
  })

  it('pasado el límite dice cuántos bytes sobran y no corta', () => {
    const larga = { ...FICHA, intro: `${FICHA.intro} ${'Ñandú mágico 🎃 '.repeat(5)}` }
    const g = generarMensajeDirecto({ ficha: larga, negocio: NEGOCIO, campana: { nombre: 'Jack' }, funciones: AGENDA, ahoraMs: AHORA })
    expect(g.bytes).toBeGreaterThan(LIMITE_DIRECTO_BYTES)
    // Por caracteres cabría: lo que manda son los bytes.
    expect(g.caracteres).toBeLessThan(LIMITE_DIRECTO_BYTES)
    expect(g.sobra).toBe(g.bytes - LIMITE_DIRECTO_BYTES)
    expect(g.limite).toEqual({ unidad: 'bytes', maximo: 1000 })
    expect(g.recortaria[0]).toEqual({ parte: 'la intro', medida: contarBytes(larga.intro.trim()) })
    expect(g.copiable).toBe(false)
    expect(g.texto).toContain(larga.intro.trim())
  })
})

describe('c) la bienvenida al grupo de WhatsApp de una función', () => {
  const b = generarBienvenida({ ficha: FICHA, negocio: NEGOCIO, funcion: { inicia_at: SAB_1PM } })

  it('llegada 10 minutos antes e inicio 10 minutos después, con los textos fijos y los del lugar', () => {
    expect(b.texto).toContain('📅 FECHA Y HORA\nSábado 24 de octubre | 1:00 p. m.')
    expect(b.texto).toContain('🕐 LLEGADA: 12:50 p. m.\n✨ INICIAMOS: 1:10 p. m. puntual.')
    expect(b.texto).toContain('📍 LUGAR\n[EJEMPLO] Calle 100 #10-10, Bogotá – Segundo piso')
    expect(b.texto).toContain('💰 PAGOS PENDIENTES\n\nRecuerden pagar el saldo con el link de pago que les enviamos por el chat de su reserva.')
    expect(b.texto).toContain('cerraremos la puerta de ingreso')
    expect(b.texto).not.toContain('Jack tiene todo preparado')
    expect(b.texto.startsWith(FICHA.saludo_grupo!)).toBe(true)
    expect(b.texto.endsWith(`${FICHA.relato_grupo}\n\nCon cariño,\n${NEGOCIO.firma}`)).toBe(true)
    expect(b.texto).not.toMatch(SIN_NEQUI)
    expect(b.copiable).toBe(true)
  })

  it('cada fecha y hora sale de la función (también al cruzar la medianoche)', () => {
    expect(fechasDelTexto(b.texto, [{ fecha: '2026-10-24', hora: SAB_1PM }], [0, -10, 10])).toEqual([])
    const tarde = '2026-10-25T05:05:00.000Z' // domingo 25, 12:05 a. m.
    const t = generarBienvenida({ ficha: FICHA, negocio: NEGOCIO, funcion: { inicia_at: tarde } }).texto
    expect(t).toContain('Domingo 25 de octubre | 12:05 a. m.')
    expect(t).toContain('🕐 LLEGADA: 11:55 p. m.\n✨ INICIAMOS: 12:15 a. m. puntual.')
    expect(fechasDelTexto(t, [{ fecha: '2026-10-25', hora: tarde }], [0, -10, 10])).toEqual([])
    expect(fechasDelTexto(t, [{ fecha: '2026-10-25', hora: tarde }])).toHaveLength(2)
  })
})

describe('campos vacíos, textos libres y pago', () => {
  const VACIA: FichaTextos = { titulo_oferta: null, frase_gancho: ' ', intro: null, que_incluye: [], emojis_tema: null, saludo_grupo: null, relato_grupo: null }
  const SIN_LUGAR: NegocioTextos = { direccion: null, piso: null, recepcion: null, parqueadero: null, firma: null }

  it('un campo vacío sale «[FALTA: campo]», va en los faltantes y el texto no se deja copiar', () => {
    const o = generarOferta({ ficha: VACIA, negocio: SIN_LUGAR, funciones: [funcion(SAB_1PM, tarifa({ precio_persona: null }))], ahoraMs: AHORA })
    expect(o.faltantes).toEqual(['título de la oferta', 'frase gancho', 'intro', 'qué incluye', 'precio regular', 'dirección', 'emojis del tema'])
    for (const c of o.faltantes) expect(o.texto).toContain(`[FALTA: ${c}]`)
    expect([o.copiable, o.motivo]).toEqual([false, `Falta en la ficha: ${o.faltantes.join(', ')}.`])

    const sinFunciones = generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'Jack' }, funciones: [], ahoraMs: AHORA })
    expect(sinFunciones.faltantes).toEqual(['funciones a la venta'])
    expect(sinFunciones.copiable).toBe(false)

    const b = generarBienvenida({ ficha: VACIA, negocio: SIN_LUGAR, funcion: { inicia_at: SAB_1PM } })
    expect(b.faltantes).toEqual(['saludo del grupo', 'dirección', 'piso', 'recepción', 'parqueadero', 'relato de cierre del grupo', 'firma'])
    expect(b.copiable).toBe(false)
    // Las horas salen igual: son de la función, no de la ficha.
    expect(b.texto).toContain('🕐 LLEGADA: 12:50 p. m.')
  })

  it('la preventa sin precio sale «[FALTA: precio de preventa]»; sin fecha de fin, sin paréntesis', () => {
    const o = generarOferta({ ficha: FICHA, negocio: NEGOCIO, ahoraMs: AHORA, funciones: [funcion(SAB_1PM, tarifa({ tarifa: 'preventa', precio_persona: null, precio_completo_persona: 180_000 }))] })
    expect(o.texto).toContain('🎟️ Preventa: [FALTA: precio de preventa] por persona\n🎫 Boletería regular: $180.000')
    expect(o.faltantes).toEqual(['precio de preventa'])
  })

  it('los textos libres van tal cual: emojis, saltos de línea y espacios de adentro', () => {
    const rara = { ...FICHA, intro: 'Línea 1 🕯️🖤\n\nLínea   2 ✨', saludo_grupo: '🎃💀 Hola\n¡Bienvenidos! 🌙' }
    expect(generarOferta({ ficha: rara, negocio: NEGOCIO, funciones: AGENDA, ahoraMs: AHORA }).texto).toContain('\n\nLínea 1 🕯️🖤\n\nLínea   2 ✨\n\n')
    expect(generarBienvenida({ ficha: rara, negocio: NEGOCIO, funcion: { inicia_at: SAB_1PM } }).texto.startsWith('🎃💀 Hola\n¡Bienvenidos! 🌙\n\n')).toBe(true)
  })

  it('si la ficha o el lugar mencionan Nequi o Daviplata, el texto no se deja copiar: el pago va solo por el link', () => {
    const conNequi = generarOferta({ ficha: { ...FICHA, intro: 'Paga por Nequi.' }, negocio: NEGOCIO, funciones: AGENDA, ahoraMs: AHORA })
    expect(conNequi.copiable).toBe(false)
    expect(conNequi.motivo).toContain('Nequi o Daviplata')
    const conDavi = generarBienvenida({ ficha: FICHA, negocio: { ...NEGOCIO, recepcion: 'Pagos por DaviPlata' }, funcion: { inicia_at: SAB_1PM } })
    expect(conDavi.copiable).toBe(false)
  })

  it('pesos con punto de miles', () => {
    expect([pesosTexto(170_000), pesosTexto(1_800_000), pesosTexto(950)]).toEqual(['$170.000', '$1.800.000', '$950'])
  })
})
