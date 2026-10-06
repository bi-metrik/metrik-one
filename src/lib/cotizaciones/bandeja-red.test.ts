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

  it('sin respuesta del servidor, «Aceptar» reintenta y devuelve ok:false con su código y qué hacer (caso Alejandra)', async () => {
    let llamadas = 0
    const roto = (async () => { llamadas++; throw new TypeError('Failed to fetch') }) as unknown as typeof fetch
    const r = await aceptarPorRuta(COT, borrador(SEIS[0]), roto, { dormir: async () => {}, reportar: () => {} })
    expect(llamadas).toBe(3)
    expect(r).toEqual({ ok: false, codigo: 'RED', mensaje: expect.stringMatching(/^No llegó a ONE: la conexión se cortó/) })
  })

  it('qué se reintenta: sin respuesta o sin JSON sí; un ok:false del servidor no; un 413 no', async () => {
    const sinEspera = { dormir: async () => {}, reportar: () => {} }
    const secuencia = (respuestas: (Response | 'red')[]) => {
      const llamadas: string[] = []
      const f = (async (url: string) => {
        llamadas.push(url)
        const r = respuestas.shift()
        if (!r || r === 'red') throw new TypeError('Failed to fetch')
        return r
      }) as unknown as typeof fetch
      return { f, llamadas }
    }
    const json = (x: unknown, status = 200) => new Response(JSON.stringify(x), { status, headers: { 'content-type': 'application/json' } })
    const html = (status: number) => new Response('<html>An error occurred</html>', { status })

    // La página de error del borde (504) y luego la respuesta: entra al segundo intento.
    const a = secuencia([html(504), json({ ok: true, lectura: {}, lecturaJson: '{}', firma: 'f', alertas: [] })])
    expect(await leerPorRuta(COT, 'hotel', 'data:x', null, a.f, sinEspera)).toMatchObject({ ok: true })
    expect(a.llamadas).toHaveLength(2)

    // Un ok:false es la decisión del servidor: no se repite.
    const b = secuencia([json({ ok: false, codigo: 'RX6', mensaje: 'No se pudo leer' })])
    expect(await leerPorRuta(COT, 'hotel', 'data:x', null, b.f, sinEspera)).toMatchObject({ ok: false, codigo: 'RX6' })
    expect(b.llamadas).toHaveLength(1)

    // 413: el borde no la deja entrar por tamaño. Reintentar no cambia nada: se dice por qué.
    const c = secuencia([html(413)])
    await expect(leerPorRuta(COT, 'hotel', 'data:x', null, c.f, sinEspera)).rejects.toMatchObject({ name: 'ErrorDeEnvio', codigo: 'PESADA' })
    expect(c.llamadas).toHaveLength(1)

    // Sin red las tres veces: lanza con su código, y la detección también.
    const d = secuencia(['red', 'red', 'red'])
    await expect(detectarPorRuta(COT, 'data:x', d.f, sinEspera)).rejects.toMatchObject({ codigo: 'RED', intentos: 3 })
    expect(d.llamadas).toHaveLength(3)
  })

  it('un cuerpo de más de 4,4 MB no sale: el borde lo devolvería 413 sin decir nada', async () => {
    const reportes: unknown[] = []
    let llamadas = 0
    const f = (async () => { llamadas++; return new Response('{}') }) as unknown as typeof fetch
    const enorme = `data:image/png;base64,${'A'.repeat(4_500_000)}`
    await expect(leerPorRuta(COT, 'hotel', enorme, null, f, { dormir: async () => {}, reportar: r => void reportes.push(r) }))
      .rejects.toMatchObject({ codigo: 'PESADA' })
    expect(llamadas).toBe(0)
    expect(reportes).toEqual([expect.objectContaining({ ruta: 'leer-captura', codigo: 'PESADA', cotizacionId: COT, bytesImagen: 3_375_000 })])
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
