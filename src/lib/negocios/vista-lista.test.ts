/**
 * La lista de `/negocios` resuelta en el servidor (`vista-lista.ts`): lo que viaja pesa
 * poco, las páginas cubren la lista sin huecos ni repetidos, y la tarjeta compacta se
 * reconstruye idéntica.
 *
 * El fixture es SINTÉTICO con la forma y los largos de SOENA (medido el 2026-10-03: 466
 * abiertos + 39 cerrados, 773 KB en el payload). No se usan datos de producción en el repo.
 */
import { describe, expect, it } from 'vitest'
import type { NegocioResumen } from '@/app/(app)/negocios/negocio-v2-actions'
import { LINEA_SOENA } from '../../../test/linea-soena'
import {
  armarVistaLista,
  compactarTarjeta,
  expandirTarjeta,
  TAMANO_PAGINA,
  type NegocioTarjeta,
  type Universo,
} from './vista-lista'

const uuid = (i: number) => `${String(i).padStart(8, '0')}-4a1b-4c2d-8e3f-${String(i).padStart(12, '0')}`
const STAFF = Array.from({ length: 12 }, (_, i) => ({ id: uuid(9000 + i), full_name: `Persona Apellido ${i}` }))

function negocio(i: number, estado = 'abierto'): NegocioResumen {
  const etapa = LINEA_SOENA[i % LINEA_SOENA.length]
  const dia = String(1 + (i % 28)).padStart(2, '0')
  return {
    id: uuid(i),
    nombre: `Cliente número ${i} con nombre largo`,
    codigo: `V${String(i).padStart(4, '0')}`,
    precio_estimado: 1_250_000 + i,
    precio_aprobado: i % 3 === 0 ? 1_190_000 : null,
    carpeta_url: `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz${i}`,
    stage_actual: etapa.stage as 'venta' | 'ejecucion' | 'cobro',
    estado,
    created_at: `2026-09-${dia}T15:04:05.123456+00:00`,
    linea_nombre: 'GIT EV/HEV',
    linea_numero: 1,
    etapa_nombre: etapa.nombre,
    etapa_numero: etapa.numero,
    etapa_stage: etapa.stage,
    empresa_nombre: i % 4 === 0 ? `Empresa ${i} S.A.S.` : null,
    contacto_nombre: `Contacto ${i} Pérez`,
    contacto_telefono: `+57 300 ${String(1000000 + i)}`,
    costos_ejecutados: 0,
    pausado: false,
    pausado_hasta: null,
    motivo_pausa: null,
    closed_at: estado === 'abierto' ? null : `2026-09-${dia}T18:00:00+00:00`,
    razon_cierre: null,
    vehiculo_label: 'BYD Song Plus DM-i 2025',
    seccional_label: i % 2 ? 'Bogotá' : 'Medellín',
    ciudad_label: 'Bogotá D.C.',
    cedula: String(1_000_000_000 + i),
    radicado: i % 2 ? `UPME-2026-${i}` : null,
    numero_factura: i % 5 ? null : `FV-2-${i}`,
    fecha_cita: i % 3 ? null : `2026-10-${dia}T09:30`,
    cita_pendiente: i % 7 === 0,
    atencion_cita: null,
    servicio: i % 2 ? 'completo' : 'solo_upme',
    servicio_label: i % 2 ? 'Completo' : 'Solo UPME',
    responsables: [STAFF[i % 12], STAFF[(i + 5) % 12]],
    extras: [{ indice: 0, label: 'Titular', valor: `Titular ${i}`, detalle: [] }],
    es_meta_lead: i % 2 === 0,
    almacenamiento_externo: false,
    reproceso: null,
    desenlaces: [],
    origen: i % 2 ? 'meta' : null,
    aliado_nombre: null,
    marcas: [],
    etapa_cambiada_at: `2026-09-${dia}T14:00:00.654321+00:00`,
    etapa_sla_horas: 24,
    horas_habiles_en_etapa: 31.123456789 + i,
    sla_exceso_horas: 7.123456789 + i,
  }
}

const ABIERTOS = Array.from({ length: 466 }, (_, i) => negocio(i))
const CERRADOS = Array.from({ length: 39 }, (_, i) =>
  negocio(1000 + i, ['completado', 'perdido', 'cancelado'][i % 3]),
)
const U: Universo = { abiertos: ABIERTOS, cerrados: CERRADOS, etapas: LINEA_SOENA, defaultStage: 'todos', hoyISO: '2026-10-03' }

const bytes = (x: unknown) => Buffer.byteLength(JSON.stringify(x))

