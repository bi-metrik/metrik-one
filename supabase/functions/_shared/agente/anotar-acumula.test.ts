import { describe, expect, it } from 'vitest'
import { escritosDelViaje, opcionesNombradas, planDeCarga, regresoPorNoches } from './bandeja/carga'
import { opcionNombrada } from './bandeja/dominio'
import { escenario } from './escenario'
import type { ExtractorMemoria } from './memoria'
import { modeloGuionado } from './modelo-guionado'
import { propuestaVigente, salidaPropuesta, sinLineasDelResumen, TEXTO_PROPUESTA_PENDIENTE } from './nucleo'
import { respaldoDe, verificar } from './verificador'
import type { CampoEntendible } from '../wa-entendimiento-reglas'
import type { FilaConversacion, Salida } from './tipos'

/**
 * Segunda falla en vivo del núcleo (2026-10-07, bandeja de Trappvel, número de prueba): «me pide información repetida
 * y no va guardando, parece que sobreescribiera». Rehecha con datos INVENTADOS (otra clienta, otro destino, otras
 * fechas, otra categoría, otra ciudad):
 *   1. pregunta qué hay abierto → lista.
 *   2. «No, pero este es nuevo a Santa Marta, entonces sí ábrelo» → el respaldo proponía lo mismo con «Sí, abrimos…»
 *      (falso) y salía SOLO ese texto, sin botones.
 *   3. da las noches, la salida y los pasajeros con el botón pendiente → se perdían.
 *   4. toca Sí → «Abrí…» pedía lo que ya había dicho.
 *   5. repite y agrega «3 o 4 estrellas» → quedaba en 3, sin regreso.
 *   6. «salen desde medellín» 3 s después → REEMPLAZABA la pendiente; el toque guardaba solo la ciudad.
 *   8. «calcula tú el regreso» → «No había datos nuevos».
 * La verdad es el estado final del viaje en la base (en memoria). El modelo de la conversación y el de la extracción
 * son guiones: ninguna llamada a un modelo real.
 */

const LUCIA = { id: 'c-lucia', nombre: 'LUCIA BARRERA', celular: '3015557310' }
const ref = 'Lucia Barrera (cel. …7310)'
const VIAJES = [
  { id: 'v-1', codigo: 'L1 26 1', contactoId: 'c-lucia', nombre: 'CARTAGENA', destino: 'Cartagena', abierto: true, datos: {} },
  { id: 'v-2', codigo: 'L1 26 2', contactoId: 'c-lucia', nombre: 'MIAMI', destino: 'Miami', abierto: true, datos: {} },
]
const NUEVO = 'L1 26 3'

/** La forma de la config de una línea de viajes (no son datos de nadie). */
const CAMPOS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  { slug: 'ciudad_origen', tipo: 'texto', label: 'Ciudad de salida', nivel: 'minimo', pregunta: '¿Desde dónde salen?' },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Fecha de regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Niños?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Bebés?' },
  { slug: 'numero_pasajeros', tipo: 'numero', label: 'Número de pasajeros', suma_de: ['adultos', 'ninos', 'infantes'] },
  { slug: 'edades_menores', tipo: 'texto', label: 'Edades de los niños e infantes', nivel: 'minimo', pregunta: '¿Edades?', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
  { slug: 'categoria_hotel', tipo: 'select', label: 'Categoría de hotel', nivel: 'minimo', pregunta: '¿Categoría?', opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: '5', label: '5 estrellas' }, { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true }] },
  { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos especiales', nivel: 'deseable', pregunta: '¿Algo especial?' },
] as CampoEntendible[]

const M0 = 'Abre un viaje nuevo a Santa Marta para Lucía Barrera'
const M1 = 'dime antes si tenemos algo abierto con Lucía Barrera'
const M2 = 'No, pero este es nuevo a Santa Marta, entonces sí ábrelo.'
const M3 = 'Son 4 noches, desde el 3 de diciembre para que viaje ella con su esposo y su hija de 1 año.'
const M5 = 'Son 4 noches desde el 3 de diciembre, ella con su esposo y la hija de 1 año. La categoría puede ser 3 o 4 estrellas'
const M6 = 'salen desde medellín'
const M8 = 'Salen desde Medellín. Calcula tú la fecha de regreso.'
const LISTA = 'Lucia Barrera tiene 2 viajes abiertos: L1 26 1 Cartagena y L1 26 2 Miami. ¿Abro el nuevo a Santa Marta?'
const VIAJE_NUEVO = { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'Santa Marta' } }

