import { describe, expect, it } from 'vitest'
import { escenario, reglamentoDePrueba } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a'
import { conPerfil } from './bandeja/reglamento-perfil'
import { instruccionesCarga, PARRAFO_PEDIDO } from './bandeja/extraccion'
import { mensajesDeCarga, mensajesDeTextos } from './bandeja/carga'
import type { ContactoMem, ExtractorMemoria, ViajeMem } from './memoria'
import type { CampoEntendible } from '../wa-entendimiento-reglas'

/**
 * «cárgalo en el G1 26 7, pero me dijo que salen el 10 de enero» con una tanda que dice el 8 (arnés con Haiku del
 * 2026-10-29, mano derecha, a-choque): `cargar_tanda` solo mandaba la tanda a la extracción, el modelo decía «dejo el 10»
 * y el resumen mostraba el 8. Lo que el comercial escribió al pedirla va aparte (`pedido`), después de la tanda, y
 * manda cuando choca. Datos inventados.
 */

const LAURA: ContactoMem = { id: 'c-laura', nombre: 'LAURA GOMEZ', celular: '3000005521' }
const viaje = (): ViajeMem => ({ id: 'v-ls', codigo: 'G1 26 7', contactoId: 'c-laura', nombre: 'SAN ANDRÉS', destino: 'San Andrés', abierto: true, datos: {} })
const CAMPOS: CampoEntendible[] = [
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
] as CampoEntendible[]

const TANDA = 'Hola, somos 2 adultos para San Andrés, salimos el 8 de enero de 2027'
const PIDE = 'cárgalo en el G1 26 7, pero me dijo que salen el 10 de enero'

/** Un extractor que hace lo que pide el prompt: si ve el pedido del comercial, su fecha manda; si no, la de la tanda. */
const extraer: ExtractorMemoria = async ({ textos, pedido, mensajes }) => {
  const todos = [...textos, ...(pedido ?? [])]
  const delPedido = (pedido ?? []).find((t) => /salen el 10/.test(t))
  // El pedido llega numerado después de la tanda, como en producción.
  if (delPedido) expect(mensajes).toContain(`[${textos.length + 1}] ${pedido![0]}`)
  return {
    mensajes: todos.map((_, i) => ({ n: i + 1, clase: 'cliente' })),
    citas: [],
    valores: {
      adultos: { valor: '2', frase: 'somos 2 adultos' },
      fecha_salida: delPedido ? { valor: '2027-01-10', frase: 'salen el 10 de enero' } : { valor: '2027-01-08', frase: 'salimos el 8 de enero de 2027' },
    },
  }
}

async function mundo() {
  return escenario({
    modelo: modeloGuionado([{ name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'G1 26 7' } } }]),
    contactos: [LAURA], viajes: [viaje()], reglamento: await reglamentoDePrueba(conPerfil(REGLAMENTO_ANEXO_A)), campos: CAMPOS, extraer,
  })
}

describe('cargar_tanda lleva a la extracción lo que el comercial escribió al pedirla', () => {
  it('«pero salen el 10» manda sobre el 8 de la tanda: el resumen y lo cargado dicen el 10', async () => {
    const e = await mundo()
    await e.reenvia(TANDA)
    const r = await e.escribe(PIDE)
    expect(r[0].tipo).toBe('botones')
    expect(r[0].texto).toContain('10 ene')
    expect(r[0].texto).not.toContain('8 ene')
    await e.toca('Cargar')
    expect(e.puerto.viajes[0].datos).toMatchObject({ fecha_salida: '2027-01-10', adultos: 2 })
  })

  it('el pedido va aparte: la extracción recibe la tanda sola en `textos` y la propuesta consume solo la tanda', async () => {
    const e = await mundo()
    await e.reenvia(TANDA)
    await e.escribe(PIDE)
    expect(e.puerto.extracciones).toEqual([[TANDA]])
    expect(e.puerto.pedidos).toEqual([[PIDE]])
    const p = e.trazas().find((t) => t.propuesta)!.propuesta!
    expect(p.datos.mensajes).toHaveLength(1)
    expect(JSON.stringify(p.datos.mensajes)).not.toContain('cárgalo')
  })

  it('un pedido sin datos («G1 26 7») deja lo de la tanda', async () => {
    const e = await escenario({
      modelo: modeloGuionado([{ name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'G1 26 7' } } }]),
      contactos: [LAURA], viajes: [viaje()], reglamento: await reglamentoDePrueba(conPerfil(REGLAMENTO_ANEXO_A)), campos: CAMPOS, extraer,
    })
    await e.reenvia(TANDA)
    await e.escribe('G1 26 7')
    await e.toca('Cargar')
    expect(e.puerto.viajes[0].datos).toMatchObject({ fecha_salida: '2027-01-08' })
  })
})

describe('el prompt de la carga con pedido', () => {
  it('sin pedido, las instrucciones y los mensajes son los de siempre', () => {
    const base = instruccionesCarga(CAMPOS, '2026-10-29', {}, {}, undefined, { perfil: true })
    expect(instruccionesCarga(CAMPOS, '2026-10-29', {}, {}, undefined, { perfil: true, pedido: false })).toBe(base)
    expect(base).not.toContain(PARRAFO_PEDIDO[1])
    expect(mensajesDeCarga([TANDA])).toEqual(mensajesDeTextos([TANDA]))
  })

  it('con pedido, el párrafo dice que lo escrito manda y el pedido va «escrito por el comercial»', () => {
    expect(instruccionesCarga(CAMPOS, '2026-10-29', {}, {}, undefined, { perfil: true, pedido: true })).toContain(PARRAFO_PEDIDO.join('\n'))
    const m = mensajesDeCarga([TANDA], [PIDE])
    expect(m.map((x) => [x.n, x.reenviado])).toEqual([[1, true], [2, false]])
  })
})
