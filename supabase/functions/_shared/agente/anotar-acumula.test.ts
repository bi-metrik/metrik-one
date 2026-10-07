import { describe, expect, it } from 'vitest'
import { escritosDelViaje, planDeCarga } from './bandeja/carga'
import { esquemaCarga, instruccionesCarga, validarCarga } from './bandeja/extraccion'
import { opcionNombrada } from './bandeja/dominio'
import { escenario } from './escenario'
import { PuertoMemoria } from './memoria'
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
 * Desde el 2026-10-07 (Mauricio: «el modelo tiene que tener la capacidad de entender… no puede ser tan paramétrico»)
 * el regreso, la categoría con su matiz y el grupo los decide el MODELO de extracción; el código solo valida. El guion
 * de la extracción hace lo que haría el modelo y la prueba mira que el código lo respete.
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

type Valores = Record<string, { valor: string; frase: string; calculo?: string }>
/** La salida cruda de la extracción, como la devuelve Gemini. Sin `clases`, todos los mensajes son del viaje. */
function crudo(textos: string[], valores: Valores, clases?: string[]) {
  const todos: Valores = Object.fromEntries(CAMPOS.map((f) => [f.slug, { valor: 'por_definir', frase: '' }]))
  return { mensajes: textos.map((_, i) => ({ n: i + 1, clase: clases?.[i] ?? 'cliente' })), citas: [], valores: { ...todos, ...valores } }
}

