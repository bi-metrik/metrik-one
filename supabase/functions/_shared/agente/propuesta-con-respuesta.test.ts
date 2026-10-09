import { describe, expect, it, vi } from 'vitest'
import { leerConfigAgente } from './config'
import { promptNucleo, sistema, tokens, TOPES_BLOQUE } from './contexto'
import { escenario, reglamentoDePrueba } from './escenario'
import { declaraciones } from './herramientas'
import { modeloGemini } from './modelo-gemini'
import { modeloGuionado } from './modelo-guionado'
import { mismaPropuesta, propuestaVigente, salidaPropuesta, TEXTO_PROPUESTA_PENDIENTE } from './nucleo'
import { META } from './render'
import type { Modelo } from './tipos'

/**
 * La falla en vivo del 2026-10-07 (bandeja de Trappvel, número de prueba), rehecha con datos INVENTADOS:
 *   Turno 1: «viaje nuevo a San Andrés para <cliente>. ¿Ya tenemos algo abierto?» → buscar → proponer. Salía SOLO el
 *            resumen con botones: la pregunta nunca se contestaba.
 *   Turno 2: «antes dime qué tenemos abierto» → buscar → consultar_reglas → proponer la MISMA propuesta. Salía idéntico
 *            el mismo botón.
 * Cliente inventado: «Rosa Quintero», cel. …4821, con 5 viajes abiertos.
 */

const ROSA = { id: 'c-rosa', nombre: 'ROSA QUINTERO', celular: '3104564821' }
const NOMBRES = ['EUROPA 2 DIAS', 'CANCUN', 'CARTAGENA', 'MADRID', 'PANAMA']
const VIAJES = NOMBRES.map((nombre, i) => ({ id: `v-${i + 1}`, codigo: `Q1 26 ${i + 1}`, contactoId: 'c-rosa', nombre, destino: null, abierto: true, datos: {} }))
const ref = 'Rosa Quintero (cel. …4821)'
const TURNO_1 = 'Vamos a registrar un nuevo viaje. Es a San Andrés y es para Rosa Quintero. Ya tenemos algo abierto para Rosa Quintero?'
const TURNO_2 = 'antes dime que tenemos abierto de Rosa Quintero'
const RESPUESTA_1 = 'Rosa Quintero tiene 5 viajes abiertos: Q1 26 1 Europa 2 Dias, Q1 26 2 Cancun, Q1 26 3 Cartagena, Q1 26 4 Madrid y Q1 26 5 Panama. ¿Abro uno nuevo a San Andrés?'
const RESPUESTA_2 = 'Tiene abiertos Q1 26 1 Europa 2 Dias, Q1 26 2 Cancun, Q1 26 3 Cartagena, Q1 26 4 Madrid y Q1 26 5 Panama. El viaje nuevo a San Andrés sigue esperando tu toque.'
const RESUMEN = '¿Abro este viaje?\nRosa Quintero (cel. …4821) · San Andrés · Viaje a medida'
const PROPONER = { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'San Andrés' } }