type Valores = Record<string, { valor: string; frase: string }>
/** La salida cruda de la extracción, como la devuelve Gemini: todos los mensajes del cliente (el comercial relata). */
function crudo(textos: string[], valores: Valores) {
  const todos: Valores = Object.fromEntries(CAMPOS.map((f) => [f.slug, { valor: 'por_definir', frase: '' }]))
  return { mensajes: textos.map((_, i) => ({ n: i + 1, clase: 'cliente' })), citas: [], solicitudes: [{ destino: 'Santa Marta', frase: 'Santa Marta' }], cliente: {}, valores: { ...todos, ...valores } }
}

/** El guion de la extracción, llamado por llamado. Como en vivo, la de los turnos 6 y 8 solo ve el dato nuevo. */
function extraccionGuionada(): ExtractorMemoria {
  const guion: Valores[] = [
    // Tras el toque de [Sí, ábrelo]: lo que dijo mientras el botón esperaba.
    {
      fecha_salida: { valor: '2026-12-03', frase: 'desde el 3 de diciembre' },
      adultos: { valor: '2', frase: 'ella con su esposo' },
      infantes: { valor: '1', frase: 'su hija de 1 año' },
      edades_menores: { valor: '1', frase: 'su hija de 1 año' },
    },
    // Turno 5: repite la salida y los adultos, agrega la categoría; NO devuelve los infantes (la unión los conserva).
    {
      fecha_salida: { valor: '2026-12-03', frase: 'desde el 3 de diciembre' },
      adultos: { valor: '2', frase: 'ella con su esposo' },
      categoria_hotel: { valor: '3', frase: 'La categoría puede ser 3 o 4 estrellas' },
    },
    // Turno 6: solo la ciudad.
    { ciudad_origen: { valor: 'Medellín', frase: 'salen desde medellín' } },
    // Turno 8: lo mismo otra vez.
    { ciudad_origen: { valor: 'Medellín', frase: 'Salen desde Medellín' } },
  ]
  return async ({ textos }) => {
    const v = guion.shift()
    if (!v) throw new Error('guion de extracción agotado')
    return crudo(textos, v)
  }
}

function guionConversacion() {
  return modeloGuionado([
    // 0. pide abrir
    { name: 'buscar', args: { texto: 'Lucía Barrera' } },
    { name: 'proponer', args: VIAJE_NUEVO },
    // 1. pregunta qué hay abierto
    { name: 'buscar', args: { texto: 'Lucía Barrera' } },
    { name: 'responder', args: { tema: 'solicitud', texto: LISTA } },
    // 2. «sí, ábrelo»: el respaldo repite la propuesta con un hecho falso; el verificador lo devuelve y sale sin él
    { name: 'proponer', args: { ...VIAJE_NUEVO, texto: 'Sí, abrimos el nuevo viaje a Santa Marta.' } },
    { name: 'proponer', args: VIAJE_NUEVO },
    // 3. los datos con el botón pendiente: otra vez viaje_nuevo
    { name: 'proponer', args: VIAJE_NUEVO },
    // 5. intenta cargar_tanda (no hay reenvíos), luego anotar con la primera línea del resumen como texto
    { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: NUEVO } } },
    { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: NUEVO, texto: 'La categoría puede ser 3 o 4 estrellas' }, texto: `¿Lo anoto en ${NUEVO} · SANTA MARTA?` } },
    // 6. «salen desde medellín»: anotar SOLO con la ciudad
    { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: NUEVO, texto: 'salen desde medellín' } } },
    // 8. lo mismo + «calcula tú el regreso»: no hay nada nuevo; el candado lo devuelve y el modelo contesta
    { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: NUEVO, texto: 'Salen desde Medellín' } } },
    { name: 'responder', args: { tema: 'viaje', texto: 'Eso ya está en el viaje, con el regreso calculado.' } },
  ])
}

const textoDe = (s: Salida[]) => s.map((x) => x.texto).join('\n')

