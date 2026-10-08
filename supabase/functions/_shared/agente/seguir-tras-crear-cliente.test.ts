import { describe, expect, it } from 'vitest'
import { escenario } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { propuestaVigente } from './nucleo'
import { sumarUso } from './uso'
import type { PedidoModelo } from './tipos'

/**
 * Falla en vivo (bandeja de Trappvel, 2026-10-07 17:25): la comercial pidió una cotización con destino, fechas y
 * pasajeros; el bot pidió a nombre de quién, propuso crear al cliente, ella tocó «Crear» y el bot contestó «Creé a…» y
 * ahí terminó: la solicitud quedó sin viaje. Rehecha con datos INVENTADOS (otro cliente, otro destino, otras fechas).
 *
 * Desde aquí, después de crear un cliente el modelo tiene un turno para seguir: él decide si quedó una solicitud
 * pendiente (propone el viaje) o no (`terminar`, y queda la confirmación sola). El código no lee el texto.
 * Los modelos son guiones: ninguna llamada a un modelo real.
 */

const PEDIDO = 'Necesito que me ayudes con una cotizacion para 3 adultos + 1 menor de 6 años para Punta Cana del 10 al 15 de marzo 2027'
const DATOS_CLIENTE = 'Camilo Rojas 3005550199 camilo.prueba@ejemplo.co'
const REF = 'Camilo Rojas (cel. …0199)'

const estadoDe = (p: PedidoModelo) => String(p.mensajes[0].parts[0].text ?? '')

