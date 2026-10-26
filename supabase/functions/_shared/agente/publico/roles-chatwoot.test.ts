import { describe, expect, it } from 'vitest'
import { catalogoDe } from '../funciones/catalogo'
import { FUNCIONES_COMUNES } from '../funciones/comunes'
import type { Funcion } from '../funciones/tipos'
import { declaraciones } from '../herramientas'
import { modeloGuionado } from '../modelo-guionado'
import { dominioYReglamento } from './cola'
import { WS_PUBLICO, escenarioPublico } from './escenario'
import { pistasDeFunciones } from '../pistas'
import { TODOS_LOS_CASOS } from './arnes/conjuntos'
import { correrCaso } from './arnes/correr-caso'

/**
 * El canal de Chatwoot con un ROL compuesto (spec 2026-10-26, §3.1): Sabor sale el 29-oct como un rol asignado por su
 * inbox. Lo particular de Sabor (partir el dominio público en `clientes.*` y su ficha `asesor_vendedor`) lo hace la
 * sesión de Sabor; aquí, un catálogo DE PRUEBA sobre el motor `publico` prueba que el camino existe:
 *   · un rol con parte de las funciones declara exactamente esas herramientas (más `pasar_a_persona`, común);
 *   · con todas, el arnés en seco da LO MISMO que sobre el dominio público entero (la igualdad que pide §3.1).
 */

const f = (clave: string, h: Funcion['herramientas']['x']): Funcion => ({ clave, familia: 'clientes', queHace: '', herramientas: { publico: h }, candados: [], fichas: [] })
const PRUEBA_FICHA = f('clientes.prueba_ficha', { lecturas: ['ver_catalogo', 'ver_funciones'] })
const PRUEBA_REGLAS = f('clientes.prueba_reglas', { lecturas: ['consultar_reglas'], cierres: ['respuesta_fija'] })
const PRUEBA_RESERVA = f('clientes.prueba_reserva', { acciones: ['reserva'] })
const CATALOGO_PRUEBA = catalogoDe([...FUNCIONES_COMUNES, PRUEBA_FICHA, PRUEBA_REGLAS, PRUEBA_RESERVA])
const TODAS = ['clientes.prueba_ficha', 'clientes.prueba_reglas', 'clientes.prueba_reserva']

describe('chatwoot: un rol de prueba sobre el motor publico', () => {
  it('con solo la ficha: ver_catalogo, ver_funciones, pasar_a_persona (común) y responder; sin proponer', async () => {
    const e = await escenarioPublico({ modelo: modeloGuionado([]), funciones: ['clientes.prueba_ficha'], catalogo: CATALOGO_PRUEBA })
    const { dominio, reglamento } = dominioYReglamento(e.deps)
    expect(declaraciones(dominio, reglamento).map((d) => d.name)).toEqual(['ver_catalogo', 'ver_funciones', 'pasar_a_persona', 'responder'])
  })

  it('con todas: las mismas herramientas que el dominio público entero', async () => {
    const con = await escenarioPublico({ modelo: modeloGuionado([]), funciones: TODAS, catalogo: CATALOGO_PRUEBA })
    const sin = await escenarioPublico({ modelo: modeloGuionado([]) })
    const nombres = (d: ReturnType<typeof dominioYReglamento>) => declaraciones(d.dominio, d.reglamento).map((x) => [x.name, x.description])
    expect(nombres(dominioYReglamento(con.deps))).toEqual(nombres(dominioYReglamento(sin.deps)))
  })

  it('la traza del turno trae el rol', async () => {
    const rol = { clave: 'asesor_vendedor', id: 'rol-1', version: 1, reglamento_id: 'reg-1', por: 'inbox' as const, funciones: TODAS.map((x) => ({ funcion: x, parametros: {} })) }
    const e = await escenarioPublico({
      modelo: modeloGuionado([{ name: 'responder', args: { tema: 'saludo', texto: '¡Hola! ¿En qué te ayudo?' } }]),
      funciones: TODAS, catalogo: CATALOGO_PRUEBA, rol,
    })
    await e.escribe('hola')
    expect(e.trazas().every((t) => t.rol?.clave === 'asesor_vendedor')).toBe(true)
  })
})

describe('la igualdad del arnés de Sabor: el rol compuesto con todas las funciones da lo mismo que dominioPublico (seco)', () => {
  for (const caso of TODOS_LOS_CASOS) {
    it(`${caso.conjunto} · ${caso.id}`, async () => {
      const [sin, con] = await Promise.all([
        correrCaso(caso, { modelo: null, k: 1 }),
        correrCaso(caso, { modelo: null, k: 1, rol: { funciones: TODAS, catalogo: CATALOGO_PRUEBA } }),
      ])
      const de = (r: typeof sin) => ({ pasa: r.pasa, exito: r.corridas[0].exito, daninas: r.corridas[0].daninas, transcripcion: r.corridas[0].transcripcion })
      expect(de(con)).toEqual(de(sin))
    }, 30_000)
  }
})

describe('las funciones del rol aportan pistas a la transcripción (gancho Funcion.pistas, §4.6)', () => {
  const CON_PISTAS: Funcion = {
    ...f('clientes.prueba_pistas', { lecturas: ['ver_funciones'] }),
    pistas: async (c) => ['Cata de vinos', `Experiencia ${String(c.parametros.experiencia)}`],
  }
  // Pide algo que el rol no trae: el componedor la deja fuera y sus pistas no entran.
  const FUERA: Funcion = { ...f('clientes.prueba_fuera', {}), requiere: ['clientes.no_esta'], pistas: async () => ['No debe aparecer'] }
  const CATALOGO = catalogoDe([...FUNCIONES_COMUNES, PRUEBA_FICHA, CON_PISTAS, FUERA])
  const FUNCIONES = [{ funcion: 'clientes.prueba_pistas', parametros: { experiencia: 'Noche de Henna' } }, { funcion: 'clientes.prueba_fuera', parametros: {} }]
  const modelo = () => modeloGuionado([{ name: 'responder', args: { tema: 'saludo', texto: '¡Hola! ¿En qué te ayudo?' } }])

  it('con el interruptor y un rol: el transcriptor recibe las funciones compuestas y sus pistas salen con sus parámetros', async () => {
    const e = await escenarioPublico({ modelo: modelo(), funciones: FUNCIONES, catalogo: CATALOGO, config: { transcripcion: { pistas: true, tope: 40 } } })
    await e.audio('quiero la cata')
    expect(e.transcriptor.pedidos).toHaveLength(1)
    const fuentes = e.transcriptor.pedidos[0].fuentesDePistas
    expect(fuentes).toBeDefined()
    expect(await pistasDeFunciones(fuentes!, WS_PUBLICO)).toEqual(['Cata de vinos', 'Experiencia Noche de Henna'])
  })

  it('con el interruptor apagado (por defecto): el transcriptor recibe lo mismo que antes, sin fuentes', async () => {
    const e = await escenarioPublico({ modelo: modelo(), funciones: FUNCIONES, catalogo: CATALOGO })
    await e.audio('quiero la cata')
    expect(e.transcriptor.pedidos).toHaveLength(1)
    expect('fuentesDePistas' in e.transcriptor.pedidos[0]).toBe(false)
  })

  it('con el interruptor y sin rol: tampoco hay fuentes', async () => {
    const e = await escenarioPublico({ modelo: modelo(), config: { transcripcion: { pistas: true, tope: 40 } } })
    await e.audio('quiero la cata')
    expect('fuentesDePistas' in e.transcriptor.pedidos[0]).toBe(false)
  })
})
