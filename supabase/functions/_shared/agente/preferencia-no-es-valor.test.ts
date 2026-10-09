import { describe, expect, it } from 'vitest'
import { planDeCarga } from './bandeja/carga'
import { esquemaCarga, instruccionesCarga, validarCarga } from './bandeja/extraccion'
import { escenario } from './escenario'
import type { ExtractorMemoria } from './memoria'
import { modeloGuionado } from './modelo-guionado'
import { cargarEnExistente } from '../wa-carga-reglas'
import type { CampoEntendible } from '../wa-entendimiento-reglas'

/**
 * Tercera falla en vivo del núcleo (2026-10-07, bandeja de Trappvel). Rehecha con datos INVENTADOS (otra clienta, otro
 * destino, otro código):
 *   1. el comercial da el grupo, la fecha, las noches y «buscan un viaje económico». La extracción propuso presupuesto
 *      «menos de $3 millones» por «económico», y tipo de viaje y fechas fijas que nadie dijo. Tocó Anotar sin notarlo.
 *   2. por audio: «el presupuesto que colocaste 3 millones no, el presupuesto está abierto…». No había cómo decir
 *      «quítalo»: el valor equivocado se quedó en el viaje y el resumen no dijo nada (y re-propuso las edades con otra
 *      redacción).
 * Lo arreglado: una preferencia no es un valor (el prompt), lo ambiguo se PREGUNTA en la misma burbuja de la propuesta
 * (Mauricio: «no se invente esas cifras, puede preguntar»), corregir también es borrar (`quitar`, acción explícita y
 * validada), y lo calculado o deducido lleva marca en el resumen. Los dos modelos son guiones: ninguna llamada real.
 */

const ROSA = { id: 'c-rosa', nombre: 'ROSA MEJIA', celular: '3015552781' }
const COD = 'R1 26 2'

const PRESUPUESTO: CampoEntendible = {
  slug: 'presupuesto', tipo: 'select', label: 'Presupuesto aproximado del viaje', nivel: 'deseable', pregunta: '¿Cuánto piensan invertir?',
  opciones: [
    { value: 'menos_3m', label: 'Menos de $3 millones' },
    { value: '3m_5m', label: 'Entre $3 y $5 millones' },
    { value: '5m_8m', label: 'Entre $5 y $8 millones' },
    { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true },
  ],
} as CampoEntendible

/** La forma de la config de una línea de viajes (no son datos de nadie). */
const CAMPOS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  { slug: 'tipo_viaje', tipo: 'select', label: 'Tipo de viaje', nivel: 'deseable', pregunta: '¿Qué tipo de viaje?', opciones: [{ value: 'playa', label: 'Playa' }, { value: 'naturaleza_aventura', label: 'Naturaleza y aventura' }, { value: 'otro', label: 'Otro' }] },
  { slug: 'fechas_tipo', tipo: 'select', label: 'Fechas', nivel: 'deseable', pregunta: '¿Fechas fijas o flexibles?', opciones: [{ value: 'fijas', label: 'Fijas' }, { value: 'flexibles', label: 'Flexibles' }] },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Fecha de regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Niños?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Bebés?' },
  { slug: 'numero_pasajeros', tipo: 'numero', label: 'Número de pasajeros', suma_de: ['adultos', 'ninos', 'infantes'] },
  { slug: 'edades_menores', tipo: 'texto', label: 'Edades de los niños e infantes', nivel: 'minimo', pregunta: '¿Edades?', pedir_si: { suma_de: ['ninos', 'infantes'], mayor_que: 0 } },
  PRESUPUESTO,
  { slug: 'categoria_hotel', tipo: 'select', label: 'Categoría de hotel', nivel: 'minimo', pregunta: '¿Categoría?', opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true }] },
  { slug: 'plan_alimentacion', tipo: 'select', label: 'Plan de alimentación', nivel: 'deseable', pregunta: '¿Plan?', opciones: [{ value: 'solo_alojamiento', label: 'Solo alojamiento' }, { value: 'desayuno', label: 'Con desayuno' }] },
  { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos especiales', nivel: 'deseable', pregunta: '¿Algo especial?' },
] as CampoEntendible[]