/** El guion de la extracción, llamado por llamado: lo que el modelo clasifica y calcula. */
function extraccionGuionada(prompts: string[] = []): ExtractorMemoria {
  const regreso = { valor: '2026-12-07', frase: 'Son 4 noches', calculo: 'salida 2026-12-03 + 4 noches' }
  const guion: Valores[] = [
    // Tras el toque de [Sí, ábrelo]: lo que dijo mientras el botón esperaba. El modelo calcula el regreso y entiende el
    // grupo: ella, su esposo y su hija de 1 año = 2 adultos, 0 niños, 1 infante.
    {
      fecha_salida: { valor: '2026-12-03', frase: 'desde el 3 de diciembre' },
      fecha_regreso: regreso,
      adultos: { valor: '2', frase: 'ella con su esposo' },
      ninos: { valor: '0', frase: 'ella con su esposo y su hija de 1 año', calculo: 'la única menor es la hija de 1 año: infante' },
      infantes: { valor: '1', frase: 'su hija de 1 año' },
      edades_menores: { valor: '1', frase: 'su hija de 1 año' },
    },
    // Turno 5: «3 o 4 estrellas». El modelo elige la opción que mejor lo representa y deja el matiz en requisitos; NO
    // devuelve los niños ni los infantes (la unión con la pendiente los conserva).
    {
      fecha_salida: { valor: '2026-12-03', frase: 'desde el 3 de diciembre' },
      fecha_regreso: regreso,
      adultos: { valor: '2', frase: 'ella con su esposo' },
      categoria_hotel: { valor: '4', frase: 'La categoría puede ser 3 o 4 estrellas' },
      requisitos_especiales: { valor: 'Hotel de 3 o 4 estrellas', frase: 'La categoría puede ser 3 o 4 estrellas' },
    },
    // Turno 6: solo la ciudad.
    { ciudad_origen: { valor: 'Medellín', frase: 'salen desde medellín' } },
    // Turno 8: la ciudad otra vez y el regreso que ya está.
    { ciudad_origen: { valor: 'Medellín', frase: 'Salen desde Medellín' }, fecha_regreso: regreso },
  ]
  return async ({ textos, instrucciones }) => {
    prompts.push(instrucciones)
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
    const prompts: string[] = []
    const e = await escenario({ modelo, contactos: [LUCIA], viajes: VIAJES, campos: CAMPOS, extraer: extraccionGuionada(prompts) })

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
    // El grupo lo entendió el modelo: 0 niños sin que nadie escribiera «sin niños».
    expect(t4[0].texto).toContain('• Niños: 0')
    expect(t4[0].texto).not.toMatch(/Reenvíame/)
    expect(t4[0].texto).toMatch(/Para cotizar faltaría: Ciudad de salida, Categoría de hotel\./)
    // La extracción vio lo que dijo antes de abrir (no solo el último mensaje), la fecha de hoy y las opciones.
    expect(e.puerto.extracciones[0]).toEqual([M0, M1, M2, M3])
    expect(prompts[0]).toMatch(/Hoy es \d{4}-\d{2}-\d{2}/)
    expect(prompts[0]).toContain('4 = 4 estrellas')
    // Nada escrito todavía en el viaje.
    expect(e.puerto.viajes.find((v) => v.codigo === NUEVO)!.datos).toEqual({})

    // 5. Repite y agrega «3 o 4 estrellas»: se UNE con la pendiente (niños e infantes no se pierden), la categoría
    //    queda en la que eligió el modelo, el matiz en requisitos, y la pregunta del resumen no sale dos veces.
    const t5 = await e.escribe(M5)
    expect(t5[0].tipo).toBe('botones')
    const r5 = t5[0].texto
    expect(r5.split('\n').filter((l) => l.startsWith('¿Lo anoto en'))).toHaveLength(1)
    expect(r5).toContain('• Infantes: 1')
    expect(r5).toContain('• Niños: 0')
    expect(r5).toContain('• Fecha de regreso: 7 dic')
    expect(r5).toContain('• Categoría de hotel: 4 estrellas')
    expect(r5).toContain('• Requisitos especiales: Hotel de 3 o 4 estrellas')
    expect(r5).toContain('Para cotizar faltaría: Ciudad de salida.')
    expect(r5).not.toMatch(/¿cuál\?/)
    expect(e.puerto.extracciones[1]).toEqual([M0, M1, M2, M3, M5])
    // Lo que el viaje ya tiene (de la pendiente no, del viaje sí) le llega al modelo: aquí el destino.
    expect(prompts[1]).toContain('- destino: Santa Marta')

    // 6. «salen desde medellín» 3 s después, antes de tocar: la nueva lleva TODO más la ciudad.
    const t6 = await e.escribe(M6, { despuesMs: 3_000 })
    const r6 = t6[0].texto
    for (const l of ['• Ciudad de salida: Medellín', '• Fecha de salida: 3 dic', '• Fecha de regreso: 7 dic', '• Adultos: 2', '• Niños: 0', '• Infantes: 1', '• Categoría de hotel: 4 estrellas', '• Requisitos especiales: Hotel de 3 o 4 estrellas']) {
      expect(r6).toContain(l)
    }
    expect(r6).toContain('Con esto queda el mínimo para cotizar.')

    // 7. El toque de la VIEJA no se pierde ni escribe la mitad: muestra la de ahora; el de la nueva escribe todo.
    const viejo = await e.toca('Anotar', { atras: 1 })
    expect(viejo[0].texto.startsWith('Ese resumen ya cambió. Este es el de ahora:')).toBe(true)
    expect(viejo[0].texto).toContain('• Ciudad de salida: Medellín')
    const nuevo = await e.toca('Anotar')
    expect(nuevo[0].texto).toMatch(new RegExp(`^Cargué en ${NUEVO}: `))
    for (const l of ['Ciudad de salida', 'Fecha de salida', 'Fecha de regreso', 'Adultos', 'Niños', 'Infantes', 'Categoría de hotel', 'Requisitos especiales']) expect(nuevo[0].texto).toContain(l)

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
      ninos: 0,
      infantes: 1,
      edades_menores: '1',
      categoria_hotel: '4',
      // El texto del bloque de viaje se guarda en mayúscula (regla de siempre).
      requisitos_especiales: 'HOTEL DE 3 O 4 ESTRELLAS',
    })
    // El regreso que calculó el modelo deja su cálculo en la marca del sugerido.
    expect((v.datos._sugeridos as Record<string, { deduccion?: string }>).fecha_regreso.deduccion).toBe('salida 2026-12-03 + 4 noches')
    // Una sola carga, una sola apertura.
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['viaje', 'carga'])
    expect(modelo.restantes()).toBe(0)

    // Nunca pidió de nuevo lo que ya estaba dicho: ninguna línea de «falta» del bot nombra un dato que ya dio.
    const delBot = e.almacen.filas.filter((f) => f.direccion === 'saliente').map((f) => f.texto ?? '')
    const faltas = delBot.flatMap((t) => t.split('\n')).filter((l) => /falta/i.test(l))
    for (const dato of ['Fecha de salida', 'Fecha de regreso', 'Adultos', 'Niños', 'Infantes']) {
      expect(faltas.filter((l) => l.includes(dato))).toEqual([])
    }
  })
})

// ── Las piezas ───────────────────────────────────────────────────────────────

