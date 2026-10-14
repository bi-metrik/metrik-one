import { describe, expect, it } from 'vitest'
import { escenario, reglamentoDePrueba } from './escenario'
import { declaraciones } from './herramientas'
import { propuestaVigente, soloToques } from './nucleo'
import { modeloGuionado } from './modelo-guionado'
import { calificar } from './arnes/calificar'
import type { FilaConversacion } from './tipos'

/**
 * Arnés con Gemini real, 2026-10-14 (c1-1215; datos inventados): ante «el de san andrés», con «¿Lo anoto en M1 26 2?»
 * pendiente, el modelo contestó con `responder` «Toca Cargar en el mensaje anterior» y sus PROPIOS botones [Cargar] [No].
 * Esos botones no ejecutan nada: el toque volvió al modelo, que propuso lo mismo; `propuesta_repetida` lo frenó y no se
 * cargó nada. Principio: un botón que el comercial ve ejecuta algo.
 * Ahora: (1) si lo que llegó son solo toques y el modelo los lee como la MISMA propuesta pendiente, se ejecuta como el
 * toque de su botón (mismo candado por huella); (2) la declaración de `proponer` pide llamarla igual en vez de imitarla en
 * `responder` (el sistema reenvía la pendiente con sus botones).
 */

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const REENVIO = 'Hola, ya nos decidimos: salimos el 20 de noviembre, vamos 2 adultos'
const VIAJES = [{ id: 'v-2', codigo: 'M1 26 2', contactoId: 'c-martin', nombre: 'MIAMI', destino: null, abierto: true, datos: {} }]

describe('un toque de la conversación que el modelo lee como la propuesta pendiente la ejecuta', () => {
  it('el [Cargar] que pintó `responder` ejecuta la pendiente, una sola vez', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      // «el de miami»: el modelo imita los botones de la propuesta (lo que pasó con Gemini real).
      { name: 'responder', args: { tema: 'viaje', texto: 'Es M1 26 2. Toca «Cargar» en el mensaje anterior.', opciones: [{ titulo: 'Cargar' }, { titulo: 'No' }] } },
      // [toque: Cargar] (de la conversación): el modelo lo lee como la misma propuesta.
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia(REENVIO)
    await e.escribe('eso es de Martín, al M1 26 2')
    const p = propuestaVigente(e.almacen.filas)!
    expect(p.accion).toBe('cargar_tanda')
    const r2 = await e.escribe('el de miami')
    expect(r2[0].opciones?.[0].id).toMatch(/^ag\|c\|/)

    const r3 = await e.toca('Cargar')
    expect(r3).toHaveLength(1)
    expect(r3[0].texto).toContain('M1 26 2')
    expect(e.puerto.escrituras.filter((x) => x.tipo !== 'descarte')).toHaveLength(1)
    // La traza es del modelo (cuenta en el uso) con la ejecución de la pendiente.
    const traza = e.almacen.filas.at(-2)!.traza!
    expect(traza.tipo).toBe('modelo')
    expect(traza.toque_resuelto).toEqual({ huella: p.huella })
    expect(traza.ejecucion?.resultado).toBe('ejecutada')
    expect(traza.llamados).toBe(1)
    expect(propuestaVigente(e.almacen.filas)).toBeNull()

    // El arnés no la cuenta como escritura sin toque.
    const pasos = e.pasos
    const r = calificar({ id: 'x', conjunto: 1, titulo: 'x', pasos: [], esperado: () => ({ ok: true, motivo: '' }) } as never, pasos, e.puerto, pasos.flatMap((x) => x.trazas), [])
    expect(r.daninas).toEqual([])
  })

  it('un ESCRITO que el modelo lee como la pendiente no ejecuta: reenvía la pendiente con sus botones', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' }, texto: 'Es M1 26 2.' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia(REENVIO)
    await e.escribe('eso es de Martín, al M1 26 2')
    const p = propuestaVigente(e.almacen.filas)!
    const r = await e.escribe('el de miami')
    expect(r[0].texto.startsWith('Es M1 26 2.\n')).toBe(true)
    expect(r[0].opciones?.map((o) => o.id)).toEqual([`ag|p|${p.huella}|si`, `ag|p|${p.huella}|no`])
    expect(e.puerto.escrituras).toEqual([])
    expect(propuestaVigente(e.almacen.filas)?.huella).toBe(p.huella)
  })

  it('un toque que el modelo lee como OTRA propuesta no ejecuta nada: sale la nueva', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      { name: 'responder', args: { tema: 'viaje', texto: '¿Qué hago?', opciones: [{ titulo: 'Viaje nuevo' }, { titulo: 'Seguir' }] } },
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: 'Martin Mora (cel. …7311)' } } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.reenvia(REENVIO)
    await e.escribe('eso es de Martín, al M1 26 2')
    await e.escribe('mejor otra cosa')
    const r = await e.toca('Viaje nuevo')
    expect(r[0].texto).toContain('¿Abro este viaje?')
    expect(e.puerto.escrituras).toEqual([])
  })

  it('soloToques mira la clase de las filas, sin contar reenvíos', () => {
    const f = (clase: FilaConversacion['clase']) => ({ clase }) as FilaConversacion
    expect(soloToques([f('toque')])).toBe(true)
    expect(soloToques([f('reenvio'), f('toque')])).toBe(true)
    expect(soloToques([f('toque'), f('escrito')])).toBe(false)
    expect(soloToques([f('reenvio')])).toBe(false)
    expect(soloToques([])).toBe(false)
  })

  it('las declaraciones: `proponer` pide llamarla igual y `responder` no imita los botones que escriben', async () => {
    const r = await reglamentoDePrueba()
    const e = await escenario({ modelo: modeloGuionado([]) })
    const d = declaraciones(e.deps.dominio, r)
    expect(d.find((x) => x.name === 'proponer')!.description).toContain('llámala igual')
    expect(d.find((x) => x.name === 'responder')!.description).toContain('Las `opciones` son para elegir, no para confirmar')
  })
})