describe('falla en vivo 2026-10-07: preguntar y proponer en el mismo turno', () => {
  it('turno 1: la respuesta a la pregunta sale ARRIBA del resumen, en el mismo mensaje de botones', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: { ...PROPONER, texto: RESPUESTA_1 } },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    const t1 = await e.escribe(TURNO_1)
    expect(t1).toHaveLength(1)
    expect(t1[0].tipo).toBe('botones')
    expect(t1[0].texto).toBe(`${RESPUESTA_1}\n${RESUMEN}`)
    expect('opciones' in t1[0] && t1[0].opciones.map((o) => o.titulo)).toEqual(['Sí, ábrelo', 'No'])
    expect(e.puerto.escrituras).toEqual([])
    // El modelo supo que podía contestar ahí: `texto` está en la declaración de `proponer`.
    const decl = modelo.pedidos[0].herramientas.find((h) => h.name === 'proponer')!
    expect(Object.keys((decl.parameters as { properties: object }).properties)).toContain('texto')
    // Y el toque abre el viaje.
    const t = await e.toca('Sí, ábrelo')
    expect(t[0].texto).toContain('Abrí Q1 26 6 · San Andrés para Rosa Quintero.')
  })

  it('turno 2: la MISMA propuesta no se rearma; se reenvía la pendiente (misma huella, con botones) con la respuesta arriba', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: { ...PROPONER, texto: RESPUESTA_1 } },
      // Turno 2, como en la traza: buscar y otra vez la misma propuesta (en vivo hubo además un consultar_reglas, que
      // ya no existe: las fichas de índice van completas en el sistema).
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: { ...PROPONER, texto: RESPUESTA_2 } },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    await e.escribe(TURNO_1)
    const antes = propuestaVigente(e.almacen.filas)!
    const t2 = await e.escribe(TURNO_2)
    expect(t2).toEqual([salidaPropuesta(antes, RESPUESTA_2)])
    expect(t2[0].texto).toBe(`${RESPUESTA_2}\n${RESUMEN}`)
    const traza = e.trazas().filter((x) => x.tipo === 'modelo').at(-1)!
    expect(traza.candados).toEqual([expect.objectContaining({ candado: 'propuesta_repetida' })])
    expect(traza.propuesta ?? null).toBeNull()
    // La pendiente es la misma de antes (misma huella): el botón del turno 1 sigue sirviendo.
    expect(propuestaVigente(e.almacen.filas)!.huella).toBe(antes.huella)
    expect(modelo.restantes()).toBe(0)
    const t = await e.toca('Sí, ábrelo')
    expect(t[0].texto).toContain('Abrí Q1 26 6 · San Andrés para Rosa Quintero.')
    expect(e.puerto.escrituras.filter((x) => x.tipo === 'viaje')).toHaveLength(1)
  })

  it('turno 2 sin texto (lo que hizo el respaldo en vivo): la pendiente se reenvía con sus botones y una línea fija arriba', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: PROPONER },
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: PROPONER },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    const t1 = await e.escribe(TURNO_1)
    expect(t1[0].texto).toBe(RESUMEN)
    const antes = propuestaVigente(e.almacen.filas)!
    const t2 = await e.escribe(TURNO_2)
    expect(t2).toEqual([salidaPropuesta(antes, TEXTO_PROPUESTA_PENDIENTE)])
    expect(propuestaVigente(e.almacen.filas)!.huella).toBe(antes.huella)
    expect(e.trazas().at(-1)!.respuesta_fija).toBe('propuesta_pendiente')
    await e.toca('Sí, ábrelo')
    expect(e.puerto.escrituras.filter((x) => x.tipo === 'viaje')).toHaveLength(1)
  })

  it('una propuesta DISTINTA a la pendiente sí sale (otro destino)', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: PROPONER },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref, destino: 'Cartagena' } } },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    await e.escribe(TURNO_1)
    const t2 = await e.escribe('no, mejor a Cartagena')
    expect(t2[0].tipo).toBe('botones')
    expect(t2[0].texto).toContain('· Cartagena ·')
  })

  it('una propuesta ya rechazada no es pendiente: volver a proponerla sí sale', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: PROPONER },
      { name: 'proponer', args: PROPONER },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    await e.escribe(TURNO_1)
    await e.toca('No')
    const t = await e.escribe('ahora sí, ábrelo a San Andrés')
    expect(t[0].tipo).toBe('botones')
  })

  it('el texto de proponer pasa por el verificador: un código inventado vuelve al modelo; a la segunda sale solo el resumen', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: { ...PROPONER, texto: 'Tiene el Q1 26 9 abierto. ¿Abro otro?' } },
      { name: 'proponer', args: { ...PROPONER, texto: 'Ya creé el Q1 26 9.' } },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    const t = await e.escribe(TURNO_1)
    expect(t).toHaveLength(1)
    expect(t[0].texto).toBe(RESUMEN)
    const traza = e.trazas().find((x) => x.tipo === 'modelo')!
    expect(traza.verificador).toHaveLength(2)
    expect(traza.verificador![0].motivo).toContain('Q1 26 9')
    expect(JSON.stringify(modelo.pedidos[2].mensajes.at(-1))).toContain('No se envió porque el `texto`')
  })

  it('el texto de proponer respeta el tope de caracteres: el primer intento largo vuelve al modelo', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rosa Quintero' } },
      { name: 'proponer', args: { ...PROPONER, texto: 'Tiene viajes abiertos. '.repeat(40) } },
      { name: 'proponer', args: { ...PROPONER, texto: 'Tiene 5 viajes abiertos. ¿Abro uno nuevo?' } },
    ])
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES })
    const t = await e.escribe(TURNO_1)
    expect(t[0].texto).toBe(`Tiene 5 viajes abiertos. ¿Abro uno nuevo?\n${RESUMEN}`)
    expect(e.trazas().find((x) => x.tipo === 'modelo')!.candados!.map((c) => c.candado)).toEqual(['formato_meta'])
  })
})

describe('el mensaje de una propuesta respeta el cuerpo de botones de Meta', () => {
  const p = { huella: 'abc', resumen: RESUMEN, si: 'Sí, ábrelo', no: 'No' }
  it('arriba + resumen nunca pasa de 1024; se corta lo de arriba, el resumen queda entero', () => {
    const s = salidaPropuesta(p, 'palabra '.repeat(200))
    expect([...s.texto].length).toBeLessThanOrEqual(META.cuerpoBotones)
    expect(s.texto.endsWith(RESUMEN)).toBe(true)
  })
  it('sin arriba, solo el resumen', () => {
    expect(salidaPropuesta(p).texto).toBe(RESUMEN)
    expect(salidaPropuesta(p, null).texto).toBe(RESUMEN)
  })
})