describe('planDeCarga: el código respeta lo que clasificó el modelo', () => {
  const bloques = [{ fields: CAMPOS, data: { destino: 'Santa Marta' } as Record<string, unknown> }]
  const base = { bloques, hoyISO: '2026-10-07', ahoraIso: '2026-10-07T20:00:00Z' }
  const plan = (textos: string[], valores: Valores, extra: Partial<Parameters<typeof planDeCarga>[0]> = {}, clases?: string[]) =>
    planDeCarga({ ...base, textos, raw: crudo(textos, valores, clases), ...extra })

  it('une con la pendiente: lo nuevo gana solo en el mismo campo', () => {
    const a = plan(['van 2 adultos'], { adultos: { valor: '2', frase: 'van 2 adultos' } })
    const b = plan(['salen de Cali, mejor 3 adultos'], { ciudad_origen: { valor: 'Cali', frase: 'salen de Cali' }, adultos: { valor: '3', frase: 'mejor 3 adultos' } }, { previo: a.plan })
    expect(b.plan.sugeridos.adultos.valor).toBe(3)
    expect(b.plan.sugeridos.ciudad_origen.valor).toBe('Cali')
    const c = plan(['salen de Cali'], { ciudad_origen: { valor: 'Cali', frase: 'salen de Cali' } }, { previo: a.plan })
    expect(c.plan.sugeridos.adultos.valor).toBe(2)
  })

  it('lo que el viaje ya tiene no sale en el resumen', () => {
    const p = plan(['van 2 adultos'], { adultos: { valor: '2', frase: 'van 2 adultos' } }, { bloques: [{ fields: CAMPOS, data: { destino: 'Santa Marta', adultos: 2 } }] })
    expect(p.entendido).toEqual([])
  })

  it('«4 o 5 estrellas»: queda la opción que eligió el modelo y el matiz que él dejó en requisitos', () => {
    const t = ['La categoría puede ser 4 o 5 estrellas, ojalá con vista al mar']
    const p = plan(t, {
      categoria_hotel: { valor: '5', frase: 'La categoría puede ser 4 o 5 estrellas' },
      requisitos_especiales: { valor: 'Hotel de 4 o 5 estrellas, ojalá con vista al mar', frase: 'ojalá con vista al mar' },
    })
    expect(p.plan.sugeridos.categoria_hotel.valor).toBe('5')
    expect(p.plan.sugeridos.requisitos_especiales.valor).toBe('Hotel de 4 o 5 estrellas, ojalá con vista al mar')
    expect(p.entendido).toEqual(['Categoría de hotel: 5 estrellas', 'Requisitos especiales: Hotel de 4 o 5 estrellas, ojalá con vista al mar'])
    expect(p.falta).not.toContain('Categoría de hotel')
  })

  it('el regreso que calculó el modelo se respeta; si el modelo no lo da, el código no lo deriva', () => {
    const t = ['Son 5 noches, desde el 11 de noviembre']
    const p = plan(t, {
      fecha_salida: { valor: '2026-11-11', frase: 'desde el 11 de noviembre' },
      fecha_regreso: { valor: '2026-11-16', frase: 'Son 5 noches', calculo: 'salida 2026-11-11 + 5 noches' },
    })
    expect(p.plan.sugeridos.fecha_regreso).toEqual({ valor: '2026-11-16', frase: 'Son 5 noches', deduccion: 'salida 2026-11-11 + 5 noches' })
    expect(p.entendido).toContain('Fecha de regreso: 16 nov')
    const sin = plan(t, { fecha_salida: { valor: '2026-11-11', frase: 'desde el 11 de noviembre' } })
    expect(sin.plan.sugeridos.fecha_regreso).toBeUndefined()
    expect(sin.falta).toContain('Fecha de regreso')
  })

  it('el grupo lo entiende el modelo: 0 niños sin «sin niños», y cambia un número sin que la frase diga la cifra', () => {
    const t = ['él con su esposa y su hijo de 1 año']
    const p = plan(t, {
      adultos: { valor: '2', frase: 'él con su esposa' },
      ninos: { valor: '0', frase: 'él con su esposa y su hijo de 1 año' },
      infantes: { valor: '1', frase: 'su hijo de 1 año' },
    }, { bloques: [{ fields: CAMPOS, data: { destino: 'Santa Marta', adultos: 3, _sugeridos: { adultos: { fuente: 'whatsapp', entrega_id: 'agente', frase: 'van 3', en: '2026-10-07T10:00:00Z' } } } }] })
    expect(p.plan.sugeridos.ninos.valor).toBe(0)
    expect(p.entendido).toEqual(['Adultos: 2', 'Niños: 0', 'Infantes: 1'])
  })

  it('con el toque se escribe lo que el modelo entendió, aunque cambie un número sugerido sin decir la cifra', async () => {
    const t = ['al final va él con su esposa, sin el hermano']
    const puerto = new PuertoMemoria({
      contactos: [LUCIA],
      viajes: [{ id: 'v-9', codigo: 'L1 26 9', contactoId: 'c-lucia', nombre: 'SANTA MARTA', destino: 'Santa Marta', abierto: true, datos: { adultos: 3, _sugeridos: { adultos: { fuente: 'whatsapp', entrega_id: 'agente', frase: 'van 3', en: '2026-10-07T10:00:00Z' } } } }],
      campos: CAMPOS,
      extraer: async ({ textos }) => crudo(textos, { adultos: { valor: '2', frase: 'él con su esposa', calculo: 'él y su esposa' } }),
    })
    const prep = await puerto.prepararCarga('v-9', t)
    expect(prep.entendido).toEqual(['Adultos: 2'])
    await puerto.cargar('v-9', prep.plan)
    expect(puerto.viajes[0].datos.adultos).toBe(2)
  })

  it('fuera de las opciones, sin frase escrita o de un mensaje que el modelo no clasificó como del viaje: no entra', () => {
    const t = ['Promo: Santa Marta desde $900.000, hotel 5 estrellas', 'van 2 adultos']
    const p = plan(t, {
      categoria_hotel: { valor: '5', frase: 'hotel 5 estrellas' },
      adultos: { valor: '2', frase: 'van 2 adultos' },
      ciudad_origen: { valor: 'Cali', frase: 'salen de Cali' },
    }, {}, ['tercero', 'cliente'])
    expect(Object.keys(p.plan.sugeridos)).toEqual(['adultos'])
    const fuera = validarCarga(crudo(['quieren 6 estrellas'], { categoria_hotel: { valor: '6', frase: 'quieren 6 estrellas' } }), CAMPOS, ['quieren 6 estrellas'], { hoyISO: '2026-10-07' })
    expect(fuera.sugeridos.categoria_hotel).toBeUndefined()
    expect(fuera.descartados).toEqual([{ slug: 'categoria_hotel', motivo: 'fuera de las opciones: 6' }])
  })

  it('las invariantes de forma: entero, fecha real dentro de la ventana, regreso después de la salida, pedir_si', () => {
    const t = ['van dos y medio adultos el 30 de febrero, salen el 5 de enero de 2026 y vuelven el 20 de diciembre, edades 7']
    const v = validarCarga(crudo(t, {
      adultos: { valor: '2.5', frase: 'dos y medio adultos' },
      fecha_salida: { valor: '2026-12-22', frase: 'vuelven el 20 de diciembre' },
      fecha_regreso: { valor: '2026-12-20', frase: 'vuelven el 20 de diciembre' },
      edades_menores: { valor: '7', frase: 'edades 7' },
    }), CAMPOS, t, { hoyISO: '2026-10-07' })
    expect(v.sugeridos).toEqual({ fecha_salida: { valor: '2026-12-22', frase: 'vuelven el 20 de diciembre' } })
    expect(v.descartados.map((d) => d.slug).sort()).toEqual(['adultos', 'edades_menores', 'fecha_regreso'])
    for (const [valor, motivo] of [['2026-02-30', 'no es una fecha'], ['2026-01-05', 'fecha pasada'], ['2028-06-01', 'a más de 18 meses']]) {
      const x = validarCarga(crudo(t, { fecha_salida: { valor, frase: 'el 30 de febrero' } }), CAMPOS, t, { hoyISO: '2026-10-07' })
      expect(x.descartados[0].motivo).toContain(motivo)
    }
  })
})

