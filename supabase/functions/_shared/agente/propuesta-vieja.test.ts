import { describe, expect, it } from 'vitest'
import { escenario } from './escenario'
import { propuestaVigente } from './nucleo'
import { modeloGuionado } from './modelo-guionado'

/**
 * Falla en vivo del 2026-10-09 (12:51–12:53, número de prueba; datos inventados aquí): «¿Abro este viaje?» quedó
 * pendiente después de que el bot dijo «Listo, retomamos M1 26 1». Dos minutos después, una respuesta fija la volvió a
 * pegar abajo y el comercial tuvo que escribir «No abras un viaje nuevo». En el arnés, un «sí» escrito para otra cosa la
 * ejecutó y abrió un viaje que nadie quería.
 * Ahora la propuesta queda atrás cuando la conversación consulta OTRA cosa concreta (`ver_viaje` de otro viaje): lo
 * decide la traza, no el texto.
 */

const MARTIN = { id: 'c-martin', nombre: 'MARTIN MORA', celular: '3001237311' }
const VIAJES = [1, 2].map((n) => ({ id: `v-${n}`, codigo: `M1 26 ${n}`, contactoId: 'c-martin', nombre: `VIAJE ${n}`, destino: null, abierto: true, datos: {} }))
const ref = 'Martin Mora (cel. …7311)'
const CAIDO = 'No pude revisarlo ahora. Si es una decisión, toca una opción; si no, escríbemelo de nuevo en un rato.'

describe('una propuesta pendiente queda atrás cuando la conversación pasa a otro viaje', () => {
  it('abrir un viaje nuevo queda atrás al retomar uno que existe: no vuelve en la respuesta fija, su botón no ejecuta y un «sí» no la abre', async () => {
    const modelo = modeloGuionado([
      // 12:51 «vamos a iniciar un viaje nuevo para…»
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'proponer', args: { accion: 'viaje_nuevo', datos: { cliente: ref } } },
      // 12:52 «primero dime qué viajes tiene abiertos» (buscar no es una cosa concreta: la propuesta sigue)
      { name: 'buscar', args: { texto: 'Martín Mora' } },
      { name: 'responder', args: { tema: 'viaje', texto: 'Tiene abiertos M1 26 1 y M1 26 2.' } },
      // 12:52 «retomemos el de miami»
      { name: 'ver_viaje', args: { codigo: 'M1 26 1' } },
      { name: 'responder', args: { tema: 'viaje', texto: 'Listo, retomamos M1 26 1.' } },
      // 12:53 el modelo falla: sale la respuesta fija
      { falla: 'corte' },
      // «sí»: con una pendiente vigente lo ejecutaría el código; sin ella, lo lee el modelo
      { name: 'responder', args: { tema: 'viaje', texto: '¿Sí a qué? Dime qué le anoto a M1 26 1.' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })

    await e.escribe('Vamos a iniciar un nuevo viaje para Martín Mora')
    const nuevo = propuestaVigente(e.almacen.filas)!
    expect(nuevo.accion).toBe('viaje_nuevo')

    await e.escribe('Primero dime qué viajes están abiertos de Martín')
    expect(propuestaVigente(e.almacen.filas)?.huella).toBe(nuevo.huella)

    await e.escribe('Vamos a retomar el viaje a M1 26 1')
    expect(propuestaVigente(e.almacen.filas)).toBeNull()

    // La respuesta fija sale sola, sin «¿Abro este viaje?» debajo.
    expect(await e.escribe('Ver qué le falta')).toEqual([{ tipo: 'texto', texto: CAIDO }])
    // El estado que ve el modelo ya no la trae como pendiente.
    const r = await e.escribe('sí')
    expect(r[0].texto).toBe('¿Sí a qué? Dime qué le anoto a M1 26 1.')
    expect(JSON.stringify(modelo.pedidos.at(-1)!.mensajes[0])).toContain('Propuesta pendiente: ninguna')
    // Su botón viejo no ejecuta.
    const t = await e.toca('Sí, ábrelo')
    expect(t[0].texto).toBe('Ese botón ya no está vigente: no hice nada.')
    expect(e.puerto.escrituras).toEqual([])
    expect(modelo.restantes()).toBe(0)
  })

  it('anotar en un viaje sigue pendiente si se consulta ESE viaje; queda atrás si se consulta otro', async () => {
    const modelo = modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'M1 26 1' } } },
      { name: 'ver_viaje', args: { codigo: 'M1 26 1' } },
      { name: 'responder', args: { tema: 'viaje', texto: 'A M1 26 1 le falta la fecha de regreso.' } },
      { name: 'ver_viaje', args: { codigo: 'M1 26 2' } },
      { name: 'responder', args: { tema: 'viaje', texto: 'M1 26 2 no tiene datos.' } },
    ])
    const e = await escenario({ modelo, contactos: [MARTIN], viajes: VIAJES })
    await e.escribe('en el M1 26 1 van 2 adultos')
    const p = propuestaVigente(e.almacen.filas)!
    expect(p.accion).toBe('anotar_en_viaje')
    expect(p.sobre).toBe('M1 26 1')

    await e.escribe('¿qué le falta al M1 26 1?')
    expect(propuestaVigente(e.almacen.filas)?.huella).toBe(p.huella)

    await e.escribe('¿y el M1 26 2?')
    expect(propuestaVigente(e.almacen.filas)).toBeNull()
  })
})
