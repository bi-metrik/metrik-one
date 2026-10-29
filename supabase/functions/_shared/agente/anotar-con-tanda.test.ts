import { describe, expect, it } from 'vitest'
import { escenario, reglamentoDePrueba } from './escenario'
import { modeloGuionado } from './modelo-guionado'
import { REGLAMENTO_ANEXO_A } from './bandeja/reglamento-anexo-a'
import { conPerfil } from './bandeja/reglamento-perfil'
import type { ContactoMem, ExtractorMemoria, ViajeMem } from './memoria'
import type { CampoEntendible } from '../wa-entendimiento-reglas'

/**
 * «cárgalo en el G1 26 7» con una tanda sin cargar (arnés con Haiku del 2026-10-29, mano derecha: a-pdf-tanda y
 * a-factura). El modelo propuso `anotar_en_viaje`; en lo que ESCRIBIÓ el comercial no hay datos del viaje, y el candado
 * decía «lo que dijo ya está en el viaje» (el modelo contestó que lo del PDF «quedó registrado») o pasaba la duda de la
 * extracción («¿qué significa G1 26 7?»). Con reenvíos sin cargar, el candado dice el estado: hay una tanda, nada quedó
 * escrito, y la carga es `cargar_tanda`. Datos inventados.
 */

const LAURA: ContactoMem = { id: 'c-laura', nombre: 'LAURA GOMEZ', celular: '3000005521' }
const VIAJE: ViajeMem = { id: 'v-ls', codigo: 'G1 26 7', contactoId: 'c-laura', nombre: 'SAN ANDRÉS', destino: 'San Andrés', abierto: true, datos: {} }
const CAMPOS: CampoEntendible[] = [
  { slug: 'fecha_salida', tipo: 'fecha', label: 'Fecha de salida', nivel: 'minimo', pregunta: '¿Qué día salen?' },
  { slug: 'adultos', tipo: 'numero', label: 'Adultos', nivel: 'minimo', pregunta: '¿Cuántos adultos?' },
] as CampoEntendible[]

/** Lo escrito por el comercial («cárgalo en…») no trae nada; la tanda trae los adultos. */
const extraer = (duda: string | null): ExtractorMemoria => async ({ textos, campos }) => {
  const deTanda = textos.some((t) => /2 adultos/.test(t))
  return {
    mensajes: textos.map((_, i) => ({ n: i + 1, clase: 'cliente' })),
    citas: [],
    valores: {
      ...Object.fromEntries(campos.map((f) => [f.slug, { valor: 'por_definir', frase: '' }])),
      ...(deTanda ? { adultos: { valor: '2', frase: 'somos 2 adultos' } } : {}),
    },
    ...(duda && !deTanda ? { dudas: [{ campo: 'fecha_salida', pregunta: duda }] } : {}),
  }
}

async function mundo(duda: string | null) {
  return escenario({
    modelo: modeloGuionado([
      { name: 'proponer', args: { accion: 'anotar_en_viaje', datos: { viaje: 'G1 26 7' } } },
      { name: 'proponer', args: { accion: 'cargar_tanda', datos: { viaje: 'G1 26 7' } } },
    ]),
    contactos: [LAURA], viajes: [VIAJE], reglamento: await reglamentoDePrueba(conPerfil(REGLAMENTO_ANEXO_A)), campos: CAMPOS, extraer: extraer(duda),
  })
}

describe('anotar sin datos con una tanda pendiente: el candado lleva a cargar la tanda', () => {
  for (const duda of [null, '¿Qué significa «G1 26 7»?']) {
    it(duda ? 'con una duda de la extracción, no la pasa: dice la tanda' : 'sin datos nuevos, no dice «ya está en el viaje»: dice la tanda', async () => {
      const e = await mundo(duda)
      await e.reenvia('Hola, somos 2 adultos para San Andrés del 3 al 7 de febrero')
      const r = await e.escribe('cárgalo en el G1 26 7')
      const candado = e.trazas().flatMap((t) => t.candados ?? [])[0]
      expect(candado.candado).toBe(duda ? 'solo_duda' : 'sin_datos_nuevos')
      expect(candado.detalle).toContain('cargar_tanda')
      expect(candado.detalle).toContain('nada quedó escrito')
      expect(candado.detalle).not.toContain('ya está en el viaje')
      if (duda) expect(candado.detalle).not.toContain(duda)
      // Con la tanda, la propuesta sale y el toque carga los adultos.
      expect(r[0].tipo).toBe('botones')
      await e.toca('Cargar')
      expect(e.puerto.viajes[0].datos).toMatchObject({ adultos: 2 })
    })
  }

  it('sin tanda, el candado de siempre', async () => {
    const e = await mundo(null)
    await e.escribe('cárgalo en el G1 26 7')
    const candado = e.trazas().flatMap((t) => t.candados ?? [])[0]
    expect(candado.candado).toBe('sin_datos_nuevos')
    expect(candado.detalle).toContain('ya está en el viaje')
  })
})