describe('el prompt de la extracción', () => {
  const p = instruccionesCarga(CAMPOS, '2026-10-07', { destino: 'Santa Marta', fecha_salida: '2026-11-11' })
  it('trae hoy, lo que el viaje ya tiene, las opciones de cada campo y dónde va el matiz', () => {
    expect(p).toContain('Hoy es 2026-10-07')
    expect(p).toContain('- fecha_salida: 2026-11-11')
    expect(p).toContain('3 = 3 estrellas; 4 = 4 estrellas; 5 = 5 estrellas; sin_preferencia = Sin preferencia (solo si lo dicen)')
    expect(p).toMatch(/matiz[\s\S]*requisitos_especiales/)
    expect(p).toContain('con la salida y las noches sale el regreso')
    expect(p).toContain('Infante es menor de 2 años')
  })
  it('el esquema cierra las opciones y deja explicar el cálculo', () => {
    const e = esquemaCarga(CAMPOS) as { properties: { valores: { properties: Record<string, { properties: Record<string, { enum?: string[] }> }> } } }
    expect(e.properties.valores.properties.categoria_hotel.properties.valor.enum).toEqual(['3', '4', '5', 'sin_preferencia', 'por_definir'])
    expect(e.properties.valores.properties.fecha_regreso.properties.calculo).toBeDefined()
    // Los derivados no los llena el modelo.
    expect(e.properties.valores.properties.numero_pasajeros).toBeUndefined()
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