describe('mismaPropuesta', () => {
  it('compara acción y datos sin importar el orden de las llaves (jsonb no lo guarda)', () => {
    expect(mismaPropuesta({ accion: 'a', datos: { x: 1, y: [1, 2] } }, { accion: 'a', datos: { y: [1, 2], x: 1 } })).toBe(true)
    expect(mismaPropuesta({ accion: 'a', datos: { x: 1 } }, { accion: 'b', datos: { x: 1 } })).toBe(false)
    expect(mismaPropuesta({ accion: 'a', datos: { x: 1 } }, { accion: 'a', datos: { x: 2 } })).toBe(false)
    expect(mismaPropuesta({ accion: 'a', datos: { y: [1, 2] } }, { accion: 'a', datos: { y: [2, 1] } })).toBe(false)
  })
})

describe('el prompt pide contestar lo preguntado', () => {
  it('la regla va en el prompt del núcleo sin pasarse de su tope (no se recorta)', async () => {
    const r = await reglamentoDePrueba()
    const c = leerConfigAgente({ agente: true })
    const p = promptNucleo(r, c.topes.llamados)
    expect(p).toContain('en el `texto` de `proponer`')
    expect(tokens(p)).toBeLessThanOrEqual(TOPES_BLOQUE.nucleo)
    expect(sistema(r, c).texto).toContain(p)
  })
  it('la declaración de proponer dice que la respuesta va en texto y que no se repite la pendiente', async () => {
    const r = await reglamentoDePrueba()
    const e = await escenario({ modelo: modeloGuionado([]) })
    const d = declaraciones(e.deps.dominio, r).find((x) => x.name === 'proponer')!
    expect(d.description).toContain('la respuesta va en `texto`')
    expect(d.description).toContain('no la repitas')
  })
})

describe('corte y respaldo se leen de bot_conversacional.agente_config (sin deploy)', () => {
  it('corte_ms y respaldo se cambian por workspace; el default sigue en 2500 y 3.5-flash-lite', () => {
    expect(leerConfigAgente({ agente: true }).corteMs).toBe(2500)
    const c = leerConfigAgente({ agente: true, agente_config: { corte_ms: 4000, respaldo: { modelo: 'gemini-otro', razonamiento: 'LOW' } } })
    expect(c.corteMs).toBe(4000)
    expect(c.respaldo).toEqual({ modelo: 'gemini-otro', razonamiento: 'LOW', temperatura: null, maxSalida: 2048 })
  })

  it('el turno 1 con el adaptador de Gemini (red falsa): el principal se corta en corte_ms y el respaldo propone con texto', async () => {
    const c = leerConfigAgente({ agente: true, agente_config: { corte_ms: 150 } })
    const urls: string[] = []
    const respuesta = (functionCall: unknown) => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ functionCall }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 20, thoughtsTokenCount: 0, cachedContentTokenCount: 0 },
    }), { status: 200 })
    let n = 0
    const f = vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url.split('/models/')[1])
      // El principal responde el primer llamado; en el segundo (después de buscar) se cuelga y se corta.
      if (url.includes(c.principal.modelo) && n++ > 0) {
        await new Promise((_, rej) => init.signal!.addEventListener('abort', () => rej(Object.assign(new Error('t'), { name: 'TimeoutError' }))))
      }
      return n === 1
        ? respuesta({ name: 'buscar', args: { texto: 'Rosa Quintero' } })
        : respuesta({ name: 'proponer', args: { ...PROPONER, texto: RESPUESTA_1 } })
    })
    const modelo: Modelo = modeloGemini({ llave: 'llave-falsa', principal: c.principal, respaldo: c.respaldo, corteMs: c.corteMs, fetch: f as unknown as typeof fetch })
    const e = await escenario({ modelo, contactos: [ROSA], viajes: VIAJES, config: c })
    const t1 = await e.escribe(TURNO_1)
    expect(urls).toEqual(['gemini-3.8-flash:generateContent', 'gemini-3.8-flash:generateContent', 'gemini-3.5-flash-lite:generateContent'])
    expect(t1[0].texto).toBe(`${RESPUESTA_1}\n${RESUMEN}`)
    const traza = e.trazas().find((x) => x.tipo === 'modelo')!
    expect(traza.uso!.map((u) => [u.modelo, u.ok, u.motivo ?? null])).toEqual([
      ['gemini-3.8-flash', true, null], ['gemini-3.8-flash', false, 'corte'], ['gemini-3.5-flash-lite', true, null],
    ])
  })
})
