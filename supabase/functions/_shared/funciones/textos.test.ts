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
  AVISO_OTRO_PAGO,
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
  // El saludo temático lleva también las frases con tema que antes iban en la puerta cerrada y en la recepción (23-oct).
  saludo_grupo: [
    '🎃💀 ¡Hola, habitantes de Halloween Town, criaturas de la noche y amantes de la Navidad! 🎄🖤✨',
    '¡Bienvenidos al grupo oficial!',
    'Recuerden… ¡Jack tiene todo preparado y no queremos que se pierdan ni un instante de esta extraordinaria aventura! 🎃🎄',
    '[EJEMPLO] Los esperamos en nuestro pequeño rincón entre Halloween Town y Christmas Town. 🎃🎁✨',
  ].join('\n\n'),
  relato_grupo: '💀🎁 ¡Que comience nuestra extraña y maravillosa celebración!',
  // Es una película: la proyección necesita el salón oscuro, la puerta se cierra al iniciar (Paula, 26-oct).
  puerta_cerrada: true,
}

const NEGOCIO: NegocioTextos = {
  direccion: '[EJEMPLO] Calle 100 #10-10, Bogotá',
  piso: 'Segundo piso',
  // La recepción del negocio, sin tema (23-oct): la frase de la película va en el saludo de cada experiencia.
  recepcion: 'Al llegar, en el primer piso encontrarán personal de nuestro staff que los recibirá y les indicará por dónde ingresar.',
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

/** La campaña: el plazo del saldo por defecto (1 día antes). */
const CAMPANA = { dias_saldo_antes: 1 }

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
  const o = generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA, ahoraMs: AHORA })

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
        '💳 Te enviamos el link de pago por este chat',
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
    // La línea aprobada (23-oct), exacta: sin punto final y en su propio párrafo.
    expect(o.texto.split('\n\n')).toContain('💳 Te enviamos el link de pago por este chat')
    expect(o.texto).not.toContain('por este chat.')
  })

  it('el plazo del saldo sale de la campaña: «1 día antes» o «N días antes»', () => {
    const con = (dias: number) => generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: { dias_saldo_antes: dias }, funciones: AGENDA, ahoraMs: AHORA })
    expect(con(1).texto).toContain('✨ Reserva con $100.000 por cupo y paga el saldo 1 día antes.')
    expect(con(3).texto).toContain('✨ Reserva con $100.000 por cupo y paga el saldo 3 días antes.')
    expect(con(3).texto).not.toContain('1 día antes')
    // Con abonos distintos entre funciones, el plazo también es el de la campaña.
    const varios = generarOferta({
      ficha: FICHA, negocio: NEGOCIO, campana: { dias_saldo_antes: 2 }, ahoraMs: AHORA,
      funciones: [funcion(SAB_1PM), funcion(DOM_8PM, tarifa({ abono_persona: 120_000 }))],
    })
    expect(varios.texto).toContain('✨ Reserva con un abono por cupo y paga el saldo 2 días antes.')
    // Un plazo que la base no deja guardar (0, decimal) no se inventa: sale «[FALTA: …]» y no se copia.
    for (const malo of [0, 1.5]) {
      const g = con(malo)
      expect(g.faltantes).toEqual(['días antes para el saldo'])
      expect(g.copiable).toBe(false)
    }
    // Sin abono no hay línea de saldo: el plazo no aparece.
    const sinAbono = generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: { dias_saldo_antes: 4 }, ahoraMs: AHORA, funciones: [funcion(SAB_1PM, tarifa({ abono_persona: null }))] })
    expect(sinAbono.texto).not.toMatch(/saldo/)
  })

  it('si el precio regular cambia entre funciones va debajo de cada una; la preventa vencida (tarifa completa) no se anuncia', () => {
    const t = generarOferta({
      ficha: FICHA, negocio: NEGOCIO, campana: CAMPANA, ahoraMs: AHORA,
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
    const t = generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: CAMPANA, funciones: todas, ahoraMs: AHORA }).texto
    expect(t.match(/de octubre, /g)).toHaveLength(1)
  })

  it('pasado el límite de 2.200 caracteres no corta: dice cuánto sobra y qué se podría recortar', () => {
    const muchas = Array.from({ length: 60 }, (_, i) => funcion(new Date(Date.parse(SAB_1PM) + i * 3_600_000).toISOString(), preventa('2026-10-15')))
    const g = generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: CAMPANA, funciones: muchas, ahoraMs: AHORA })
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
  const d = generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'El extraño mundo de Jack · octubre', ...CAMPANA }, funciones: AGENDA, ahoraMs: AHORA })

  it('va sin la intro (23-oct): título, gancho, qué incluye, precio y los horarios aparte', () => {
    expect(d.texto).not.toContain(FICHA.intro!)
    expect(d.texto).not.toContain('Vive una experiencia inmersiva')
    expect(d.texto.split('\n\n').slice(0, 3)).toEqual([
      FICHA.titulo_oferta,
      FICHA.frase_gancho,
      '✨ INCLUYE:\n🍽️ 5 tiempos inspirados en la película\n🥂 2 bebidas especiales\n🎬 Proyección de la película',
    ])
    expect(d.texto).toContain('💳 Te enviamos el link de pago por este chat')
    expect(d.texto).toContain('paga el saldo 1 día antes.')
    // Sin intro en la ficha, el directo no la pide (el post sí).
    const sinIntro = { ...FICHA, intro: null }
    expect(generarMensajeDirecto({ ficha: sinIntro, negocio: NEGOCIO, campana: { nombre: 'Jack', ...CAMPANA }, funciones: AGENDA, ahoraMs: AHORA }).faltantes).toEqual([])
    expect(generarOferta({ ficha: sinIntro, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA, ahoraMs: AHORA }).faltantes).toEqual(['intro'])
  })

  it('con la ficha real de Jack, su dirección y el nombre de campaña que pone ONE, cabe con margen bajo 1.000 bytes', () => {
    const real = generarMensajeDirecto({
      ficha: FICHA, negocio: { ...NEGOCIO, direccion: 'AK 9 #104A-50, Bogotá' },
      campana: { nombre: 'El extraño mundo de Jack octubre', dias_saldo_antes: 1 },
      funciones: [funcion(SAB_1PM, preventa('2026-10-15'))], ahoraMs: AHORA,
    })
    expect(real.copiable).toBe(true)
    // Medido el 23-oct: 771 bytes y 693 caracteres (con la intro, que pesa 192 bytes, eran 965). Con el nombre de
    // campaña más largo (200 caracteres) sigue cabiendo con un plazo de dos cifras.
    expect([real.bytes, real.caracteres]).toEqual([771, 693])
    expect(real.bytes + contarBytes(`${FICHA.intro}\n\n`)).toBe(965)
    const largo = generarMensajeDirecto({
      ficha: FICHA, negocio: { ...NEGOCIO, direccion: 'AK 9 #104A-50, Bogotá' },
      campana: { nombre: 'J'.repeat(200), dias_saldo_antes: 30 }, funciones: AGENDA, ahoraMs: AHORA,
    })
    expect(largo.bytes).toBeLessThanOrEqual(LIMITE_DIRECTO_BYTES)
  })

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
      ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'Jack', ...CAMPANA }, ahoraMs: AHORA,
      funciones: [funcion(SAB_1PM, preventa('2026-10-15', 170_000)), funcion(DOM_8PM, tarifa({ tarifa: 'preventa', precio_persona: 160_000, precio_completo_persona: 190_000, preventa_hasta: '2026-10-20' }))],
    }).texto
    expect(t).toContain('🎟️ Preventa en algunos horarios: te contamos el precio con cada horario.\n🎫 Boletería regular: te contamos el precio con cada horario.')
    expect(t).not.toMatch(/\$1[6-9]0\.000/)
  })

  it('cuenta BYTES: tildes y ñ pesan 2 y los emojis 4', () => {
    expect([contarCaracteres('ñ'), contarBytes('ñ'), contarCaracteres('🎃'), contarBytes('🎃')]).toEqual([1, 2, 1, 4])
    expect(d.bytes).toBe(new TextEncoder().encode(d.texto).length)
    expect(d.bytes).toBeGreaterThan(d.caracteres)
    // Sin la intro, la ficha de Jack cabe con los dos nombres de campaña.
    expect(d.bytes).toBeLessThanOrEqual(LIMITE_DIRECTO_BYTES)
    const corto = generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'Jack', ...CAMPANA }, funciones: AGENDA, ahoraMs: AHORA })
    expect(corto.bytes).toBeLessThanOrEqual(LIMITE_DIRECTO_BYTES)
    expect(corto.copiable).toBe(true)
  })

  it('pasado el límite dice cuántos bytes sobran y no corta', () => {
    const larga = { ...FICHA, que_incluye: [...FICHA.que_incluye!, ...Array.from({ length: 9 }, (_, i) => `🎁 Ñandú mágico número ${i + 1} 🎃`)] }
    const g = generarMensajeDirecto({ ficha: larga, negocio: NEGOCIO, campana: { nombre: 'Jack', ...CAMPANA }, funciones: AGENDA, ahoraMs: AHORA })
    expect(g.bytes).toBeGreaterThan(LIMITE_DIRECTO_BYTES)
    // Por caracteres cabría: lo que manda son los bytes.
    expect(g.caracteres).toBeLessThan(LIMITE_DIRECTO_BYTES)
    expect(g.sobra).toBe(g.bytes - LIMITE_DIRECTO_BYTES)
    expect(g.limite).toEqual({ unidad: 'bytes', maximo: 1000 })
    expect(g.recortaria[0]).toEqual({ parte: 'qué incluye', medida: contarBytes(larga.que_incluye.join('\n')) })
    expect(g.recortaria.map((r) => r.parte)).not.toContain('la intro')
    // Pasado el límite se queda el bloqueo de copiar (23-oct).
    expect(g.copiable).toBe(false)
    expect(g.texto).toContain('🎁 Ñandú mágico número 9 🎃')
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
    expect(b.texto.startsWith(FICHA.saludo_grupo!)).toBe(true)
    expect(b.copiable).toBe(true)
  })

  it('las frases con tema van solo en el saludo de la experiencia; la recepción del negocio queda sin tema', () => {
    const [saludo, resto] = [b.texto.slice(0, FICHA.saludo_grupo!.length), b.texto.slice(FICHA.saludo_grupo!.length)]
    for (const frase of ['Jack tiene todo preparado', 'nuestro pequeño rincón entre Halloween Town y Christmas Town']) {
      expect(saludo).toContain(frase)
      expect(resto).not.toContain(frase)
    }
    expect(b.texto).toContain(
      '📍 LUGAR\n[EJEMPLO] Calle 100 #10-10, Bogotá – Segundo piso\n\n' +
        'Al llegar, en el primer piso encontrarán personal de nuestro staff que los recibirá y les indicará por dónde ingresar.\n\n🚗 PARQUEADERO',
    )
    // La parte fija de la plantilla (todo menos el saludo y el relato) no nombra la película.
    const fijo = resto.slice(0, resto.indexOf(FICHA.relato_grupo!))
    expect(fijo).not.toMatch(/Jack|Halloween|Christmas|Navidad/)
  })

  it('pagos pendientes: el texto aprobado (23-oct), sin otro medio de pago', () => {
    expect(b.texto.split('\n\n')).toEqual(expect.arrayContaining(['💰 PAGOS PENDIENTES', 'Recuerden pagar el saldo con el link de pago que les enviamos por el chat de su reserva.']))
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

describe('la puerta cerrada es una opción de cada experiencia (26-oct)', () => {
  const PUERTA = '⏰ ¡MUY IMPORTANTE!\n\nLes recomendamos llegar puntualmente. Para disfrutar de la experiencia completa y ' +
    'conservar la magia de nuestra celebración, una vez iniciemos cerraremos la puerta de ingreso para evitar interrupciones. 🚪'
  const LLEGADA = '🕐 LLEGADA: 12:50 p. m.\n✨ INICIAMOS: 1:10 p. m. puntual.'
  const con = (puerta_cerrada: boolean | null | undefined) =>
    generarBienvenida({ ficha: { ...FICHA, puerta_cerrada }, negocio: NEGOCIO, funcion: { inicia_at: SAB_1PM } }).texto

  it('marcada: sale el párrafo, justo después de la llegada y antes del lugar', () => {
    expect(con(true)).toContain(`${LLEGADA}\n\n${PUERTA}\n\n📍 LUGAR`)
  })

  it('sin marcar, nula o sin el campo (fichas de antes): no sale y la llegada pega con el lugar', () => {
    const { puerta_cerrada: _, ...sinCampo } = FICHA
    const sin = generarBienvenida({ ficha: sinCampo, negocio: NEGOCIO, funcion: { inicia_at: SAB_1PM } }).texto
    for (const t of [con(false), con(null), con(undefined), sin]) {
      expect(t).not.toContain('MUY IMPORTANTE')
      expect(t).not.toContain('puerta')
      expect(t).toContain(`${LLEGADA}\n\n📍 LUGAR`)
      expect(t).not.toContain('\n\n\n')
    }
  })

  it('la llegada 10 minutos antes sale siempre, con o sin puerta', () => {
    for (const t of [con(true), con(false)]) expect(t).toContain(LLEGADA)
    // Lo único que cambia es el párrafo de la puerta.
    expect(con(true).replace(`${PUERTA}\n\n`, '')).toBe(con(false))
  })
})

describe('campos vacíos, textos libres y pago', () => {
  const VACIA: FichaTextos = { titulo_oferta: null, frase_gancho: ' ', intro: null, que_incluye: [], emojis_tema: null, saludo_grupo: null, relato_grupo: null }
  const SIN_LUGAR: NegocioTextos = { direccion: null, piso: null, recepcion: null, parqueadero: null, firma: null }

  it('un campo vacío sale «[FALTA: campo]», va en los faltantes y el texto no se deja copiar', () => {
    const o = generarOferta({ ficha: VACIA, negocio: SIN_LUGAR, campana: CAMPANA, funciones: [funcion(SAB_1PM, tarifa({ precio_persona: null }))], ahoraMs: AHORA })
    expect(o.faltantes).toEqual(['título de la oferta', 'frase gancho', 'intro', 'qué incluye', 'precio regular', 'dirección', 'emojis del tema'])
    for (const c of o.faltantes) expect(o.texto).toContain(`[FALTA: ${c}]`)
    expect([o.copiable, o.motivo]).toEqual([false, `Falta en la ficha: ${o.faltantes.join(', ')}.`])

    const sinFunciones = generarMensajeDirecto({ ficha: FICHA, negocio: NEGOCIO, campana: { nombre: 'Jack', ...CAMPANA }, funciones: [], ahoraMs: AHORA })
    expect(sinFunciones.faltantes).toEqual(['funciones a la venta'])
    expect(sinFunciones.copiable).toBe(false)

    const b = generarBienvenida({ ficha: VACIA, negocio: SIN_LUGAR, funcion: { inicia_at: SAB_1PM } })
    expect(b.faltantes).toEqual(['saludo del grupo', 'dirección', 'piso', 'recepción', 'parqueadero', 'relato de cierre del grupo', 'firma'])
    expect(b.copiable).toBe(false)
    // Las horas salen igual: son de la función, no de la ficha.
    expect(b.texto).toContain('🕐 LLEGADA: 12:50 p. m.')
  })

  it('la preventa sin precio sale «[FALTA: precio de preventa]»; sin fecha de fin, sin paréntesis', () => {
    const o = generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: CAMPANA, ahoraMs: AHORA, funciones: [funcion(SAB_1PM, tarifa({ tarifa: 'preventa', precio_persona: null, precio_completo_persona: 180_000 }))] })
    expect(o.texto).toContain('🎟️ Preventa: [FALTA: precio de preventa] por persona\n🎫 Boletería regular: $180.000')
    expect(o.faltantes).toEqual(['precio de preventa'])
  })

  it('los textos libres van tal cual: emojis, saltos de línea y espacios de adentro', () => {
    const rara = { ...FICHA, intro: 'Línea 1 🕯️🖤\n\nLínea   2 ✨', saludo_grupo: '🎃💀 Hola\n¡Bienvenidos! 🌙' }
    expect(generarOferta({ ficha: rara, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA, ahoraMs: AHORA }).texto).toContain('\n\nLínea 1 🕯️🖤\n\nLínea   2 ✨\n\n')
    expect(generarBienvenida({ ficha: rara, negocio: NEGOCIO, funcion: { inicia_at: SAB_1PM } }).texto.startsWith('🎃💀 Hola\n¡Bienvenidos! 🌙\n\n')).toBe(true)
  })

  it('si la ficha o el lugar mencionan Nequi o Daviplata, sale un AVISO que no bloquea copiar (23-oct)', () => {
    const conNequi = generarOferta({ ficha: { ...FICHA, intro: 'Paga por Nequi.' }, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA, ahoraMs: AHORA })
    expect(conNequi.copiable).toBe(true)
    expect(conNequi.motivo).toBeNull()
    expect(conNequi.avisos).toEqual([AVISO_OTRO_PAGO])
    const conDavi = generarBienvenida({ ficha: FICHA, negocio: { ...NEGOCIO, recepcion: 'Pagos por DaviPlata' }, funcion: { inicia_at: SAB_1PM } })
    expect([conDavi.copiable, conDavi.avisos]).toEqual([true, [AVISO_OTRO_PAGO]])
    const conDaviDirecto = generarMensajeDirecto({ ficha: { ...FICHA, frase_gancho: 'Davi plata o Nequi' }, negocio: NEGOCIO, campana: { nombre: 'Jack', ...CAMPANA }, funciones: AGENDA, ahoraMs: AHORA })
    expect([conDaviDirecto.copiable, conDaviDirecto.avisos]).toEqual([true, [AVISO_OTRO_PAGO]])
    // Sin mención, sin aviso.
    expect(generarOferta({ ficha: FICHA, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA, ahoraMs: AHORA }).avisos).toEqual([])
    // El aviso no tapa los bloqueos: con Nequi y un campo vacío, sigue sin copiarse por el campo.
    const ambos = generarOferta({ ficha: { ...FICHA, intro: 'Nequi', titulo_oferta: null }, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA, ahoraMs: AHORA })
    expect([ambos.copiable, ambos.avisos.length, ambos.motivo]).toEqual([false, 1, 'Falta en la ficha: título de la oferta.'])
  })

  it('pesos con punto de miles', () => {
    expect([pesosTexto(170_000), pesosTexto(1_800_000), pesosTexto(950)]).toEqual(['$170.000', '$1.800.000', '$950'])
  })
})