const M1 = `Para el ${COD}: van a viajar 6. 2 niños de 8 y 10 años y un bebé de 11 meses. El viaje es para Quito, 17 de enero de 2027, 10 noches, calcula el regreso. Están buscando un viaje económico. Categoría 3 estrellas ojalá con desayuno incluido. La alimentación es por cuenta del cliente.`
const M2 = 'Déjalo como nota, no nos dieron un número'
const AUDIO = 'el presupuesto que colocaste 3 millones no, el presupuesto está abierto, propongamos nosotros, simplemente quieren viajar económico, no nos dieron un número exacto'
const DUDA = { campo: 'presupuesto', pregunta: '"Económico": ¿lo dejo como nota o es un rango?', opciones: ['Menos de $3 millones', 'Entre $3 y $5 millones', 'Solo como nota'] }
const REQ_1 = 'Buscan un viaje económico. Ojalá con desayuno incluido; la alimentación es por cuenta del cliente.'
const REQ_2 = 'Buscan un viaje económico; el presupuesto está abierto, lo proponemos nosotros. Ojalá con desayuno incluido; la alimentación es por cuenta del cliente.'

type Valor = { valor: string; frase: string; como?: string; calculo?: string }
type Valores = Record<string, Valor>
/** «No nos dieron un número»: la opción de no definido del presupuesto, no un vacío (Mauricio, 2026-10-08). */
const SIN_DEFINIR: Valor = { valor: 'sin_definir', frase: 'no nos dieron un número', como: 'escrito' }
/** La salida cruda de la extracción, como la devuelve Gemini: todos los campos, los no dichos en `por_definir`. */
function crudo(textos: string[], valores: Valores, dudas: unknown[] = []) {
  const todos: Valores = Object.fromEntries(CAMPOS.map((f) => [f.slug, { valor: 'por_definir', frase: '' }]))
  return { mensajes: textos.map((_, i) => ({ n: i + 1, clase: 'cliente' })), citas: [], valores: { ...todos, ...valores }, dudas }
}

/** Lo que haría el modelo con el prompt nuevo en el turno 1: presupuesto, tipo de viaje y fechas fijas sin llenar. */
const TURNO_1: Valores = {
  fecha_salida: { valor: '2027-01-17', frase: '17 de enero de 2027', como: 'escrito' },
  fecha_regreso: { valor: '2027-01-27', frase: '10 noches', como: 'calculado', calculo: 'salida 2027-01-17 + 10 noches' },
  adultos: { valor: '3', frase: 'van a viajar 6', como: 'calculado', calculo: '6 en total − 2 niños − 1 bebé' },
  ninos: { valor: '2', frase: '2 niños de 8 y 10 años', como: 'escrito' },
  infantes: { valor: '1', frase: 'un bebé de 11 meses', como: 'deducido', calculo: 'bebé de 11 meses: menor de 2 años' },
  edades_menores: { valor: '8, 10, 11 meses', frase: '2 niños de 8 y 10 años y un bebé de 11 meses', como: 'escrito' },
  categoria_hotel: { valor: '3', frase: 'Categoría 3 estrellas', como: 'escrito' },
  plan_alimentacion: { valor: 'desayuno', frase: 'ojalá con desayuno incluido', como: 'escrito' },
  requisitos_especiales: { valor: REQ_1, frase: 'Están buscando un viaje económico', como: 'escrito' },
}

const linea = (s: string) => s.split('\n')