describe('segunda falla en vivo 2026-10-07: lo dicho se acumula y se guarda', () => {
  it('la secuencia completa: al final el viaje tiene todo lo dicho y el bot no pidió nada dos veces', async () => {
    const modelo = guionConversacion()
    const e = await escenario({ modelo, contactos: [LUCIA], viajes: VIAJES, campos: CAMPOS, extraer: extraccionGuionada() })

    const t0 = await e.escribe(M0)
    expect(t0[0].tipo).toBe('botones')
    const pendienteViaje = propuestaVigente(e.almacen.filas)!

    const t1 = await e.escribe(M1)
    expect(t1).toEqual([{ tipo: 'texto', texto: LISTA }])

    // 2. El «abrimos» no sale (no se abrió nada) y la pendiente vuelve CON sus botones, misma huella.
    const t2 = await e.escribe(M2)
    expect(textoDe(t2)).not.toMatch(/abrimos/i)
    expect(t2).toEqual([salidaPropuesta(pendienteViaje, TEXTO_PROPUESTA_PENDIENTE)])
    expect(e.trazas().at(-1)!.verificador?.[0]?.motivo).toContain('abrimos')

    // 3. Los datos con el botón pendiente: el botón vuelve; los datos quedan en la conversación.
    const t3 = await e.escribe(M3)
    expect(t3[0].tipo).toBe('botones')
    expect(propuestaVigente(e.almacen.filas)!.huella).toBe(pendienteViaje.huella)

    // 4. El toque abre el viaje y propone de una vez lo que ya dijo (sin escribirlo): no pide lo dicho.
    const t4 = await e.toca('Sí, ábrelo')
    expect(t4[0].tipo).toBe('botones')
    expect(t4[0].texto).toContain(`Abrí ${NUEVO} · Santa Marta para Lucia Barrera.`)
    expect(t4[0].texto).toContain(`¿Lo anoto en ${NUEVO} · SANTA MARTA?`)
    expect(t4[0].texto).toContain('• Fecha de salida: 3 dic')
    expect(t4[0].texto).toContain('• Fecha de regreso: 7 dic')
    expect(t4[0].texto).toContain('• Adultos: 2')
    expect(t4[0].texto).toContain('• Infantes: 1')
    expect(t4[0].texto).not.toMatch(/Reenvíame/)
    // Niños no lo dijo con todas sus letras («sin niños»): la extracción de hoy no pone 0 sin eso, así que se pregunta.
    expect(t4[0].texto).toMatch(/Para cotizar faltaría: Ciudad de salida, Niños, Categoría de hotel\./)
    // La extracción vio lo que dijo antes de abrir (no solo el último mensaje).
    expect(e.puerto.extracciones[0]).toEqual([M0, M1, M2, M3])
    // Nada escrito todavía en el viaje.
    expect(e.puerto.viajes.find((v) => v.codigo === NUEVO)!.datos).toEqual({})

    // 5. Repite y agrega «3 o 4 estrellas»: se UNE con la pendiente (los infantes no se pierden), el rango no queda
    //    en 3 y la pregunta del resumen no sale dos veces.
    const t5 = await e.escribe(M5)
    expect(t5[0].tipo).toBe('botones')
    const r5 = t5[0].texto
    expect(r5.split('\n').filter((l) => l.startsWith('¿Lo anoto en'))).toHaveLength(1)
    expect(r5).toContain('• Infantes: 1')
    expect(r5).toContain('• Fecha de regreso: 7 dic')
    expect(r5).toContain('• Requisitos especiales: Categoría de hotel: 3 estrellas o 4 estrellas')
    expect(r5).not.toContain('• Categoría de hotel: 3 estrellas')
    expect(r5).toContain('Categoría de hotel (dijeron 3 estrellas o 4 estrellas: ¿cuál?)')
    expect(e.puerto.extracciones[1]).toEqual([M0, M1, M2, M3, M5])

    // 6. «salen desde medellín» 3 s después, antes de tocar: la nueva lleva TODO más la ciudad.
    const t6 = await e.escribe(M6, { despuesMs: 3_000 })
    const r6 = t6[0].texto
    for (const l of ['• Ciudad de salida: Medellín', '• Fecha de salida: 3 dic', '• Fecha de regreso: 7 dic', '• Adultos: 2', '• Infantes: 1', '• Requisitos especiales: Categoría de hotel: 3 estrellas o 4 estrellas']) {
      expect(r6).toContain(l)
    }

    expect(r6).not.toMatch(/faltaría:.*Ciudad de salida/)

    // 7. El toque de la VIEJA no se pierde ni escribe la mitad: muestra la de ahora; el de la nueva escribe todo.
    const viejo = await e.toca('Anotar', { atras: 1 })
    expect(viejo[0].texto.startsWith('Ese resumen ya cambió. Este es el de ahora:')).toBe(true)
    expect(viejo[0].texto).toContain('• Ciudad de salida: Medellín')
    const nuevo = await e.toca('Anotar')
    expect(nuevo[0].texto).toMatch(new RegExp(`^Cargué en ${NUEVO}: `))
    for (const l of ['Ciudad de salida', 'Fecha de salida', 'Fecha de regreso', 'Adultos', 'Infantes', 'Requisitos especiales']) expect(nuevo[0].texto).toContain(l)

    // 8. «calcula tú el regreso»: ya está; no se arma una propuesta vacía ni sale «No había datos nuevos».
    const t8 = await e.escribe(M8)
    expect(t8).toEqual([{ tipo: 'texto', texto: 'Eso ya está en el viaje, con el regreso calculado.' }])
    expect(e.trazas().at(-1)!.candados?.map((c) => c.candado)).toContain('sin_datos_nuevos')

    // La verdad: el estado final del viaje.
    const v = e.puerto.viajes.find((x) => x.codigo === NUEVO)!
    expect(v.datos).toMatchObject({
      ciudad_origen: 'MEDELLÍN',
      fecha_salida: '2026-12-03',
      fecha_regreso: '2026-12-07',
      adultos: 2,
      infantes: 1,
      edades_menores: '1',
      // El texto del bloque de viaje se guarda en mayúscula (regla de siempre).
      requisitos_especiales: 'CATEGORÍA DE HOTEL: 3 ESTRELLAS O 4 ESTRELLAS',
    })
    // La categoría no se eligió por el comercial: queda para que una persona escoja entre las dos.
    expect(v.datos.categoria_hotel).toBeUndefined()
    // Una sola carga, una sola apertura.
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['viaje', 'carga'])
    expect(modelo.restantes()).toBe(0)

    // Nunca pidió de nuevo lo que ya estaba dicho: ninguna línea de «falta» del bot nombra un dato que ya dio.
    const delBot = e.almacen.filas.filter((f) => f.direccion === 'saliente').map((f) => f.texto ?? '')
    const faltas = delBot.flatMap((t) => t.split('\n')).filter((l) => /falta/i.test(l))
    for (const dato of ['Fecha de salida', 'Fecha de regreso', 'Adultos', 'Infantes']) {
      expect(faltas.filter((l) => l.includes(dato))).toEqual([])
    }
  })
})

