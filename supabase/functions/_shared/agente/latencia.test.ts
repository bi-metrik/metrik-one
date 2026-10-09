import { describe, expect, it } from 'vitest'
import { escenario } from './escenario'
import { dominioBandeja } from './bandeja/dominio'
import { PuertoMemoria } from './memoria'
import { modeloGuionado } from './modelo-guionado'
import type { ContextoDominio } from './tipos'

/**
 * Latencia del turno sin cambiar lo que el bot decide (medido en vivo en Trappvel, 2026-10-07/08: p50 7,4 s). Datos
 * inventados.
 */

describe('«escribiendo…» no frena el turno', () => {
  it('el modelo arranca sin esperar a Meta, y la respuesta sale después de que el «escribiendo…» llegó', async () => {
    const eventos: string[] = []
    let soltar: () => void = () => {}
    const modelo = modeloGuionado([() => {
      eventos.push('modelo')
      soltar() // Meta contesta el «escribiendo…» mientras el modelo piensa.
      return { name: 'responder', args: { tema: 'solicitud', texto: '¿A dónde quieren ir?' } }
    }])
    const e = await escenario({ modelo })
    const enviar = e.mensajero.enviar.bind(e.mensajero)
    e.mensajero.escribiendo = async (wamid: string) => {
      eventos.push('escribiendo: pedido')
      await new Promise<void>((r) => { soltar = r })
      eventos.push('escribiendo: listo')
      e.mensajero.escribiendos.push(wamid)
    }
    e.mensajero.enviar = async (...a) => { eventos.push('enviar'); return enviar(...a) }

    await e.escribe('Hola, un viaje para la familia Rojas')
    expect(eventos).toEqual(['escribiendo: pedido', 'modelo', 'escribiendo: listo', 'enviar'])
  })

  it('un «escribiendo…» que falla no tumba el turno', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'solicitud', texto: '¿A dónde quieren ir?' } }])
    const e = await escenario({ modelo })
    e.mensajero.escribiendo = async () => { throw new Error('Meta caída') }
    const s = await e.escribe('Hola, un viaje para la familia Rojas')
    expect(s).toEqual([{ tipo: 'texto', texto: '¿A dónde quieren ir?' }])
  })
})

describe('proponer lee la línea solo cuando la nombra', () => {
  const ctx: ContextoDominio = { workspaceId: 'ws', phone: '57300', remitente: { nombre: 'Ana', rol: 'colaborador' }, conversacion: [], resultadosPrevios: [] }

  it('anotar_en_viaje y cargar_tanda no la leen (eran cuatro consultas en serie delante de la extracción)', async () => {
    const puerto = new PuertoMemoria()
    let lecturas = 0
    puerto.linea = async () => { lecturas++; return 'Viaje a medida' }
    const d = dominioBandeja(puerto)
    await d.proponer('anotar_en_viaje', { viaje: 'R1 26 1', texto: 'van 2 adultos' }, ctx)
    await d.proponer('cargar_tanda', { viaje: 'R1 26 1' }, ctx)
    await d.proponer('descartar', {}, ctx)
    expect(lecturas).toBe(0)
  })

  it('viaje_nuevo sí, y el resumen la sigue nombrando', async () => {
    const modelo = modeloGuionado([
      { name: 'buscar', args: { texto: 'Rojas' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: 'Lina Rojas (cel. …4455)', destino: '' } } },
    ])
    const e = await escenario({ modelo, contactos: [{ id: 'c-lina', nombre: 'LINA ROJAS', celular: '3001114455' }] })
    const s = await e.escribe('Abre un viaje para Lina Rojas')
    expect(s[0].texto).toBe('¿Abro este viaje?\nLina Rojas (cel. …4455) · Viaje a medida')
  })
})

describe('las fichas de índice van completas: sin llamado aparte para traerlas', () => {
  it('el modelo no tiene consultar_reglas y el sistema trae el detalle de cada ficha de índice', async () => {
    const modelo = modeloGuionado([{ name: 'responder', args: { tema: 'solicitud', texto: '¿De cuál cliente?' } }])
    const e = await escenario({ modelo })
    await e.escribe('Te paso los mensajes de dos clientes')
    const pedido = modelo.pedidos[0]
    expect(pedido.herramientas.map((h) => h.name)).not.toContain('consultar_reglas')
    expect(pedido.permitidas).not.toContain('consultar_reglas')
    const indice = e.deps.reglamento.fichas.filter((f) => f.carga === 'indice')
    expect(indice.length).toBeGreaterThan(0)
    for (const f of indice) expect(pedido.sistema).toContain(f.hacer)
    expect(pedido.sistema).not.toContain('consultar_reglas')
  })
})