describe('tercera falla en vivo 2026-10-07: una preferencia no es un valor y corregir también es borrar', () => {
  it('los dos turnos con el viaje vacío: «económico» solo se pregunta, «no nos dieron un número» es sin definir y el matiz va a requisitos', async () => {
    const prompts: string[] = []
    const guion = [
      // 1. «económico» no es un rango: queda por definir, va a requisitos y se pregunta.
      () => ({ valores: TURNO_1, dudas: [DUDA] }),
      // 1b. contesta la duda: «no nos dieron un número» es la opción de no definido (Mauricio, 2026-10-08), sin la duda.
      () => ({ valores: { ...TURNO_1, presupuesto: SIN_DEFINIR }, dudas: [] }),
      // 2. el audio, ya con el viaje cargado: el presupuesto ya es «sin definir» y vuelve con el valor EXACTO (no es un
      //    cambio), el matiz crece y las edades vienen con el valor EXACTO que el viaje ya tiene.
      () => ({
        valores: {
          presupuesto: { valor: 'sin_definir', frase: 'el presupuesto está abierto', como: 'escrito' },
          edades_menores: { valor: '8, 10, 11 MESES', frase: '2 niños de 8 y 10 años y un bebé de 11 meses', como: 'escrito' },
          requisitos_especiales: { valor: REQ_2, frase: 'el presupuesto está abierto', como: 'escrito' },
        } as Valores,
        dudas: [],
      }),
    ]
    const extraer: ExtractorMemoria = async ({ textos, instrucciones }) => {
      prompts.push(instrucciones)
      const paso = guion.shift()
      if (!paso) throw new Error('guion de extracción agotado')
      const { valores, dudas } = paso()
      return crudo(textos, valores, dudas)
    }
    const ANOTAR = { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD } } }
    const modelo = modeloGuionado([ANOTAR, ANOTAR, ANOTAR])
    const e = await escenario({
      modelo, contactos: [ROSA], campos: CAMPOS, extraer,
      viajes: [{ id: 'v-2', codigo: COD, contactoId: 'c-rosa', nombre: 'QUITO', destino: 'Quito', abierto: true, datos: {} }],
    })

    // 1. La propuesta: la duda arriba, en la misma burbuja; lo demás anotable; lo calculado y lo deducido con marca.
    const t1 = await e.escribe(M1)
    expect(t1[0].tipo).toBe('botones')
    const r1 = t1[0].texto
    expect(linea(r1)[0]).toBe('"Económico": ¿lo dejo como nota o es un rango? (Menos de $3 millones / Entre $3 y $5 millones / Solo como nota)')
    expect(linea(r1)[1]).toBe(`¿Lo anoto en ${COD} · QUITO?`)
    expect(linea(r1)).toContain('• Fecha de regreso: 27 ene (calculado)')
    expect(linea(r1)).toContain('• Adultos: 3 (calculado)')
    expect(linea(r1)).toContain('• Infantes: 1 (deducido)')
    // Lo escrito tal cual no lleva marca.
    expect(linea(r1)).toContain('• Fecha de salida: 17 ene')
    expect(linea(r1)).toContain('• Niños: 2')
    expect(linea(r1)).toContain(`• Requisitos especiales: ${REQ_1}`)
    expect(r1).not.toMatch(/Presupuesto|Tipo de viaje|• Fechas:/)
    expect([...r1].length).toBeLessThanOrEqual(1024)
    // El prompt ya no empuja a escoger siempre.
    expect(prompts[0]).not.toContain('elige la que mejor representa lo pedido')
    expect(prompts[0]).toContain('«económico», «algo bueno», «no muy caro» no son un rango de presupuesto')
    expect(prompts[0]).toContain('el tipo de viaje por el destino')

    // 1b. La respuesta a la duda se lee como cualquier dato: sale una propuesta nueva SIN la duda (no la pendiente).
    const t1b = await e.escribe(M2)
    expect(t1b[0].tipo).toBe('botones')
    expect(linea(t1b[0].texto)[0]).toBe(`¿Lo anoto en ${COD} · QUITO?`)
    expect(t1b[0].texto).not.toContain('¿lo dejo como nota')
    expect(linea(t1b[0].texto)).toContain('• Presupuesto aproximado del viaje: Aún no tiene presupuesto definido')
    expect(linea(t1b[0].texto)).toContain(`• Requisitos especiales: ${REQ_1}`)
    // La extracción vio lo propuesto sin confirmar (para poder corregirlo o quitarlo).
    expect(prompts[1]).toContain('Lo que ya le propusiste al comercial y todavía no confirma:')
    expect(prompts[1]).toContain('- adultos: 3')

    const c1 = await e.toca('Anotar')
    expect(c1[0].texto).toMatch(new RegExp(`^Cargué en ${COD}: `))
    const v = () => e.puerto.viajes[0].datos
    expect(v().presupuesto).toBe('sin_definir')
    expect(v().tipo_viaje).toBeUndefined()
    expect(v().fechas_tipo).toBeUndefined()
    expect(v()).toMatchObject({ fecha_regreso: '2027-01-27', adultos: 3, ninos: 2, infantes: 1, edades_menores: '8, 10, 11 MESES' })

    // 2. El audio: solo cambia requisitos; las edades (el mismo valor) no se re-proponen.
    const t2 = await e.escribe(AUDIO)
    const r2 = t2[0].texto
    expect(linea(r2).filter((l) => l.startsWith('• '))).toEqual([`• Requisitos especiales: ${REQ_2}`])
    expect(prompts[2]).toContain('- edades_menores: 8, 10, 11 MESES')
    expect(prompts[2]).toContain('- presupuesto: sin_definir')
    await e.toca('Anotar')

    // La verdad: presupuesto «sin definir», el matiz en requisitos, tipo de viaje y fechas fijas sin llenar.
    expect(v().presupuesto).toBe('sin_definir')
    expect(v().tipo_viaje).toBeUndefined()
    expect(v().fechas_tipo).toBeUndefined()
    expect(v().requisitos_especiales).toBe(REQ_2.toUpperCase())
    expect(modelo.restantes()).toBe(0)
  })

  it('el estado que dejó la falla: el «menos de $3 millones» del viaje pasa a «sin definir» con el toque (reemplaza, no quita)', async () => {
    const extraer: ExtractorMemoria = async ({ textos }) => crudo(textos, {
      presupuesto: { valor: 'sin_definir', frase: 'el presupuesto está abierto', como: 'escrito' },
      requisitos_especiales: { valor: REQ_2, frase: 'el presupuesto está abierto' },
      edades_menores: { valor: '8, 10, 11 MESES', frase: 'no nos dieron un número exacto' },
    })
    const marca = { fuente: 'whatsapp', entrega_id: 'agente', frase: 'Están buscando un viaje económico', en: '2026-10-06T22:09:00Z' }
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD } } }])
    const e = await escenario({
      modelo, contactos: [ROSA], campos: CAMPOS, extraer,
      viajes: [{
        id: 'v-2', codigo: COD, contactoId: 'c-rosa', nombre: 'QUITO', destino: 'Quito', abierto: true,
        datos: { presupuesto: 'menos_3m', edades_menores: '8, 10, 11 MESES', requisitos_especiales: REQ_1.toUpperCase(), _sugeridos: { presupuesto: marca, edades_menores: marca, requisitos_especiales: marca } },
      }],
    })

    const t = await e.escribe(`${COD}: ${AUDIO}`)
    const bullets = linea(t[0].texto).filter((l) => l.startsWith('• '))
    expect(bullets).toEqual([
      '• Presupuesto aproximado del viaje: Aún no tiene presupuesto definido',
      `• Requisitos especiales: ${REQ_2}`,
    ])
    // Nada se cambia sin el toque.
    expect(e.puerto.viajes[0].datos.presupuesto).toBe('menos_3m')

    const c = await e.toca('Anotar')
    expect(c[0].texto).not.toContain('Quité')
    const d = e.puerto.viajes[0].datos
    expect(d.presupuesto).toBe('sin_definir')
    expect((d._sugeridos as Record<string, { frase: string }>).presupuesto.frase).toBe('el presupuesto está abierto')
    expect(d.requisitos_especiales).toBe(REQ_2.toUpperCase())
    expect(d.edades_menores).toBe('8, 10, 11 MESES')
  })

  it('«eso no lo dijeron» en un campo SIN opción de no definido sigue siendo quitar', async () => {
    const DICHO = 'el tipo de viaje eso no lo dijeron'
    const extraer: ExtractorMemoria = async ({ textos }) => crudo(textos, {
      tipo_viaje: { valor: 'quitar', frase: DICHO, calculo: 'dijeron que eso no' },
    })
    const marca = { fuente: 'whatsapp', entrega_id: 'agente', frase: 'Quito', en: '2026-10-06T22:09:00Z' }
    const modelo = modeloGuionado([{ name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD } } }])
    const e = await escenario({
      modelo, contactos: [ROSA], campos: CAMPOS, extraer,
      viajes: [{ id: 'v-2', codigo: COD, contactoId: 'c-rosa', nombre: 'QUITO', destino: 'Quito', abierto: true, datos: { tipo_viaje: 'naturaleza_aventura', _sugeridos: { tipo_viaje: marca } } }],
    })
    const t = await e.escribe(`${COD}: ${DICHO}`)
    expect(linea(t[0].texto).filter((l) => l.startsWith('• '))).toEqual(['• Tipo de viaje: se quita (dijeron que eso no)'])
    const c = await e.toca('Anotar')
    expect(c[0].texto).toBe(`Quité de ${COD}: Tipo de viaje.`)
    expect(e.puerto.viajes[0].datos.tipo_viaje).toBeUndefined()
  })
})

