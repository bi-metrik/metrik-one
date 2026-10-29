import { describe, expect, it } from 'vitest'
import { mensajesDeTextos, preguntasPrevias, tandaDelViaje } from './bandeja/carga'
import { sinFraseCitada } from './bandeja/extraccion'
import { opcionNombrada, tanda } from './bandeja/dominio'
import { escenario } from './escenario'
import type { ExtractorMemoria } from './memoria'
import { modeloGuionado } from './modelo-guionado'
import { promptNucleo } from './contexto'
import { reglamentoDePrueba } from './escenario'
import { textoParaModelo } from '../wa-guardianes'
import type { CampoEntendible } from '../wa-entendimiento-reglas'
import type { FilaConversacion, PedidoModelo } from './tipos'

/**
 * Banco de conducta del asistente (2026-10-29). Mauricio, tras leer las conversaciones reales de un dueño de agencia con
 * el bot (28-oct y 22-oct): «que se sienta como un asistente y no como un robot que genera fricción». Cinco fallas
 * medidas en producción, rehechas con datos INVENTADOS (otra clienta, otro destino, otras fechas):
 *   1. lo reenviado antes de abrir el viaje se perdía: el «Abrí…» pedía reenviarlo y la anotación solo leía lo escrito;
 *   2. lo que escribió el comercial le llegaba a la extracción como reenvío del cliente («El cliente dice que ya dio
 *      las fechas»);
 *   3. la misma pregunta volvía en cada propuesta (el rango del regreso cinco veces, la edad del niño cuatro);
 *   4. varios valores para un campo de una sola opción («3, 4 y 5 estrellas») trababan la conversación;
 *   5. cada propuesta abría con la frase citada y la pregunta, y repetía la lista de faltantes.
 * Los modelos son guiones (ninguna llamada real): el guion de la extracción hace lo que hizo el modelo en vivo, y la
 * prueba mira que el código no deje pasar la falla. La verdad es el estado final del viaje y lo que se le mandó.
 */

const PAULA = { id: 'c-paula', nombre: 'PAULA RINCON', celular: '3105552211' }
const REF = 'Paula Rincon (cel. …2211)'
const COD = 'P1 26 1'

const CAMPOS: CampoEntendible[] = [
  { slug: 'destino', tipo: 'texto', label: 'Destino', nivel: 'minimo', pregunta: '¿A dónde?' },
  { slug: 'ciudad_origen', tipo: 'texto', label: 'Ciudad de salida', nivel: 'minimo', pregunta: '¿Desde dónde salen?' },
  { slug: 'fechas_tipo', tipo: 'select', label: '¿Las fechas son fijas o móviles?', nivel: 'deseable', pregunta: '¿Fijas o móviles?', opciones: [{ value: 'fijas', label: 'Fijas' }, { value: 'moviles', label: 'Móviles' }] },
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'fecha_regreso', tipo: 'fecha', label: 'Fecha de regreso', nivel: 'minimo', pregunta: '¿Qué día regresan?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
  { slug: 'ninos', tipo: 'numero', label: 'Niños', nivel: 'minimo', pregunta: '¿Niños?' },
  { slug: 'infantes', tipo: 'numero', label: 'Infantes', nivel: 'minimo', pregunta: '¿Bebés?' },
  { slug: 'categoria_hotel', tipo: 'select', label: 'Categoría de hotel', nivel: 'minimo', pregunta: '¿Categoría?', opciones: [{ value: '3', label: '3 estrellas' }, { value: '4', label: '4 estrellas' }, { value: '5', label: '5 estrellas' }, { value: 'sin_preferencia', label: 'Sin preferencia', no_definido: true }] },
  { slug: 'requisitos_especiales', tipo: 'texto', label: 'Requisitos especiales', nivel: 'deseable', pregunta: '¿Algo especial?' },
] as CampoEntendible[]

