import { describe, expect, it } from 'vitest'
import { escenario, reglamentoDePrueba } from './escenario'
import { declaraciones } from './herramientas'
import { propuestaVigente } from './nucleo'
import { modeloGuionado } from './modelo-guionado'

/**
 * Arnés con Gemini real, 2026-10-14 (c1-1215; datos inventados aquí): con «¿Cargo esto en D1 26 1?» pendiente, el modelo
 * contestó con `responder` y sus PROPIOS botones [Cargar] [No], que no ejecutan. El arreglo es de prompt: `proponer` pide
 * volver a llamarla (el sistema reenvía la pendiente con sus botones reales). Lo que NO cambia: solo el toque del botón
 * real de la propuesta (o el «sí» solo) escribe. Un toque de un botón de conversación que el modelo lee como la misma
 * propuesta no ejecuta: reenvía la pendiente con sus botones (`propuesta_repetida`).
 */

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const REENVIO = 'Hola, ya nos decidimos: salimos el 20 de noviembre, vamos 2 adultos'
const VIAJES = [{ id: 'v-2', codigo: 'M1 26 2', contactoId: 'c-martin', nombre: 'MIAMI', destino: null, abierto: true, datos: {} }]

describe('un toque de conversación nunca escribe, aunque el modelo lo lea como la pendiente', () => {
  it('el [Cargar] de `responder` + re-propuesta igual: no escribe, reenvía la pendiente con sus botones reales; el real sí carga', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'M1 26 2' } } },
      { name: 'responder', args: { tema: 'viaje', texto: 'Es M1 26 2.', opciones: [{ titulo: 'Cargar' }, { titulo: 'No' }] } },
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
    expect(e.puerto.escrituras).toEqual([])
    expect(r3[0].opciones?.map((o: { id: string }) => o.id)).toEqual([`ag|p|${p.huella}|si`, `ag|p|${p.huella}|no`])
    expect(e.almacen.filas.at(-2)!.traza!.candados?.map((c) => c.candado)).toContain('propuesta_repetida')
    expect(propuestaVigente(e.almacen.filas)?.huella).toBe(p.huella)

    // El botón real de la propuesta sí carga.
    await e.toca('Cargar')
    expect(e.puerto.escrituras.filter((x) => x.tipo !== 'descarte')).toHaveLength(1)
    expect(modelo.restantes()).toBe(0)
  })

  it('las declaraciones: `proponer` pide llamarla igual y `responder` no imita los botones que escriben', async () => {
    const r = await reglamentoDePrueba()
    const e = await escenario({ modelo: modeloGuionado([]) })
    const d = declaraciones(e.deps.dominio, r)
    expect(d.find((x: { name: string }) => x.name === 'proponer')!.description).toContain('llámala igual')
    expect(d.find((x: { name: string }) => x.name === 'responder')!.description).toContain('Las `opciones` son para elegir, no para confirmar')
  })
})