// ── Las piezas ───────────────────────────────────────────────────────────────

describe('quitar es una acción explícita y validada', () => {
  const meta = { entrega_id: 'agente', en: '2026-10-07T20:00:00Z', origenDe: () => 'mensaje' as const }
  const marca = { fuente: 'whatsapp', entrega_id: 'agente', frase: 'económico', en: '2026-10-07T10:00:00Z' }
  const t = ['el presupuesto está abierto']
  const quitarPresupuesto = { presupuesto: { valor: 'quitar', frase: 'el presupuesto está abierto' } }

  it('un campo que falta en lo sugerido no se toca; solo `quitar` borra', () => {
    const data = { presupuesto: 'menos_3m', _sugeridos: { presupuesto: marca } }
    expect(cargarEnExistente(data, CAMPOS, {}, meta, new Set(), { delModelo: true }).data.presupuesto).toBe('menos_3m')
    const r = cargarEnExistente(data, CAMPOS, {}, meta, new Set(), { delModelo: true, quitar: { presupuesto: { frase: 'abierto' } } })
    expect(r.quitados).toEqual(['presupuesto'])
    expect(r.data.presupuesto).toBeUndefined()
  })

  it('lo que escribió o confirmó una persona en ONE no se quita: se dice', () => {
    const editado = { presupuesto: 'menos_3m', _sugeridos: { presupuesto: marca }, _ediciones: { presupuesto: { por: 'alguien' } } }
    const r = cargarEnExistente(editado, CAMPOS, {}, meta, new Set(), { delModelo: true, quitar: { presupuesto: { frase: 'abierto' } } })
    expect(r.quitados).toEqual([])
    expect(r.noQuitados).toEqual(['presupuesto'])
    expect(r.data.presupuesto).toBe('menos_3m')
    const p = planDeCarga({ bloques: [{ fields: CAMPOS, data: editado }], textos: t, raw: crudo(t, quitarPresupuesto), hoyISO: '2026-10-07', ahoraIso: meta.en })
    expect(p.entendido).toEqual(['Presupuesto aproximado del viaje: no lo quito, lo puso alguien en ONE (cámbialo allí)'])
  })

  it('quitar un campo vacío no es nada; sin la frase escrita, tampoco', () => {
    const v = validarCarga(crudo(t, quitarPresupuesto), CAMPOS, t, { hoyISO: '2026-10-07', yaTiene: {} })
    expect(v.quitar).toEqual({})
    expect(v.descartados).toEqual([{ slug: 'presupuesto', motivo: 'quitar un campo que está vacío' }])
    const sinFrase = validarCarga(crudo(t, { presupuesto: { valor: 'quitar', frase: 'eso no lo dijeron' } }), CAMPOS, t, { hoyISO: '2026-10-07', yaTiene: { presupuesto: 'menos_3m' } })
    expect(sinFrase.quitar).toEqual({})
  })

  it('quitar lo que solo estaba propuesto lo saca de la propuesta; un valor nuevo deshace un quitar pendiente', () => {
    const bloques = [{ fields: CAMPOS, data: { destino: 'Quito' } as Record<string, unknown> }]
    const base = { bloques, hoyISO: '2026-10-07', ahoraIso: meta.en }
    const a = planDeCarga({ ...base, textos: ['buscan algo económico'], raw: crudo(['buscan algo económico'], { presupuesto: { valor: 'menos_3m', frase: 'buscan algo económico' } }) })
    expect(a.entendido).toEqual(['Presupuesto aproximado del viaje: Menos de $3 millones'])
    const b = planDeCarga({ ...base, textos: t, raw: crudo(t, quitarPresupuesto), previo: a.plan })
    expect(b.plan.sugeridos.presupuesto).toBeUndefined()
    expect(b.plan.quitar).toBeUndefined()
    expect(b.entendido).toEqual([])

    const conViaje = [{ fields: CAMPOS, data: { destino: 'Quito', presupuesto: 'menos_3m', _sugeridos: { presupuesto: marca } } as Record<string, unknown> }]
    const q = planDeCarga({ ...base, bloques: conViaje, textos: t, raw: crudo(t, quitarPresupuesto) })
    expect(q.plan.quitar).toEqual({ presupuesto: { frase: 'el presupuesto está abierto' } })
    expect(q.entendido).toEqual(['Presupuesto aproximado del viaje: se quita («el presupuesto está abierto»)'])
    const t2 = ['mejor entre 3 y 5 millones']
    const n = planDeCarga({ ...base, bloques: conViaje, textos: t2, raw: crudo(t2, { presupuesto: { valor: '3m_5m', frase: 'entre 3 y 5 millones' } }), previo: q.plan })
    expect(n.plan.quitar).toBeUndefined()
    expect(n.entendido).toEqual(['Presupuesto aproximado del viaje: Entre $3 y $5 millones'])
  })
})