// ── Las piezas ───────────────────────────────────────────────────────────────

describe('regresoPorNoches', () => {
  it('salida + N noches; con letras también', () => {
    expect(regresoPorNoches(['Son 5 noches, desde el 11'], '2026-11-11')?.valor).toBe('2026-11-16')
    expect(regresoPorNoches(['serían cuatro noches'], '2026-12-30')?.valor).toBe('2027-01-03')
  })
  it('sin salida, con dos cantidades distintas o con «días», no deriva', () => {
    expect(regresoPorNoches(['5 noches'], undefined)).toBeNull()
    expect(regresoPorNoches(['5 noches', 'mejor 6 noches'], '2026-11-11')).toBeNull()
    expect(regresoPorNoches(['5 días'], '2026-11-11')).toBeNull()
  })
})

describe('opcionesNombradas («4 o 5 estrellas»)', () => {
  const cat = CAMPOS.find((f) => f.slug === 'categoria_hotel')!
  it('nombra las dos en la misma oración; «5 noches» en otra oración no cuenta', () => {
    expect(opcionesNombradas(cat, '4 o 5 estrellas', ['La categoría pueden ser 4 o 5 estrellas'])).toEqual(['4', '5'])
    expect(opcionesNombradas(cat, 'categoría 4', ['Son 5 noches, categoría 4'])).toEqual(['4'])
  })
})