type Valores = Record<string, { valor: string; frase: string; como?: string; calculo?: string }>
type Duda = { campo: string; pregunta: string; opciones?: string[] }
/** La salida cruda de la extracción, como la devuelve el modelo. */
function crudo(textos: string[], valores: Valores, dudas: Duda[] = []) {
  const todos: Valores = Object.fromEntries(CAMPOS.map((f) => [f.slug, { valor: 'por_definir', frase: '' }]))
  return { mensajes: textos.map((_, i) => ({ n: i + 1, clase: 'cliente' })), citas: [], valores: { ...todos, ...valores }, dudas }
}

/** Lo que la extracción ve en cada llamado: el texto de los mensajes como lo arma producción, y el prompt. */
interface Visto { mensajes: string; instrucciones: string; textos: string[] }
function extraccionGuionada(guion: Array<(textos: string[]) => ReturnType<typeof crudo>>, vistos: Visto[]): ExtractorMemoria {
  return async (p) => {
    vistos.push({ mensajes: textoParaModelo(mensajesDeTextos(p.textos, (p as { reenviados?: boolean[] }).reenviados)), instrucciones: p.instrucciones, textos: [...p.textos] })
    const paso = guion.shift()
    if (!paso) throw new Error('guion de extracción agotado')
    return paso(p.textos)
  }
}

const delBot = (filas: FilaConversacion[]) => filas.filter((f) => f.direccion === 'saliente').map((f) => f.texto ?? '')

// ── 1 y 2. Lo reenviado antes de abrir se carga al abrir, y cada texto llega con su autor ────────────────────────

describe('1-2 · lo reenviado antes de abrir el viaje se carga al abrirlo, con su autor', () => {
  const R1 = 'Aruba entre el 10 de marzo y el 20 de marzo'
  const R2 = 'Tres adultos'
  const ESCRITO = 'Ábrele un viaje a Aruba a Paula Rincon, sale de Cali, lo lleva Carla Comercial'

  it('el «Abrí…» no pide reenviar: propone de una vez lo reenviado y lo escrito, y el toque consume la tanda', async () => {
    const vistos: Visto[] = []
    let dichoEn = 0
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Paula Rincon' } },
      (_p: PedidoModelo) => ({ name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, destino: 'Aruba', responsable: 'Carla Comercial', dicho_en: dichoEn } } }),
    ])
    const extraer = extraccionGuionada([
      (textos) => crudo(textos, {
        ciudad_origen: { valor: 'Cali', frase: 'sale de Cali' },
        fecha_salida: { valor: '2027-03-10', frase: 'entre el 10 de marzo' },
        fecha_regreso: { valor: '2027-03-20', frase: 'el 20 de marzo' },
        adultos: { valor: '3', frase: 'Tres adultos' },
      }),
    ], vistos)
    const e = await escenario({ modelo, contactos: [PAULA], campos: CAMPOS, extraer })

    await e.reenvia(R1)
    await e.reenvia(R2)
    dichoEn = e.almacen.filas.length + 1
    const t = await e.escribe(ESCRITO)
    expect(t[0].tipo).toBe('botones')
    const abierto = await e.toca('Sí, ábrelo')

    // La extracción leyó los dos reenvíos (del cliente) y lo escrito (del comercial), en orden.
    expect(vistos).toHaveLength(1)
    expect(vistos[0].textos).toEqual([R1, R2, ESCRITO])
    expect(vistos[0].mensajes).toContain(`(reenviado) ${R1}`)
    expect(vistos[0].mensajes).toContain(`(reenviado) ${R2}`)
    expect(vistos[0].mensajes).toContain(`(escrito por el comercial) ${ESCRITO}`)

    // El «Abrí…» sale con la propuesta de lo ya dicho, sin pedir que lo reenvíen.
    expect(abierto[0].tipo).toBe('botones')
    expect(abierto[0].texto).not.toMatch(/Reenvíame/)
    expect(abierto[0].texto).toContain('• Adultos: 3')
    expect(abierto[0].texto).toContain('• Fecha de regreso: 20 mar')

    const cargado = await e.toca('Anotar')
    expect(cargado[0].texto).toMatch(new RegExp(`^Cargué en ${COD}: `))
    const v = e.puerto.viajes.find((x) => x.codigo === COD)!
    expect(v.datos).toMatchObject({ adultos: 3, fecha_salida: '2027-03-10', fecha_regreso: '2027-03-20' })
    // La tanda quedó cargada: el bot no la sigue ofreciendo.
    expect(tanda(e.almacen.filas)).toEqual([])
  })

  it('«ya te dije la fecha» del comercial llega como suyo, no como del cliente, y la anotación lee lo reenviado', async () => {
    const vistos: Visto[] = []
    const YA = `${COD}: ya te dije la fecha de salida y regreso`
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: YA } } },
    ])
    const extraer = extraccionGuionada([
      (textos) => crudo(textos, {
        fecha_salida: { valor: '2027-03-10', frase: 'entre el 10 de marzo' },
        fecha_regreso: { valor: '2027-03-20', frase: 'el 20 de marzo' },
      }),
    ], vistos)
    const e = await escenario({
      modelo, contactos: [PAULA], campos: CAMPOS, extraer,
      viajes: [{ id: 'v-1', codigo: COD, contactoId: 'c-paula', nombre: 'ARUBA', destino: 'Aruba', abierto: true, datos: {} }],
    })
    // El reenvío llegó antes de nombrar el viaje y nadie lo cargó: es del primero que se nombra después.
    await e.reenvia(R1)
    const t = await e.escribe(YA)

    expect(vistos.at(-1)!.mensajes).toContain(`(escrito por el comercial) ${YA}`)
    expect(vistos.at(-1)!.mensajes).toContain(`(reenviado) ${R1}`)
    expect(t[0].texto).toContain('• Fecha de salida: 10 mar')
    expect(t[0].texto).not.toMatch(/el cliente dice/i)
  })
})