describe('una cata de vino (26-oct): la experiencia no es una película', () => {
  // Sabor también hace catas de vino, clases de sushi y otras experiencias con horarios, precios y cupo (visita del
  // 23-oct). Ficha de EJEMPLO, sin nada de cine: lo que diga el texto de cine solo puede venir de la parte fija.
  const CATA: FichaTextos = {
    titulo_oferta: '🍷🍇 CATA DE VINOS DEL VALLE DE UCO llega a BOGOTÁ ✨',
    frase_gancho: '¿Listo para recorrer Mendoza copa a copa? 🍷✨',
    intro: '[EJEMPLO] Una noche guiada por un sommelier, con cinco vinos de altura y su maridaje.',
    que_incluye: ['🍷 5 vinos del Valle de Uco', '🧀 Tabla de quesos y maridaje', '👩‍🍳 Guía de un sommelier'],
    emojis_tema: '🍷🍇',
    saludo_grupo: '🍷 ¡Hola, amantes del vino!\n\n¡Bienvenidos al grupo oficial de la cata!',
    relato_grupo: '🍇 ¡Que comience nuestra cata!',
    // Un taller: la puerta no se cierra (Paula, 26-oct).
    puerta_cerrada: false,
  }
  const CINE = /pel[ií]cula|\bcine\b|proyecci|🎬/i
  const AGENDA_CATA = [funcion(SAB_1PM, preventa('2026-10-15', 150_000)), funcion(DOM_8PM, tarifa({ precio_persona: 160_000, abono_persona: 60_000 }))]

  it('la oferta, el mensaje directo y la bienvenida salen completos y ninguno menciona película, cine ni proyección', () => {
    const o = generarOferta({ ficha: CATA, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA_CATA, ahoraMs: AHORA })
    const d = generarMensajeDirecto({
      ficha: CATA, negocio: NEGOCIO, campana: { nombre: 'Cata de vinos del Valle de Uco · octubre', ...CAMPANA }, funciones: AGENDA_CATA, ahoraMs: AHORA,
    })
    const b = generarBienvenida({ ficha: CATA, negocio: NEGOCIO, funcion: { inicia_at: SAB_1PM } })
    for (const g of [o, d, b]) {
      expect(g.faltantes).toEqual([])
      expect(g.copiable).toBe(true)
      expect(g.texto).not.toMatch(CINE)
    }
    expect(o.texto.startsWith(`${CATA.titulo_oferta}\n\n${CATA.frase_gancho}\n\n${CATA.intro}`)).toBe(true)
    expect(o.texto).toContain('✨ INCLUYE:\n🍷 5 vinos del Valle de Uco\n🧀 Tabla de quesos y maridaje\n👩‍🍳 Guía de un sommelier')
    expect(o.texto).toContain('🍷🍇 ¡Cupos limitados!')
    expect(fechasDelTexto(o.texto, datosAgenda(AGENDA_CATA))).toEqual([])
    expect(d.bytes).toBeLessThanOrEqual(LIMITE_DIRECTO_BYTES)
    expect(b.texto.startsWith(CATA.saludo_grupo!)).toBe(true)
    // Una cata no cierra la puerta (26-oct): no sale el aviso; la llegada sí.
    expect(b.texto).not.toContain('puerta')
    expect(b.texto).toContain('🕐 LLEGADA: 12:50 p. m.')
    expect(fechasDelTexto(b.texto, [{ fecha: '2026-10-24', hora: SAB_1PM }], [0, -10, 10])).toEqual([])
  })

  it('la prueba muerde: una ficha con «película» sí la detecta', () => {
    const conCine = generarOferta({ ficha: { ...CATA, intro: 'Cena y película' }, negocio: NEGOCIO, campana: CAMPANA, funciones: AGENDA_CATA, ahoraMs: AHORA })
    expect(conCine.texto).toMatch(CINE)
  })
})