describe('las dudas de la extracción', () => {
  const t = ['buscan algo económico, salen el 17 de enero de 2027']
  const base = { bloques: [{ fields: CAMPOS, data: {} as Record<string, unknown> }], textos: t, hoyISO: '2026-10-07', ahoraIso: '2026-10-07T20:00:00Z' }

  it('si el modelo lo pregunta, no lo da por sabido: el valor del mismo campo no entra, lo demás sí', () => {
    const p = planDeCarga({ ...base, raw: crudo(t, {
      presupuesto: { valor: 'menos_3m', frase: 'buscan algo económico' },
      fecha_salida: { valor: '2027-01-17', frase: 'salen el 17 de enero de 2027' },
    }, [DUDA]) })
    expect(p.plan.sugeridos.presupuesto).toBeUndefined()
    expect(p.plan.sugeridos.fecha_salida.valor).toBe('2027-01-17')
    expect(p.duda).toBe('"Económico": ¿lo dejo como nota o es un rango? (Menos de $3 millones / Entre $3 y $5 millones / Solo como nota)')
  })

  it('una sola pregunta: primero la del mínimo para cotizar; acotada y de un campo que existe', () => {
    const dudas = [
      DUDA,
      { campo: 'categoria_hotel', pregunta: '¿«Bueno» es 3 o 4 estrellas?', opciones: ['3 estrellas', '4 estrellas', 'Sin preferencia', 'Otra', 'Sobra'] },
      { campo: 'no_existe', pregunta: '¿?' },
    ]
    const p = planDeCarga({ ...base, raw: crudo(t, {}, dudas) })
    expect(p.duda).toBe('¿«Bueno» es 3 o 4 estrellas? (3 estrellas / 4 estrellas / Sin preferencia / Otra)')
    const larga = planDeCarga({ ...base, raw: crudo(t, {}, [{ campo: 'presupuesto', pregunta: 'x'.repeat(161) }]) })
    expect(larga.duda).toBeUndefined()
  })

  it('el esquema tiene dónde devolver las dudas, cómo salió cada valor y el quitar', () => {
    const e = esquemaCarga(CAMPOS) as { properties: Record<string, { properties?: Record<string, unknown>; items?: { properties: Record<string, { enum?: string[] }> } }> }
    expect(e.properties.dudas.items!.properties.campo.enum).toContain('presupuesto')
    const presupuesto = (e.properties.valores.properties as Record<string, { properties: Record<string, { enum?: string[] }> }>).presupuesto
    expect(presupuesto.properties.valor.enum).toContain('quitar')
    expect(presupuesto.properties.como.enum).toEqual(['escrito', 'calculado', 'deducido'])
  })

  it('el prompt: una opción solo si corresponde, sin inferencias, quitar, el valor exacto si ya está, y preguntar', () => {
    const p = instruccionesCarga(CAMPOS, '2026-10-07', { edades_menores: '8, 10, 11 MESES' }, { presupuesto: 'menos_3m' })
    expect(p).toContain('Un campo de opciones guarda UNA opción, y solo si lo dicho corresponde a ella.')
    expect(p).toContain('que las fechas sean fijas porque hay una fecha')
    expect(p).toContain('devuelve "quitar"')
    expect(p).toContain('devuelve el valor EXACTO que ya está')
    expect(p).toContain('4. dudas:')
    expect(p).toContain('- presupuesto: menos_3m')
    expect(p).toMatch(/preferencia va, con sus palabras, al campo de texto que corresponda \(destino, edades_menores, requisitos_especiales\)/)
  })

  it('el prompt: «no tiene / no dieron / está abierto» es la opción de no definido de la config; «económico» solo, duda; corregir a abierto la usa', () => {
    const p = instruccionesCarga(CAMPOS, '2026-10-08')
    // La opción sale marcada desde la config (`no_definido`), en cualquier campo que la tenga.
    expect(p).toContain('sin_definir = Aún no tiene presupuesto definido (solo si lo dicen)')
    expect(p).toContain('sin_preferencia = Sin preferencia (solo si lo dicen)')
    // La regla habla de la marca y de la etiqueta, no de un campo.
    expect(p).toContain('La opción de «aún no está definido» (la marcada «solo si lo dicen», o la que su etiqueta dice que no hay dato')
    expect(p).toContain('úsala cuando digan explícitamente que el cliente no lo tiene, no lo dio o está abierto')
    expect(p).toMatch(/Una preferencia sola \(«económico»\),\s+sin decir nada del dato, no es eso: queda en "por_definir" y se pregunta/)
    // Corregir a abierto reemplaza con esa opción; quitar queda para el campo sin ella o para «eso no».
    expect(p).toMatch(/opción de «aún no está definido», devuelve esa opción: reemplaza el valor\. Si no la tiene, o la corrección es «eso\s+no»/)
    expect(p).not.toContain('«el presupuesto está abierto», «no, eso no lo dijeron»), devuelve "quitar"')
  })

  it('interpretar no es inventar (2026-10-09): un campo del que nadie habló queda vacío; la edad decide infante', () => {
    const p = instruccionesCarga([], '2026-10-09')
    expect(p).toMatch(/Interpretar no es inventar: un campo del que nadie habló queda en "por_definir" aunque se pueda suponer \(el\s+presupuesto/)
    expect(p).toContain('La frase de un valor habla de ESE campo.')
    expect(p).toMatch(/Infante es menor de 2 años y la edad manda sobre la palabra\s+\(«un niño de año y medio» es 1 infante y 0 niños\)/)
    const esquema = esquemaCarga([{ slug: 'adultos', tipo: 'numero', label: 'Adultos' }] as CampoEntendible[]) as { properties: { valores: { properties: Record<string, { properties: { frase: { description?: string } } }> } } }
    expect(esquema.properties.valores.properties.adultos.properties.frase.description).toContain('hablan de ESTE campo')
  })

  it('la parte fija del prompt de la extracción no pasa de 1.200 tokens (4 caracteres por token)', () => {
    expect(Math.ceil(instruccionesCarga([], '2026-10-08').length / 4)).toBeLessThanOrEqual(1200)
  })
})