// ── 3. Una pregunta respondida no vuelve a salir ────────────────────────────────────────────────────────────────

describe('3 · una pregunta ya hecha no vuelve: se propone la lectura más probable y queda corregible', () => {
  it('el rango del regreso: la segunda vez el modelo vuelve a dudar, el código no la repite y deja el valor marcado', async () => {
    const vistos: Visto[] = []
    const PREGUNTA = '"regreso puede ser un rango de fecha": ¿entre qué fechas podría regresar?'
    const M1 = `${COD}: sale el 10 de marzo, el regreso puede ser un rango de fecha`
    const M2 = 'entre el 15 y el 20 de marzo'
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: M1 } } },
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: M2 } } },
    ])
    const extraer = extraccionGuionada([
      (textos) => crudo(textos, { fecha_salida: { valor: '2027-03-10', frase: 'sale el 10 de marzo' } }, [{ campo: 'fecha_regreso', pregunta: PREGUNTA }]),
      // Lo que hizo el modelo en vivo: vuelve a preguntar lo mismo aunque ya le contestaron (y esta vez propone el tope).
      (textos) => crudo(textos, {
        fecha_salida: { valor: '2027-03-10', frase: 'sale el 10 de marzo' },
        fecha_regreso: { valor: '2027-03-20', frase: 'entre el 15 y el 20 de marzo', como: 'deducido', calculo: 'el tope del rango' },
        fechas_tipo: { valor: 'moviles', frase: 'el regreso puede ser un rango de fecha', como: 'deducido' },
      }, [{ campo: 'fecha_regreso', pregunta: PREGUNTA }]),
    ], vistos)
    const e = await escenario({
      modelo, contactos: [PAULA], campos: CAMPOS, extraer,
      viajes: [{ id: 'v-1', codigo: COD, contactoId: 'c-paula', nombre: 'ARUBA', destino: 'Aruba', abierto: true, datos: {} }],
    })
    const t1 = await e.escribe(M1)
    expect(t1[0].texto).toMatch(/¿entre qué fechas podría regresar\?/i)
    const t2 = await e.escribe(M2)
    expect(t2[0].texto).not.toMatch(/entre qué fechas/i)
    expect(t2[0].texto).toContain('• Fecha de regreso: 20 mar (deducido)')
    // La extracción supo qué se le había preguntado ya.
    expect(vistos[1].instrucciones).toContain('Lo que ya le preguntaste')
    expect(vistos[1].instrucciones).toMatch(/¿entre qué fechas podría regresar\?/i)
    // En toda la conversación, la pregunta salió una sola vez.
    expect(delBot(e.almacen.filas).filter((t) => /entre qué fechas/i.test(t))).toHaveLength(1)
  })

  it('preguntasPrevias: las dudas de las propuestas de ESE viaje, sin repetir, con su campo', () => {
    const fila = (viajeId: string, duda?: string, dudaCampo?: string) => ({
      direccion: 'entrante', traza: { propuesta: { accion: 'anotar_en_viaje', datos: { viajeId, ...(duda ? { duda } : {}), ...(dudaCampo ? { dudaCampo } : {}) } } },
    }) as unknown as FilaConversacion
    expect(preguntasPrevias([fila('v-1', '¿Qué edad tiene?', 'edades_menores'), fila('v-2', '¿Otra?'), fila('v-1', '¿Qué edad tiene?', 'edades_menores'), fila('v-1')], 'v-1'))
      .toEqual([{ campo: 'edades_menores', texto: '¿Qué edad tiene?' }])
  })
})