describe('vista-lista · peso de la primera carga', () => {
  it('con 505 negocios viaja menos de 60 KB; antes viajaba la lista entera', () => {
    const antes = bytes({ negocios: ABIERTOS, cerrados: CERRADOS })
    const { vista } = armarVistaLista(U, {})
    const despues = bytes(vista)
    expect(vista.tarjetas).toHaveLength(TAMANO_PAGINA)
    expect(despues).toBeLessThan(60_000)
    // Con la forma de antes este fixture pesa ~1,4 KB por negocio.
    expect(antes).toBeGreaterThan(despues * 10)
  })

  it('los contadores ven el universo completo aunque viajen 30 tarjetas', () => {
    const { vista } = armarVistaLista(U, {})
    expect(vista.resumen.totalAbiertos).toBe(466)
    expect(vista.resumen.totalCerrados).toBe(39)
    expect(vista.resumen.conteoFases.todos).toBe(505)
    expect(vista.resumen.conteoFases.cerrados).toBe(39)
    expect(vista.resumen.totalVista).toBe(505)
    expect(vista.resumen.conteoMotivos).toEqual({ todos: 39, exitoso: 13, perdido: 13, cancelado: 13 })
  })

  it('la búsqueda mira todo el universo, incluidos los cerrados que no viajaron', () => {
    const { vista } = armarVistaLista(U, { fase: 'venta', q: 'v1038' })
    // V1038 es un cerrado: en «Comercial» no aparece, pero el aviso lo cuenta.
    expect(vista.resumen.totalVista).toBe(0)
    expect(vista.resumen.coincidenciasFuera).toBe(1)
    // Y por teléfono, que no viaja en la tarjeta.
    expect(armarVistaLista(U, { q: '3001000007' }).vista.resumen.totalVista).toBe(1)
  })
})

describe('vista-lista · páginas', () => {
  it('las páginas cubren la lista en orden, sin huecos ni repetidos', () => {
    const { ordenados } = armarVistaLista(U, {})
    const vistos: string[] = []
    for (let desde = 0; desde < ordenados.length; desde += TAMANO_PAGINA) {
      vistos.push(...armarVistaLista(U, {}, { desde }).vista.tarjetas.map((t) => t.id))
    }
    expect(vistos).toEqual(ordenados.map((n) => n.id))
    expect(new Set(vistos).size).toBe(505)
  })

  it('los grupos por día cuentan el grupo entero y se encadenan sin huecos', () => {
    const { vista } = armarVistaLista(U, { fase: 'ejecucion' })
    const grupos = vista.resumen.grupos!
    expect(grupos.length).toBeGreaterThan(1)
    let desde = 0
    for (const g of grupos) {
      expect(g.desde).toBe(desde)
      desde += g.total
    }
    expect(desde).toBe(vista.resumen.totalVista)
  })

  it('con orden por atraso no hay grupos', () => {
    expect(armarVistaLista(U, { orden: 'atraso' }).vista.resumen.grupos).toBeNull()
  })

  it('un rango absurdo se acota', () => {
    expect(armarVistaLista(U, {}, { desde: -5, cuantos: 99999 }).vista.tarjetas).toHaveLength(200)
    expect(armarVistaLista(U, {}, { desde: Number.NaN }).vista.desde).toBe(0)
  })
})

describe('vista-lista · tarjeta compacta', () => {
  it('se reconstruye idéntica a la tarjeta (solo cambian las horas, a dos decimales)', () => {
    for (const n of [ABIERTOS[0], ABIERTOS[7], CERRADOS[1]]) {
      const vuelta = expandirTarjeta(JSON.parse(JSON.stringify(compactarTarjeta(n))), false)
      const { contacto_telefono: _t, created_at: _c, pausado_hasta: _p, motivo_pausa: _m, ciudad_label: _ci,
        numero_factura: _f, servicio: _s, etapa_stage: _e, ...tarjeta } = n
      const esperada: NegocioTarjeta = {
        ...tarjeta,
        horas_habiles_en_etapa: Math.round(n.horas_habiles_en_etapa! * 100) / 100,
        sla_exceso_horas: Math.round(n.sla_exceso_horas! * 100) / 100,
      }
      expect(vuelta).toEqual(esperada)
    }
  })

  it('lo que vale el defecto no viaja, y vuelve con el valor exacto (null, no undefined)', () => {
    const c = compactarTarjeta({ ...ABIERTOS[1], radicado: null, marcas: [], pausado: false })
    expect('radicado' in c).toBe(false)
    expect('marcas' in c).toBe(false)
    const e = expandirTarjeta(c, true)
    expect(e.radicado).toBeNull()
    expect(e.marcas).toEqual([])
    expect(e.pausado).toBe(false)
    expect(e.almacenamiento_externo).toBe(true)
  })
})