describe('planDeCarga', () => {
  const bloques = [{ fields: CAMPOS, data: { destino: 'Santa Marta' } as Record<string, unknown> }]
  const base = { bloques, hoyISO: '2026-10-07', ahoraIso: '2026-10-07T20:00:00Z' }
  it('une con la pendiente: lo nuevo gana solo en el mismo campo', () => {
    const a = planDeCarga({ ...base, textos: ['van 2 adultos'], raw: crudo(['van 2 adultos'], { adultos: { valor: '2', frase: 'van 2 adultos' } }) })
    const b = planDeCarga({ ...base, textos: ['salen de Cali, mejor 3 adultos'], raw: crudo(['salen de Cali, mejor 3 adultos'], { ciudad_origen: { valor: 'Cali', frase: 'salen de Cali' }, adultos: { valor: '3', frase: 'mejor 3 adultos' } }), previo: a.plan })
    expect(b.plan.sugeridos.adultos.valor).toBe(3)
    expect(b.plan.sugeridos.ciudad_origen.valor).toBe('Cali')
    const c = planDeCarga({ ...base, textos: ['salen de Cali'], raw: crudo(['salen de Cali'], { ciudad_origen: { valor: 'Cali', frase: 'salen de Cali' } }), previo: a.plan })
    expect(c.plan.sugeridos.adultos.valor).toBe(2)
  })
  it('lo que el viaje ya tiene no sale en el resumen', () => {
    const p = planDeCarga({ ...base, bloques: [{ fields: CAMPOS, data: { destino: 'Santa Marta', adultos: 2 } }], textos: ['van 2 adultos'], raw: crudo(['van 2 adultos'], { adultos: { valor: '2', frase: 'van 2 adultos' } }) })
    expect(p.entendido).toEqual([])
  })
  it('un rango en un campo de texto se guarda como lo dijeron; sin requisitos en la config, lo dice el resumen', () => {
    const texto = CAMPOS.map((f) => (f.slug === 'categoria_hotel' ? { slug: f.slug, tipo: 'texto', label: f.label, nivel: 'minimo' } : f)) as CampoEntendible[]
    const t = ['La categoría puede ser 4 o 5 estrellas']
    const enTexto = planDeCarga({ ...base, bloques: [{ fields: texto, data: {} }], textos: t, raw: crudo(t, { categoria_hotel: { valor: '4 o 5 estrellas', frase: '4 o 5 estrellas' } }) })
    expect(enTexto.plan.sugeridos.categoria_hotel.valor).toBe('4 o 5 estrellas')
    const sinReq = CAMPOS.filter((f) => f.slug !== 'requisitos_especiales')
    const p = planDeCarga({ ...base, bloques: [{ fields: sinReq, data: {} }], textos: t, raw: crudo(t, { categoria_hotel: { valor: '4', frase: '4 o 5 estrellas' } }) })
    expect(p.plan.sugeridos.categoria_hotel).toBeUndefined()
    expect(p.entendido).toContain('(sin guardar) Categoría de hotel: 4 estrellas o 5 estrellas: el campo es de una sola opción')
    expect(p.falta).toContain('Categoría de hotel (dijeron 4 estrellas o 5 estrellas: ¿cuál?)')
  })
})

describe('escritosDelViaje', () => {
  let n = 0
  const fila = (f: Partial<FilaConversacion>): FilaConversacion => ({ id: `f${++n}`, workspace_id: 'ws', phone: '57', direccion: 'entrante', clase: 'escrito', texto: null, turno_id: `t${n}`, created_at: `2026-10-07T10:00:${String(n).padStart(2, '0')}Z`, ...f })
  it('cada tramo desde que se nombró el viaje hasta que se nombró otro, más lo de este turno', () => {
    const filas = [
      fila({ texto: 'algo de antes' }),
      fila({ texto: 'en el A1 26 1 van 2 adultos' }),
      fila({ texto: 'salen el 3 de mayo' }),
      fila({ texto: 'y el B1 26 4 es otro' }),
      fila({ texto: 'del B: 1 niño' }),
      fila({ texto: 'para el A1 26 1 desde Cali', turno_id: null }),
    ]
    expect(escritosDelViaje(filas, 'A1 26 1', opcionNombrada)).toEqual(['en el A1 26 1 van 2 adultos', 'salen el 3 de mayo', 'para el A1 26 1 desde Cali'])
    // Lo de este turno que nombra otro viaje no es de B.
    expect(escritosDelViaje(filas, 'B1 26 4', opcionNombrada)).toEqual(['y el B1 26 4 es otro', 'del B: 1 niño'])
  })
})

describe('el resumen no repite su primera línea arriba', () => {
  it('quita las líneas que ya dice el resumen; si no queda nada, no hay arriba', () => {
    const resumen = '¿Lo anoto en L1 26 3 · SANTA MARTA?\n• Adultos: 2'
    expect(sinLineasDelResumen('¿Lo anoto en L1 26 3 · Santa Marta?', resumen)).toBe('')
    expect(sinLineasDelResumen('Va con la categoría.\n¿Lo anoto en L1 26 3 · SANTA MARTA?', resumen)).toBe('Va con la categoría.')
    const s = salidaPropuesta({ huella: 'h', resumen, si: 'Anotar', no: 'No' }, '¿Lo anoto en L1 26 3 · SANTA MARTA?')
    expect(s.texto).toBe(resumen)
  })
})

describe('el verificador ataja el hecho en plural', () => {
  const r = respaldoDe(['Santa Marta'])
  it('«abrimos el viaje» / «lo anotamos» no salen; «¿lo abrimos?» sí', () => {
    expect(verificar('Sí, abrimos el nuevo viaje a Santa Marta.', r).join()).toContain('abrimos')
    expect(verificar('Listo, lo anotamos.', r).join()).toContain('anotamos')
    expect(verificar('Lo anoté.', r).join()).toContain('anoté')
    expect(verificar('¿Lo abrimos a Santa Marta?', r)).toEqual([])
  })
})