// ── 4. Varios valores en un campo de una sola opción ────────────────────────────────────────────────────────────

describe('4 · «3, 4 y 5 estrellas» no traba: queda la más baja, marcada, y todo en la nota', () => {
  it('el prompt de la extracción lo pide, y si el modelo insiste en preguntar, la segunda vez el código propone', async () => {
    const vistos: Visto[] = []
    const PREGUNTA = '"Hoteles 3, 4 y 5 estrellas": ¿cuál categoría dejo? El campo guarda una sola opción.'
    const M1 = `${COD}: hoteles 3, 4 y 5 estrellas`
    const M2 = 'Categoría 3 y 4 estrellas'
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: M1 } } },
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: M2 } } },
    ])
    const extraer = extraccionGuionada([
      (textos) => crudo(textos, { requisitos_especiales: { valor: 'Hoteles de 3, 4 y 5 estrellas', frase: 'hoteles 3, 4 y 5 estrellas' } }, [{ campo: 'categoria_hotel', pregunta: PREGUNTA, opciones: ['3 estrellas', '4 estrellas', '5 estrellas'] }]),
      (textos) => crudo(textos, {
        categoria_hotel: { valor: '3', frase: 'Categoría 3 y 4 estrellas', como: 'deducido', calculo: 'nombró 3 y 4: queda la más baja' },
        requisitos_especiales: { valor: 'Hoteles de 3 o 4 estrellas', frase: 'Categoría 3 y 4 estrellas' },
      }, [{ campo: 'categoria_hotel', pregunta: PREGUNTA, opciones: ['3 estrellas', '4 estrellas'] }]),
    ], vistos)
    const e = await escenario({
      modelo, contactos: [PAULA], campos: CAMPOS, extraer,
      viajes: [{ id: 'v-1', codigo: COD, contactoId: 'c-paula', nombre: 'ARUBA', destino: 'Aruba', abierto: true, datos: {} }],
    })
    await e.escribe(M1)
    const t2 = await e.escribe(M2)
    expect(t2[0].texto).not.toMatch(/cuál categoría/i)
    expect(t2[0].texto).toContain('• Categoría de hotel: 3 estrellas (deducido)')
    expect(vistos[0].instrucciones).toMatch(/la más baja/)
    await e.toca('Anotar')
    expect(e.puerto.viajes[0].datos).toMatchObject({ categoria_hotel: '3', requisitos_especiales: 'HOTELES DE 3 O 4 ESTRELLAS' })
  })
})

// ── 5. La propuesta: lo que se confirma arriba y corto ──────────────────────────────────────────────────────────

