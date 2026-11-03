import { describe, expect, it } from 'vitest'
import * as vista from './por-pasos-vista'
import { estadoDeLosPasos, loQueSuma, sigue, viajeEnOrden, type EntradaDePasos, type RenglonQueSuma, type TarifaCalculada } from './por-pasos-vista'

// Reprueba del bloqueo de Trappvel (2026-10-30, P5): con un tercer paquete vacío que va al cliente
// en la Opción 3, «Armar el viaje» quedaba ✓ y «Sigue» saltaba a Tarifas. Tarifas y Revisar sí
// frenaban. Datos FICTICIOS con la forma del viaje a San Andrés.
const GRUPO = 'paquete de bloqueo: Paquete de bloqueo en Ciudad Inventada'
const lineas = [
  { id: 'pa', grupo: GRUPO, nombre: 'Hotel Uno', orden: 1 },
  { id: 'pb', grupo: GRUPO, nombre: 'Hotel Dos', orden: 2 },
  { id: 'pc', grupo: GRUPO, nombre: 'Paquete sin hotel', orden: 3 },
]
const precios = new Map([
  ['pa', { precio: 10_666_588, costo: 9_066_600 }],
  ['pb', { precio: 9_280_000, costo: 7_888_000 }],
  ['pc', { precio: 0, costo: 0 }],
])
const nombres: Record<string, string> = { pa: 'Hotel Uno', pb: 'Hotel Dos', pc: 'Paquete sin hotel' }

const tarifa = (nombre: string, opcion: string, extra: Partial<TarifaCalculada> = {}) =>
  ({ nombre, esPrincipal: false, vaEnPropuesta: true, igualA: null, opcionPorServicio: { _: opcion }, ...extra }) as unknown as TarifaCalculada

/** El mismo criterio que la pantalla: `loQueSuma` → lo que no está costeado (en `main` no existía). */
function sinCostoDe(renglones: RenglonQueSuma[]): { servicio: string; motivo: string }[] {
  const f = (vista as Record<string, unknown>).sinCostoDelViaje as
    | ((r: RenglonQueSuma[], faltaPrecio: (id: string) => string | null, nombre: (id: string) => string) => { servicio: string; motivo: string }[])
    | undefined
  // Sin el helper, el criterio de main (el que estaba en la pantalla): solo la Recomendada.
  if (!f) return renglones.filter(r => !r.noSuma && r.sinCosto).map(r => ({ servicio: r.nombre, motivo: 'Falta el costo' }))
  return f(renglones, () => null, id => nombres[id])
}

function entrada(tarifas: TarifaCalculada[]): EntradaDePasos {
  const tramos = viajeEnOrden(lineas as never, { destino: 'Ciudad Inventada', fechaInicio: '2027-06-18' })
  // El grupo normalizado es la llave de `opcionPorServicio`: se toma del propio servicio.
  const grupo = tramos[0].servicios[0].grupo
  for (const t of tarifas) t.opcionPorServicio = { [grupo]: t.opcionPorServicio._ }
  return {
    servicios: 1, conOpciones: 1, pantallazosPorAceptar: 0, leyendo: 0,
    sinCosto: sinCostoDe(loQueSuma(tramos, tarifas, precios)),
    bajoMinimo: [], tarifasVistas: false, vanAlCliente: tarifas.map(t => t.nombre!), rojos: 0, ambar: 0, texto: 'nada', enviada: false,
  }
}

describe('bloqueo · una opción en $0 no cuenta como costeada (P5)', () => {
  it('el paquete vacío en la Opción 3 deja el paso 1 en rojo y «Sigue» lo pide, no Tarifas', () => {
    const e = entrada([
      tarifa('Recomendada', 'pa', { esPrincipal: true }),
      tarifa('Opción 2', 'pb'),
      tarifa('Opción 3', 'pc'),
    ])
    expect(e.sinCosto).toEqual([{ servicio: 'Paquete sin hotel', motivo: 'Falta el costo del paquete' }])
    expect(estadoDeLosPasos(e)[1]).toEqual({ tono: 'error', texto: 'Falta el costo del paquete · Paquete sin hotel' })
    const s = sigue({ ...e, pasoActual: 1 })
    expect(s.texto).toBe('Falta el costo del paquete: Paquete sin hotel.')
    expect(s.accion).toEqual({ tipo: 'paso', paso: 1 })
  })

  it('sin tarifas todavía, todo paquete se ofrece: el vacío también frena', () => {
    expect(entrada([]).sinCosto.map(x => x.servicio)).toEqual(['Paquete sin hotel'])
  })

  it('el paquete en $0 que no va al cliente no frena (la Opción 3 sin marcar)', () => {
    const e = entrada([
      tarifa('Recomendada', 'pa', { esPrincipal: true }),
      tarifa('Opción 2', 'pb'),
      tarifa('Opción 3', 'pc', { vaEnPropuesta: false }),
    ])
    expect(e.sinCosto).toEqual([])
    expect(estadoDeLosPasos(e)[1].tono).toBe('hecho')
  })

  it('con los paquetes costeados todo sigue igual: ✓ y «Escoge qué opción va»', () => {
    const e = entrada([tarifa('Recomendada', 'pa', { esPrincipal: true }), tarifa('Opción 2', 'pb')])
    expect(e.sinCosto).toEqual([])
    expect(estadoDeLosPasos(e)[1]).toEqual({ tono: 'hecho', texto: '1 servicio · 1 con opciones' })
    expect(sigue({ ...e, pasoActual: 1 }).boton).toBe('Ir a Tarifas')
  })
})
