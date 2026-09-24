import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import fixture from './__fixtures__/cot-2026-0013-hoteles.fixture.json'
import { aceptarPorRuta, detectarPorRuta, leerPorRuta } from './bandeja-red'
import { agregarHabitacion, habitacionesDeTarifa } from './habitaciones'
import { leerTarifaPax, type LecturaCasilla, type TarifaPax } from './tarifa-pasajero'
import { ubicarLectura, type LineaParaUbicar } from './ubicar-lectura'
import type { BorradorParaAceptar } from '@/app/(app)/negocios/tarifa-pax-actions'

const GRUPO = fixture.grupo
const COT = 'dd34f7f5-a07e-4666-82bf-1ed0eb4469d3'
const SEIS = ['2164b941', 'efb0a3c3', '68d431db', 'f9fbc4d5', '7944d5cc', '5542356a']
const lectura = (id: string) => fixture.hoteles.find(h => h.item === id)!.lectura as unknown as LecturaCasilla

/**
 * El servidor en memoria: la lectura tarda lo que tarde Gemini (queda pendiente hasta que la
 * prueba la suelte) y «Aceptar» ubica y escribe con la misma regla que el de verdad.
 */
function servidor() {
  let lineas: (LineaParaUbicar & { tarifa_pax: TarifaPax })[] = []
  let ranuras = 0
  const lecturasPendientes: (() => void)[] = []
  const rutas: string[] = []
  const f = (async (url: string, init?: RequestInit) => {
    rutas.push(url)
    const cuerpo = JSON.parse(String(init?.body ?? '{}'))
    const responder = (x: unknown) => ({ json: async () => x }) as Response
    if (url.endsWith('/leer-captura') || url.endsWith('/detectar-captura')) {
      await new Promise<void>(r => lecturasPendientes.push(r))
      return responder({ ok: false, codigo: 'X', mensaje: 'no importa' })
    }
    const b = cuerpo as BorradorParaAceptar
    const l = JSON.parse(b.lecturaJson) as LecturaCasilla
    const id = (l as unknown as { _id: string })._id
    const d = ubicarLectura({ tipo: 'hotel', lectura: l, pistas: { lugar: null, origen: null, destino: null }, lineas, grupoViaje: GRUPO })
    if (d.como === 'habitacion') {
      if (d.sobra) return responder({ ok: false, codigo: 'SOBRA', mensaje: 'cubierto', conItemId: d.itemId })
      lineas = lineas.map(x => (x.id === d.itemId ? { ...x, tarifa_pax: agregarHabitacion(x.tarifa_pax, { id, lectura: l }, GRUPO) } : x))
      return responder({ ok: true, itemId: d.itemId, donde: 'habitación', pendiente: null, como: 'habitacion', bloque: 'hotel', opcion: null })
    }
    const grupo = d.como === 'hermana' ? d.grupo : (++ranuras === 1 ? 'hotel' : `hotel ${ranuras}`)
    lineas = [...lineas, { id, grupo, tarifa_pax: { casillas: { grupo_completo: l } } }]
    return responder({ ok: true, itemId: id, donde: grupo, pendiente: null, como: d.como, bloque: grupo, opcion: null })
  }) as unknown as typeof fetch
  return { f, rutas, estado: () => ({ lineas, ranuras }), soltarLecturas: () => lecturasPendientes.splice(0).forEach(r => r()) }
}

const borrador = (id: string): BorradorParaAceptar => ({
  tipo: 'hotel',
  lecturaJson: JSON.stringify({ ...lectura(id), _id: id }),
  firma: 'firma',
  pistas: { lugar: null, origen: null, destino: null },
  decision: 'auto',
  destinoId: null,
  imagen: null,
  correcciones: null,
} as unknown as BorradorParaAceptar)

describe('la bandeja habla por rutas, no por server actions', () => {
  it('cada acción va a su ruta de la cotización', async () => {
    const s = servidor()
    void detectarPorRuta(COT, 'data:x', s.f)
    void leerPorRuta(COT, 'hotel', 'data:x', null, s.f)
    await aceptarPorRuta(COT, borrador(SEIS[0]), s.f)
    expect(s.rutas).toEqual([
      `/api/cotizaciones/${COT}/detectar-captura`,
      `/api/cotizaciones/${COT}/leer-captura`,
      `/api/cotizaciones/${COT}/aceptar-captura`,
    ])
    s.soltarLecturas()
  })

  it('aceptar 6 seguidas mientras siguen leyendo: 1 bloque, 2 opciones, 3 habitaciones cada una, sin esperar a las lecturas', async () => {
    const s = servidor()
    // Seis pantallazos pegados, todos leyendo todavía (Gemini tarda 8-25 s).
    const leyendo = SEIS.map(() => leerPorRuta(COT, 'hotel', 'data:x', null, s.f))
    for (const id of SEIS) {
      const r = await aceptarPorRuta(COT, borrador(id), s.f)
      expect(r?.ok).toBe(true)
    }
    // Todo quedó escrito antes de que terminara una sola lectura.
    const { lineas, ranuras } = s.estado()
    expect(ranuras).toBe(1)
    expect(lineas).toHaveLength(2)
    expect(new Set(lineas.map(l => l.grupo)).size).toBe(1)
    expect(lineas.map(l => habitacionesDeTarifa(leerTarifaPax(l.tarifa_pax)).length)).toEqual([3, 3])
    s.soltarLecturas()
    await Promise.all(leyendo)
  })

  it('sin respuesta del servidor, «Aceptar» devuelve null (la bandeja lo muestra como error)', async () => {
    const roto = (async () => { throw new Error('red') }) as unknown as typeof fetch
    expect(await aceptarPorRuta(COT, borrador(SEIS[0]), roto)).toBeNull()
  })

  it('la bandeja no importa las lecturas como server action: esas bloquean el refresco de Componentes', () => {
    const fuente = readFileSync(join(process.cwd(), 'src/app/(app)/negocios/bandeja-capturas.tsx'), 'utf8')
    expect(fuente).not.toMatch(/\bdetectarCaptura\b/)
    expect(fuente).not.toMatch(/\bleerCapturaEnBorrador\b/)
    expect(fuente).not.toMatch(/fetch\(`\/api\/cotizaciones/)
    expect(fuente).toMatch(/detectarPorRuta\(cotizacionId/)
    expect(fuente).toMatch(/leerPorRuta\(cotizacionId/)
    expect(fuente).toMatch(/aceptarPorRuta\(cotizacionId/)
  })
})