describe('después de crear un cliente, el modelo sigue con la solicitud pendiente', () => {
  it('toque «Crear» → un solo mensaje: la confirmación y debajo la propuesta del viaje; el viaje lee el pedido inicial', async () => {
    const modelo = modeloGuionado([
      // Turno 1: el pedido sin cliente.
      { name: 'responder', args: { tema: 'solicitud', texto: '¿A nombre de quién creamos la solicitud y cuál es su celular o correo?' } },
      // Turno 2: el cliente con su llave → no existe → proponer crearlo.
      { name: 'buscar', args: { texto: DATOS_CLIENTE } },
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Camilo Rojas', llave: '3005550199' } } },
      // Turno que sigue al toque: el modelo ve el hecho y decide seguir con el viaje, desde el mensaje del pedido (#1).
      (p) => {
        expect(estadoDe(p)).toContain(`Acaba de quedar hecho, con el toque de el comercial: Creé a ${REF}.`)
        expect(estadoDe(p)).toContain('Propuesta pendiente: ninguna.')
        expect(p.herramientas.map((h) => h.name)).toContain('terminar')
        return { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, destino: 'Punta Cana', desde: 1 } } }
      },
    ])
    const e = await escenario({ modelo })

    await e.escribe(PEDIDO)
    const t2 = await e.escribe(DATOS_CLIENTE)
    expect(t2[0].texto).toBe('¿Creo este cliente?\nCamilo Rojas · cel. …0199')

    const t3 = await e.toca('Crear')
    // Un solo mensaje, en orden: lo hecho arriba, la propuesta debajo, con sus botones.
    expect(t3).toHaveLength(1)
    expect(t3[0]).toMatchObject({ tipo: 'botones', texto: `Creé a ${REF}.\n¿Abro este viaje?\n${REF} · Punta Cana · Viaje a medida` })
    expect('opciones' in t3[0] && t3[0].opciones.map((o) => o.titulo)).toEqual(['Sí, ábrelo', 'No'])
    // Se creó el cliente; el viaje todavía no (espera su toque).
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['cliente'])
    expect(modelo.restantes()).toBe(0)

    // La traza: un turno del modelo (cuenta en el uso del mes) que conserva la ejecución del toque.
    const t = e.pasos.at(-1)!.trazas.at(-1)!
    expect(t.tipo).toBe('modelo')
    expect(t.ejecucion).toMatchObject({ accion: 'crear_cliente', resultado: 'ejecutada' })
    expect(t.tras_toque).toEqual({ origen: 'toque_propuesta', resultado: 'propuesta' })
    expect(t.propuesta?.accion).toBe('viaje_nuevo')
    expect(sumarUso([t], []).turnos).toBe(1)
    const filas = await e.almacen.leer(e.deps.workspaceId, e.deps.phone, '2000-01-01')
    expect(propuestaVigente(filas)?.accion).toBe('viaje_nuevo')

    // Abrir el viaje: lo que el comercial dijo ANTES de crear al cliente va a la propuesta de anotar.
    const t4 = await e.toca('Sí, ábrelo')
    expect(t4[0].texto).toContain('Abrí C1 26 1 · Punta Cana para Camilo Rojas.')
    expect(t4[0].texto).toContain('¿Lo anoto en C1 26 1')
    expect(t4[0].texto).toContain(`• ${PEDIDO.slice(0, 70)}`)
    await e.toca('Anotar')
    expect(e.puerto.escrituras.at(-1)).toMatchObject({ tipo: 'carga', codigo: 'C1 26 1' })
    expect((e.puerto.escrituras.at(-1)!.textos as string[])[0]).toBe(PEDIDO)
  })

  it('sin nada pendiente (solo quería crear el cliente): el modelo termina y queda la confirmación sola', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Camilo Rojas', llave: '300 555 0199' } } },
      { name: 'terminar', args: {} },
    ])
    const e = await escenario({ modelo })
    await e.escribe('crea a Camilo Rojas, su cel es 300 555 0199')
    const r = await e.toca('Crear')
    expect(r).toEqual([{ tipo: 'texto', texto: `Creé a ${REF}.` }])
    const t = e.pasos.at(-1)!.trazas.at(-1)!
    expect(t.tras_toque).toEqual({ origen: 'toque_propuesta', resultado: 'terminar' })
    expect(t.respuesta_fija).toBe('rf.hecho')
    expect(t.propuesta ?? null).toBeNull()
    expect(e.puerto.escrituras.map((x) => x.tipo)).toEqual(['cliente'])
    expect(modelo.restantes()).toBe(0)
  })

  it('el «sí» escrito también sigue', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Camilo Rojas', llave: '300 555 0199' } } },
      { name: 'terminar', args: {} },
    ])
    const e = await escenario({ modelo })
    await e.escribe('crea a Camilo Rojas, su cel es 300 555 0199')
    const r = await e.escribe('sí')
    expect(r).toEqual([{ tipo: 'texto', texto: `Creé a ${REF}.` }])
    expect(e.pasos.at(-1)!.trazas.at(-1)!.tras_toque).toEqual({ origen: 'si_escrito', resultado: 'terminar' })
  })

  it('si el modelo falla después del hecho, sale la confirmación sola (nunca «no pude», que diría que no se hizo)', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Camilo Rojas', llave: '300 555 0199' } } },
      { falla: 'http 503' },
    ])
    const e = await escenario({ modelo })
    await e.escribe('crea a Camilo Rojas, su cel es 300 555 0199')
    const r = await e.toca('Crear')
    expect(r).toEqual([{ tipo: 'texto', texto: `Creé a ${REF}.` }])
    const t = e.pasos.at(-1)!.trazas.at(-1)!
    expect(t.tras_toque?.resultado).toBe('solo_hecho')
    expect(t.error).toContain('http 503')
    expect(t.ejecucion?.resultado).toBe('ejecutada')
  })

  it('si el modelo pregunta lo que falta, la pregunta va debajo de la confirmación', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Camilo Rojas', llave: '300 555 0199' } } },
      { name: 'responder', args: { tema: 'solicitud', texto: '¿A dónde quiere viajar?' } },
    ])
    const e = await escenario({ modelo })
    await e.escribe('crea a Camilo Rojas, su cel es 300 555 0199, quiere un viaje')
    const r = await e.toca('Crear')
    expect(r).toEqual([{ tipo: 'texto', texto: `Creé a ${REF}.\n¿A dónde quiere viajar?` }])
    expect(e.pasos.at(-1)!.trazas.at(-1)!.tras_toque?.resultado).toBe('respuesta')
  })

  it('`terminar` no existe fuera del turno que sigue a un hecho', async () => {
    const modelo = modeloGuionado([
      { name: 'terminar', args: {} },
      { name: 'responder', args: { tema: 'saludo', texto: 'Hola, ¿en qué te ayudo?' } },
    ])
    const e = await escenario({ modelo })
    const r = await e.escribe('hola')
    expect(r[0].texto).toBe('Hola, ¿en qué te ayudo?')
    expect(modelo.pedidos[0].herramientas.map((h) => h.name)).not.toContain('terminar')
  })

  it('`desde` tiene que señalar un escrito del comercial: un mensaje del bot no sirve', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'crear_cliente', datos: { nombre: 'Camilo Rojas', llave: '300 555 0199' } } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: REF, desde: 2 } } },
      { name: 'terminar', args: {} },
    ])
    const e = await escenario({ modelo })
    await e.escribe('crea a Camilo Rojas, su cel es 300 555 0199')
    const r = await e.toca('Crear')
    expect(r).toEqual([{ tipo: 'texto', texto: `Creé a ${REF}.` }])
    expect(e.pasos.at(-1)!.trazas.at(-1)!.candados).toEqual([expect.objectContaining({ candado: 'desde_invalido' })])
  })

  it('el estado dice que quien escribe es del equipo, no un cliente', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'saludo', texto: 'Hola.' } }])
    const e = await escenario({ modelo })
    await e.escribe('hola')
    expect(estadoDe(modelo.pedidos[0])).toContain('el comercial es del equipo, no es un cliente: no lo busques ni lo propongas como cliente.')
  })
})