describe('5 · la propuesta abre con lo que se confirma, sin citar la frase ni repetir lo que falta', () => {
  it('primera línea = la pregunta de confirmar; la duda sin comillas; «falta» solo si cambió', async () => {
    const M1 = `${COD}: son 2 adultos`
    const M2 = 'sin niños'
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: M1 } } },
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: COD, texto: M2 } } },
    ])
    const extraer = extraccionGuionada([
      (textos) => crudo(textos, { adultos: { valor: '2', frase: 'son 2 adultos' } }, [{ campo: 'ciudad_origen', pregunta: '"son 2 adultos": ¿desde qué ciudad salen?' }]),
      // Lo nuevo es de un campo que no cambia lo que falta para cotizar (los infantes siguen sin decirse).
      (textos) => crudo(textos, { adultos: { valor: '2', frase: 'son 2 adultos' }, requisitos_especiales: { valor: 'Sin niños', frase: 'sin niños' } }),
    ], [])
    const e = await escenario({
      modelo, contactos: [PAULA], campos: CAMPOS, extraer,
      viajes: [{ id: 'v-1', codigo: COD, contactoId: 'c-paula', nombre: 'ARUBA', destino: 'Aruba', abierto: true, datos: {} }],
    })
    const t1 = await e.escribe(M1)
    const l1 = t1[0].texto.split('\n')
    expect(l1[0]).toBe(`¿Lo anoto en ${COD} · ARUBA?`)
    expect(l1[1]).toBe('• Adultos: 2')
    expect(t1[0].texto).toContain('¿Desde qué ciudad salen?')
    expect(t1[0].texto).not.toContain('"son 2 adultos"')
    expect(l1.filter((l) => /^Falta para cotizar/.test(l))).toHaveLength(1)
    const t2 = await e.escribe(M2)
    // Lo que falta no cambió: no se repite la lista.
    expect(t2[0].texto.split('\n').filter((l) => /falta/i.test(l))).toEqual([])
    expect(t2[0].texto.split('\n')[0]).toBe(`¿Lo anoto en ${COD} · ARUBA?`)
  })

  it('sinFraseCitada quita la frase entre comillas de adelante (una o dos), y deja igual lo que no la trae', () => {
    expect(sinFraseCitada('"ya te dije la fecha": ¿cuál es el regreso?')).toBe('¿Cuál es el regreso?')
    expect(sinFraseCitada('"Hoteles 3, 4 y 5" y "Categoría 3 y 4": ¿cuál dejo?')).toBe('¿Cuál dejo?')
    expect(sinFraseCitada('«Económico»: lo dejo como nota')).toBe('Lo dejo como nota')
    expect(sinFraseCitada('¿Es por persona o en total?')).toBe('¿Es por persona o en total?')
  })
})

// ── La conducta común en el prompt del núcleo ───────────────────────────────────────────────────────────────────

describe('la conducta común está en el prompt del núcleo (todos los dominios)', () => {
  it('no repetir lo contestado, no confundir autor, texto corto con propuesta', async () => {
    const p = promptNucleo(await reglamentoDePrueba(), 4)
    expect(p).toMatch(/no lo vuelvas a preguntar/)
    expect(p).toMatch(/nunca le atribuyas al cliente lo que escribió él/)
    expect(p).toMatch(/sin repetir el resumen ni la lista de lo que falta/)
  })
})

// ── Piezas ──────────────────────────────────────────────────────────────────────────────────────────────────────

describe('tandaDelViaje: de quién es un reenvío sin cargar', () => {
  const f = (id: string, extra: Partial<FilaConversacion>) => ({ id, direccion: 'entrante', clase: 'escrito', texto: '', turno_id: 't', traza: null, ...extra }) as unknown as FilaConversacion
  it('el del viaje nombrado antes; si no hubo ninguno antes, el que se nombró después', () => {
    const filas = [
      f('r1', { clase: 'reenvio', texto: 'Somos dos' }),
      f('e1', { texto: 'esto es para P1 26 1' }),
      f('r2', { clase: 'reenvio', texto: 'del 3 al 9' }),
      f('e2', { texto: 'ahora el de M1 26 2' }),
      f('r3', { clase: 'reenvio', texto: 'cuatro adultos' }),
    ]
    const t = tanda(filas)
    expect(tandaDelViaje(filas, t, 'P1 26 1', opcionNombrada).map((x) => x.id)).toEqual(['r1', 'r2'])
    expect(tandaDelViaje(filas, t, 'M1 26 2', opcionNombrada).map((x) => x.id)).toEqual(['r3'])
  })
})
