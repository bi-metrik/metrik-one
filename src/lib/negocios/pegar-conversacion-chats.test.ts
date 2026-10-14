/**
 * Los cinco chats inventados de `__fixtures__/chats-pegados/` por la cadena real del CÓDIGO (partir, validar contra el
 * chat, cargar sin pisar, resumir). La salida del modelo está escrita a mano: aquí se prueba qué deja pasar el código y
 * qué frena cuando el modelo acierta Y cuando se equivoca (un valor del otro viaje, una frase inventada). Lo que el
 * modelo entiende de verdad se mide con la llave de pruebas contra Gemini (ver el PR).
 * Campos escritos a mano a semejanza de una solicitud de viaje (no son la config de producción).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import PizZip from 'pizzip'
import { cargarChatEnBloque, mensajesDelChat } from './pegar-conversacion'
import { chatDelZip } from './chat-exportado'
import { CLAVE_CONFLICTOS, CLAVE_SUGERIDOS } from './sugeridos'

const chat = (n: string) => readFileSync(path.resolve(__dirname, '__fixtures__/chats-pegados', n), 'utf8')

const CAMPOS = [
  { slug: 'destino', label: 'Destino', tipo: 'texto', nivel: 'minimo', pregunta: '¿A dónde viajan?' },
  { slug: 'ciudad_origen', label: 'Ciudad de salida', tipo: 'texto', nivel: 'minimo', pregunta: '¿Desde qué ciudad salen?' },
  { slug: 'fecha_salida', label: 'Fecha de salida', tipo: 'fecha', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', label: 'Fecha de regreso', tipo: 'fecha', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', label: 'Adultos', tipo: 'numero', nivel: 'minimo', pregunta: '¿Cuántos adultos viajan?' },
  { slug: 'ninos', label: 'Niños', tipo: 'numero', nivel: 'minimo', pregunta: '¿Viajan niños?' },
  { slug: 'infantes', label: 'Infantes', tipo: 'numero', nivel: 'minimo', pregunta: '¿Viajan bebés?' },
  { slug: 'edades_menores', label: 'Edades de los menores', tipo: 'texto', nivel: 'minimo', pregunta: '¿Qué edad tiene cada menor?', pedir_si: { field: 'ninos', mayor_que: 0 } },
  {
    slug: 'presupuesto', label: 'Presupuesto', tipo: 'select', nivel: 'deseable', pregunta: '¿Cuánto quieren gastar?',
    opciones: [
      { value: 'menos_3m', label: 'Menos de $3 M' }, { value: '3_6m', label: 'Entre $3 y $6 M' }, { value: 'mas_6m', label: 'Más de $6 M' },
      { value: 'sin_definir', label: 'Aún no tiene presupuesto definido', no_definido: true },
    ],
  },
  {
    slug: 'categoria_hotel', label: 'Categoría del hotel', tipo: 'select', nivel: 'minimo', pregunta: '¿Qué categoría de hotel?',
    opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: '5', label: '5 estrellas' }],
  },
  { slug: 'requisitos_especiales', label: 'Requisitos especiales', tipo: 'texto' },
]

const HOY = '2026-10-11'
const AHORA = '2026-10-11T20:00:00.000Z'

function correr(archivo: string, valores: Record<string, unknown>, clases: string[], extra: Record<string, unknown> = {}, data: Record<string, unknown> = {}) {
  const { mensajes, total, recortado } = mensajesDelChat(chat(archivo))
  expect(clases).toHaveLength(mensajes.length) // la salida escrita a mano cubre cada línea
  const raw = { mensajes: clases.map((clase, i) => ({ n: i + 1, clase })), valores, dudas: [], otros: [], ...extra }
  return { mensajes, c: cargarChatEnBloque({ fields: CAMPOS, data, raw, mensajes, total, recortado, hoyISO: HOY, ahoraIso: AHORA, huella: 'qa' }) }
}
const v = (valor: string, frase: string, como?: string, calculo?: string) => ({ valor, frase, ...(como ? { como } : {}), ...(calculo ? { calculo } : {}) })

describe('chat 1 · exportado de Android (.txt real: BOM, aviso de cifrado, «Multimedia omitido», mensaje en dos líneas)', () => {
  it('cada línea es un mensaje y la continuación también sostiene su frase', () => {
    const { mensajes, c } = correr('1-exportado-android.txt', {
      destino: v('Cartagena', 'irnos a Cartagena'),
      ciudad_origen: v('Medellín', 'Salimos de Medellín'),
      fecha_salida: v('2026-12-27', 'Del 27 de diciembre al 2 de enero'),
      fecha_regreso: v('2027-01-02', 'Del 27 de diciembre al 2 de enero'),
      adultos: v('2', 'Somos mi esposo, yo y los dos niños', 'deducido', 'ella y su esposo'),
      ninos: v('2', 'los dos niños'),
      infantes: v('0', 'Somos mi esposo, yo y los dos niños', 'deducido', 'dos niños de 7 y 10, ningún bebé'),
      edades_menores: v('7, 10', 'de 7 y 10 años'),
      categoria_hotel: v('4', 'Hotel 4 estrellas'),
      requisitos_especiales: v('Ojalá todo incluido', 'ojalá todo incluido'),
    }, ['ruido', 'ruido', 'cliente', 'comercial', 'cliente', 'cliente', 'ruido', 'comercial', 'cliente', 'cliente', 'ruido'])
    expect(mensajes[0].startsWith('9/10/26')).toBe(true) // sin BOM
    expect(mensajes[6]).toBe('9/10/26, 4:21 p. m. - Marcela Ríos Inventada: <Multimedia omitido>') // sin la marca invisible
    expect(mensajes[5]).toBe('de 7 y 10 años')
    expect(c.resumen.llenados).toHaveLength(10)
    expect(c.resumen.llenados).toContain('Adultos: 2 (deducido)')
    expect(c.resumen.faltaMinimo).toEqual([])
    expect(c.resumen.hayMinimo).toBe(true)
  })
})

describe('chat 2 · dos viajes mezclados (iOS)', () => {
  const clases = ['cliente', 'cliente', 'comercial', 'cliente', 'tercero', 'tercero', 'comercial']
  it('se llena solo este viaje y lo otro va al resumen', () => {
    const { c } = correr('2-dos-viajes-ios.txt', {
      destino: v('Punta Cana', 'quiero cotizar Punta Cana'),
      ciudad_origen: v('Bogotá', 'salimos de Bogotá'),
      fecha_salida: v('2027-02-14', 'el 14 de febrero'),
      fecha_regreso: v('2027-02-20', '14 de febrero, 6 noches', 'calculado', 'salida 2027-02-14 + 6 noches'),
      adultos: v('2', 'para mi esposa y yo', 'deducido', 'él y su esposa'),
      ninos: v('0', 'para mi esposa y yo', 'deducido', 'solo la pareja'),
      infantes: v('0', 'para mi esposa y yo', 'deducido', 'solo la pareja'),
      presupuesto: v('mas_6m', 'unos 8 millones los dos'),
    }, clases, { otros: ['Viaje a Europa en mayo de la mamá y la tía (salen de Cali, 68 y 72 años)'] })
    expect(c.data?.ciudad_origen).toBe('BOGOTÁ')
    expect(c.data?.fecha_regreso).toBe('2027-02-20')
    expect(c.resumen.llenados).toContain('Fecha de regreso: 20 feb (calculado)')
    expect(c.resumen.otros).toEqual(['Viaje a Europa en mayo de la mamá y la tía (salen de Cali, 68 y 72 años)'])
  })

  it('si el modelo se equivoca y toma un dato del otro viaje, el código no lo deja pasar', () => {
    const { c } = correr('2-dos-viajes-ios.txt', {
      destino: v('Punta Cana', 'quiero cotizar Punta Cana'),
      ciudad_origen: v('Cali', 'ellas salen de Cali'),
      adultos: v('4', 'son 2 señoras de 68 y 72 años', 'calculado', '2 de la pareja + 2 señoras'),
    }, clases)
    expect(c.data?.ciudad_origen).toBeUndefined()
    expect(c.data?.adultos).toBeUndefined()
    expect(c.resumen.llenados).toEqual(['Destino: PUNTA CANA'])
  })
})

describe('chat 3 · contradice lo que ya estaba guardado', () => {
  it('no pisa lo que escribió una persona: queda en conflicto con lo que dijo el chat', () => {
    const guardado = { destino: 'SAN ANDRÉS', adultos: 3, fecha_salida: '2026-12-20', fecha_regreso: '2026-12-24' }
    const { c } = correr('3-contradice.txt', {
      destino: v('SAN ANDRÉS', 'lo de San Andrés'),
      adultos: v('2', 'seríamos solo 2 adultos'),
      fecha_salida: v('2026-12-18', 'la salida para el 18 de diciembre'),
      fecha_regreso: v('2026-12-23', 'regresamos el 23'),
    }, ['cliente', 'cliente', 'cliente', 'comercial'], {}, guardado)
    expect(c.data).toMatchObject(guardado)
    expect(Object.keys(c.data?.[CLAVE_CONFLICTOS] as object).sort()).toEqual(['adultos', 'fecha_regreso', 'fecha_salida'])
    expect(c.data).not.toHaveProperty(CLAVE_SUGERIDOS)
    expect(c.resumen.conflictos).toEqual([
      'Fecha de salida: tiene 20 dic, el chat dice 18 dic',
      'Fecha de regreso: tiene 24 dic, el chat dice 23 dic',
      'Adultos: tiene 3, el chat dice 2',
    ])
    expect(c.resumen.llenados).toEqual([])
    expect(c.valores).toEqual({})
  })
})

describe('chat 4 · un niño de año y medio y sin presupuesto (pegado sin fecha ni nombre)', () => {
  it('el infante entra deducido, niños en 0 y el presupuesto queda vacío', () => {
    const { c } = correr('4-bebe-sin-presupuesto.txt', {
      destino: v('Santa Marta', 'Queremos ir a Santa Marta'),
      ciudad_origen: v('Bogotá', 'Saldríamos de Bogotá'),
      fecha_salida: v('2027-01-09', 'el 9 de enero'),
      fecha_regreso: v('2027-01-13', 'volvemos el 13'),
      adultos: v('2', 'vamos mi esposo, yo', 'deducido', 'ella y su esposo'),
      ninos: v('0', 'nuestro hijo de año y medio', 'deducido', 'año y medio es menor de 2: infante, no niño'),
      infantes: v('1', 'nuestro hijo de año y medio', 'deducido', 'año y medio es menor de 2'),
      presupuesto: v('por_definir', ''),
      requisitos_especiales: v('Con piscina para el niño, cerca de la playa', 'Algo con piscina para el niño, cerca de la playa'),
    }, ['ruido', 'cliente', 'cliente', 'cliente'])
    expect(c.data).toMatchObject({ adultos: 2, ninos: 0, infantes: 1 })
    expect(c.data).not.toHaveProperty('presupuesto')
    // Sin niños, la edad de los menores no se pide (su `pedir_si`): el mínimo pide solo la categoría.
    expect(c.resumen.faltaMinimo).toEqual(['¿Qué categoría de hotel?'])
    expect(c.resumen.llenados).toContain('Infantes: 1 (deducido)')
  })
})

describe('chat 5 · solo saludos', () => {
  it('no cambia nada y el resumen lo dice por lo que falta', () => {
    const { c } = correr('5-solo-saludos.txt', {}, ['ruido', 'ruido', 'ruido'])
    expect(c.data).toBeNull()
    expect(c.resumen.llenados).toEqual([])
    expect(c.resumen.faltaMinimo).toContain('¿A dónde viajan?')
  })
})

describe('el .zip de «Exportar chat»', () => {
  it('lee el _chat.txt e ignora los adjuntos', () => {
    const z = new PizZip()
    z.file('IMG-20261009-WA0001.jpg', new Uint8Array([0xff, 0xd8, 0xff]))
    z.file('_chat.txt', chat('2-dos-viajes-ios.txt'))
    const buf = z.generate({ type: 'uint8array' })
    expect(chatDelZip(buf)).toBe(chat('2-dos-viajes-ios.txt'))
  })

  it('sin .txt devuelve null', () => {
    const z = new PizZip()
    z.file('foto.jpg', new Uint8Array([1]))
    expect(chatDelZip(z.generate({ type: 'uint8array' }))).toBeNull()
  })
})
