/**
 * Servicios del viaje (F0), probados LLAMANDO A LAS ACCIONES reales: aceptar la cotización,
 * «Traer los servicios», corregir la aceptación y editar una fila.
 *
 * El doble de la base ESCRIBE (mismo patrón que `recomendada-tarifa-elegida-e2e.test.ts`) y,
 * además, reproduce lo que hace la idempotencia de verdad: el índice único
 * `(negocio_id, item_id)` de `negocio_servicios` rechaza con 23505 el lote entero que lo viole,
 * como Postgres. Sin eso, «generar dos veces no duplica» pasaría con cualquier código.
 *
 * Criterios de Vera: F0-1 (N ítems, N filas), F0-2 (cuadre), F0-3 (dos veces, a la vez y con
 * el botón), F0-4 (falla sin deshacer), F0-5 (corregir), F0-7 (apagado = cero filas, mismo
 * precio), §7.4 (el servidor rechaza a quien no puede).
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez (12 pruebas):
 *  · sin la llamada a `generarServiciosDesdeTarifa` en `aceptarCotizacionNegocio` → caen 6;
 *  · sin el interruptor (`serviciosActivosDelNegocio` siempre encendido) → caen 2 (apagado);
 *  · tratando el 23505 de la ruta fila por fila como error → cae «a la vez» (1);
 *  · ignorando el rechazo de `soltarServiciosDeAceptacion` al corregir → cae 1;
 *  · sin `.eq('origen', 'cotizacion')` al soltar → cae «deja las agregadas a mano» (1);
 *  · sin el permiso de `traerServiciosDeCotizacion` → cae 1; sin el de `actualizarServicio` → cae 1.
 *  · Sin leer las filas que ya existen NO cae ninguna: el índice único y la ruta fila por fila
 *    dan el mismo resultado. La lectura previa queda para que el caso normal (volver a tocar el
 *    botón) no pase por el choque; no cambia nada observable.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0
let fallarInsertServicios = false

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const LINEA = 'linea-viaje'
const NEG = '7c1d2e3f-4a5b-4c6d-8e8f-90a1b2c3d4e5'
const COT = 'cot-1'

let rol = 'operator'
let areas: string[] = []

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteFalso(),
    workspaceId: WS,
    userId: 'p-ale',
    staffId: 's-ale',
    role: rol,
    areas,
    impersonating: false,
    realRole: rol,
    error: null,
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => clienteFalso(),
  createClient: async () => clienteFalso(),
}))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())

// ── El doble de la base ──────────────────────────────────────────────────────

function clienteFalso() {
  return {
    from: (tabla: string) => constructor(tabla),
    rpc: async () => ({ data: null, error: null }),
  }
}

function constructor(tabla: string) {
  const filtros: Array<(f: Fila) => boolean> = []
  let operacion: 'select' | 'insert' | 'update' | 'delete' = 'select'
  let payload: Fila | Fila[] = {}
  let columnas = ''
  let limite: number | null = null
  let orden: { col: string; asc: boolean } | null = null

  const proyectar = (f: Fila): Fila => {
    const salida: Fila = { ...f }
    if (columnas.includes('rubros(')) {
      salida.rubros = (tablas.rubros ?? []).filter(r => r.item_id === f.id).map(r => ({ ...r }))
    }
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      salida.lineas_negocio = l ? { config_extra: l.config_extra } : null
    }
    if (columnas.includes('itinerario_opciones(')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    if (tabla === 'bloque_configs' && columnas.includes('bloque_definitions')) {
      salida.bloque_definitions = { tipo: f.tipo }
    }
    if (columnas.includes('empresas(')) salida.empresas = null
    return salida
  }

  const ejecutar = (): { data: unknown; error: { code?: string; message: string } | null } => {
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    const coinciden = todas.filter(f => filtros.every(fn => fn(f)))
    if (operacion === 'insert') {
      const lote = Array.isArray(payload) ? payload : [payload]
      if (tabla === 'negocio_servicios') {
        if (fallarInsertServicios) return { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
        // El índice único parcial `(negocio_id, item_id) where item_id is not null`: un lote que
        // lo viole no entra entero, como en Postgres.
        const choca = lote.some((p, i) =>
          p.item_id != null && (
            todas.some(f => f.negocio_id === p.negocio_id && f.item_id === p.item_id)
            || lote.slice(0, i).some(q => q.negocio_id === p.negocio_id && q.item_id === p.item_id)
          ))
        if (choca) return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint "negocio_servicios_item_unico"' } }
      }
      const nuevas = lote.map(p => ({
        id: `${tabla}-${++secuencia}`,
        created_at: new Date(Date.now() + secuencia).toISOString(),
        ...p,
        ...(tabla === 'rubros' ? { valor_total: Number(p.cantidad) * Number(p.valor_unitario) } : {}),
      }))
      todas.push(...nuevas)
      return { data: nuevas.map(proyectar), error: null }
    }
    if (operacion === 'update') {
      for (const f of coinciden) Object.assign(f, payload)
      return { data: coinciden.map(proyectar), error: null }
    }
    if (operacion === 'delete') {
      tablas[tabla] = todas.filter(f => !coinciden.includes(f))
      return { data: null, error: null }
    }
    let filas = [...coinciden]
    if (orden) {
      const { col, asc } = orden
      filas.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (asc ? 1 : -1))
    }
    if (limite !== null) filas = filas.slice(0, limite)
    return { data: filas.map(proyectar), error: null }
  }

  // Una consulta real sale en otro turno del event loop: así dos llamadas a la vez se cruzan.
  const enOtroTurno = <T,>(v: T) => new Promise<T>(r => setTimeout(() => r(v), 0))

  const api = {
    select(cols?: string) {
      if (operacion === 'select') columnas = typeof cols === 'string' ? cols : '*'
      return api
    },
    insert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    upsert(p: Fila | Fila[]) { operacion = 'insert'; payload = p; return api },
    update(p: Fila) { operacion = 'update'; payload = p; return api },
    delete() { operacion = 'delete'; return api },
    eq(col: string, val: unknown) { filtros.push(f => f[col] === val); return api },
    neq(col: string, val: unknown) { filtros.push(f => f[col] !== val); return api },
    is(col: string, val: unknown) { filtros.push(f => (f[col] ?? null) === val); return api },
    not(col: string, op: string, val: unknown) {
      if (op === 'is' && val === null) filtros.push(f => f[col] != null)
      return api
    },
    in(col: string, vals: unknown[]) { filtros.push(f => vals.includes(f[col])); return api },
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending !== false }
      return api
    },
    limit(n: number) { limite = n; return api },
    single() {
      return enOtroTurno(ejecutar()).then(r => ({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error }))
    },
    maybeSingle() {
      return enOtroTurno(ejecutar()).then(r => ({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error }))
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return enOtroTurno(null).then(() => ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import { aceptarCotizacionNegocio, corregirCotizacionAceptada } from './[id]/cotizacion/actions'
import { actualizarServicio, traerServiciosDeCotizacion } from './servicios-viaje-actions'
import { generarServiciosDesdeTarifa } from '@/lib/viaje/servicios-viaje-datos'
import { reiniciarModulo } from '../../../../test/exigir-modulo-doble'

// ── Escenario: Cusco, tres tarifas en la ranura de vuelo ─────────────────────

function linea(id: string, costo: number, precio: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre: id.toUpperCase(), descripcion: null,
    grupo: null, opcion_de: null, orden: 1, es_ajuste: false, cantidad: 1,
    subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: precio, precio_manual: true, unidad: null,
    ...extra,
  }
}

const PERFIL_TRAPPVEL = {
  workspace_id: WS, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
  is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
  nit: '900945317', razon_social: 'TRAPPVEL PRUEBA S.A.S',
}

function sembrar(opts: { activo?: boolean } = {}) {
  secuencia = 0
  fallarInsertServicios = false
  rol = 'operator'
  areas = []
  reiniciarModulo(WS, { business: true })
  tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0099', consecutivo: 'COT-2026-0099', modo: 'detallada',
      descripcion: 'PRUEBA · Cusco', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: null, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: 0, aiu_imprevistos_pct: 0,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: null, fecha_validez: '2026-11-20',
      updated_at: '2026-10-12T10:00:00Z',
    }],
    items: [
      linea('va', 1_800_000, 2_200_000, { nombre: 'LATAM BOG-CUZ', grupo: 'vuelo', orden: 1 }),
      linea('vb', 2_100_000, 2_500_000, { nombre: 'AVIANCA BOG-CUZ', grupo: 'vuelo', opcion_de: 'va', orden: 2 }),
      linea('hotel', 1_100_000, 1_300_000, { nombre: 'Hotel Andino', grupo: 'hotel', orden: 3 }),
      linea('traslado', 200_000, 250_000, { nombre: 'Traslado aeropuerto', grupo: 'traslado', orden: 4 }),
      linea('fee', 50_000, 60_000, { nombre: 'Fee de emisión', orden: 5 }),
      linea('tour', 300_000, 360_000, { nombre: 'Montaña de colores', grupo: 'actividad', entra_al_precio: false, orden: 6 }),
    ],
    rubros: [],
    item_adicionales: [],
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'PRUEBA · CUSCO', estado: 'abierto', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e2' }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: {
        margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 },
        ...(opts.activo ? { servicios_viaje: { activo: true } } : {}),
      },
    }],
    etapas_negocio: [
      { id: 'e1', linea_id: LINEA, orden: 1, config_extra: {} },
      { id: 'e2', linea_id: LINEA, orden: 2, config_extra: {} },
    ],
    bloque_configs: [{ id: 'bc-cot', etapa_id: 'e2', workspace_id: WS, estado: 'editable', config_extra: {}, tipo: 'cotizacion' }],
    cotizacion_itinerarios: [
      { id: 'it-eco', workspace_id: WS, cotizacion_id: COT, nombre: 'Económica', orden: 1, va_en_propuesta: true, es_principal: false, motivo_codigo: null, motivo_texto: null },
      { id: 'it-rec', workspace_id: WS, cotizacion_id: COT, nombre: 'Recomendada', orden: 2, va_en_propuesta: true, es_principal: false, motivo_codigo: null, motivo_texto: null },
    ],
    itinerario_opciones: [
      { itinerario_id: 'it-eco', item_id: 'va' },
      { itinerario_id: 'it-rec', item_id: 'vb' },
    ],
    cotizacion_ranuras: [],
    cotizacion_excepciones_margen: [],
    activity_log: [],
    decisiones_combinacion: [],
    negocio_bloques: [],
    negocio_responsables: [],
    negocio_servicios: [],
    gastos: [],
    cobros: [],
    profiles: [{ id: 'p-ale', workspace_id: WS, role: 'operator', full_name: 'Alejandra Prueba', platform_admin: false }],
    staff: [{ id: 's-ale', full_name: 'Alejandra Prueba', position: 'Asesora' }],
    workspaces: [{ id: WS, name: 'Trappvel', cotizacion_template_slug: 'trappvel', config_extra: {} }],
    empresas: [],
    fiscal_profiles: [PERFIL_TRAPPVEL],
  }
}

const servicios = () => tablas.negocio_servicios
const cot = () => tablas.cotizaciones[0] as Fila
const precioAprobado = () => (tablas.negocios[0] as Fila).precio_aprobado

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('aceptar con servicios del viaje encendidos', () => {
  beforeEach(() => sembrar({ activo: true }))

  it('crea una fila por ítem de la tarifa aceptada, sin la sugerencia fuera del precio (F0-1)', async () => {
    expect(await aceptarCotizacionNegocio(COT, NEG, 'it-eco')).toEqual({ success: true })
    expect(servicios().map(s => [s.item_id, s.tipo])).toEqual([
      ['va', 'vuelo'], ['hotel', 'hotel'], ['traslado', 'traslado'], ['fee', 'otro'],
    ])
    expect(servicios().every(s => s.workspace_id === WS && s.negocio_id === NEG && s.estado === 'por_reservar')).toBe(true)
    expect(servicios().every(s => s.itinerario_id === 'it-eco' && s.cotizacion_id === COT)).toBe(true)
  })

  it('Σ costo cotizado = costo directo de la tarifa aceptada, al peso (F0-2)', async () => {
    await aceptarCotizacionNegocio(COT, NEG, 'it-rec')
    const suma = servicios().reduce((s, f) => s + Number(f.costo_cotizado), 0)
    expect(suma).toBe(2_100_000 + 1_100_000 + 200_000 + 50_000)
  })

  it('generar otra vez no duplica (F0-3)', async () => {
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
    const r = await generarServiciosDesdeTarifa(clienteFalso(), { workspaceId: WS, negocioId: NEG, cotizacionId: COT })
    expect(r).toEqual({ ok: true, creadas: 0, existentes: 4 })
    expect(servicios()).toHaveLength(4)
  })

  it('dos generaciones a la vez (doble clic) dejan una sola fila por ítem (F0-3)', async () => {
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
    tablas.negocio_servicios = []
    const [a, b] = await Promise.all([
      generarServiciosDesdeTarifa(clienteFalso(), { workspaceId: WS, negocioId: NEG, cotizacionId: COT }),
      generarServiciosDesdeTarifa(clienteFalso(), { workspaceId: WS, negocioId: NEG, cotizacionId: COT }),
    ])
    expect(a.ok && b.ok).toBe(true)
    expect(servicios()).toHaveLength(4)
    expect(new Set(servicios().map(s => s.item_id)).size).toBe(4)
  })

  it('si crear las filas falla, la aceptación se queda y el botón las trae después (F0-4)', async () => {
    fallarInsertServicios = true
    expect(await aceptarCotizacionNegocio(COT, NEG, 'it-eco')).toEqual({ success: true })
    expect(cot().estado).toBe('aceptada')
    expect(precioAprobado()).toBe(2_200_000 + 1_300_000 + 250_000 + 60_000)
    expect(servicios()).toHaveLength(0)

    fallarInsertServicios = false
    rol = 'operator'
    areas = ['operaciones']
    expect(await traerServiciosDeCotizacion(NEG)).toEqual({ ok: true, creadas: 4 })
    // Tocarlo otra vez no duplica.
    expect(await traerServiciosDeCotizacion(NEG)).toEqual({ ok: true, creadas: 0 })
    expect(servicios()).toHaveLength(4)
  })
})

describe('apagado: lo de hoy y nada más (F0-7)', () => {
  it('cero filas y el mismo precio aprobado que con el interruptor encendido', async () => {
    sembrar({ activo: true })
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
    const precioEncendido = precioAprobado()

    sembrar({ activo: false })
    expect(await aceptarCotizacionNegocio(COT, NEG, 'it-eco')).toEqual({ success: true })
    expect(servicios()).toHaveLength(0)
    expect(precioAprobado()).toBe(precioEncendido)
  })

  it('«Traer los servicios» tampoco escribe con la línea apagada', async () => {
    sembrar({ activo: false })
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
    rol = 'owner'
    const r = await traerServiciosDeCotizacion(NEG)
    expect(r.ok).toBe(false)
    expect(servicios()).toHaveLength(0)
  })
})

describe('corregir la aceptación (F0-5)', () => {
  beforeEach(() => sembrar({ activo: true }))

  it('borra las filas que salieron de la cotización y no tienen pagos; deja las agregadas a mano', async () => {
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
    tablas.negocio_servicios.push({ id: 'manual-1', workspace_id: WS, negocio_id: NEG, item_id: null, origen: 'manual', tipo: 'otro', nombre: 'Propina guía' })
    rol = 'owner'
    expect(await corregirCotizacionAceptada(COT, NEG)).toEqual({ success: true })
    expect(cot().estado).toBe('borrador')
    expect(servicios().map(s => s.id)).toEqual(['manual-1'])
  })

  it('se niega, con mensaje llano y sin tocar nada, si alguna fila ya tiene un pago a proveedor', async () => {
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
    const hotel = servicios().find(s => s.item_id === 'hotel') as Fila
    tablas.gastos.push({ id: 'g-1', workspace_id: WS, negocio_id: NEG, servicio_id: hotel.id, monto: 1_100_000, categoria: 'proveedor_viaje' })
    rol = 'owner'
    const r = await corregirCotizacionAceptada(COT, NEG)
    expect(r.success).toBe(false)
    expect((r as { error: string }).error).toMatch(/pagos a proveedores/)
    expect(cot().estado).toBe('aceptada')
    expect(precioAprobado()).not.toBeNull()
    expect(servicios()).toHaveLength(4)
  })
})

describe('permisos en el servidor (§7.4)', () => {
  beforeEach(async () => {
    sembrar({ activo: true })
    await aceptarCotizacionNegocio(COT, NEG, 'it-eco')
  })

  it('una comercial que no es responsable no trae servicios ni edita filas', async () => {
    tablas.negocio_servicios = []
    rol = 'operator'
    areas = ['comercial']
    expect((await traerServiciosDeCotizacion(NEG)).ok).toBe(false)
    expect(servicios()).toHaveLength(0)
  })

  it('operaciones edita una fila; la comercial no; un estado derivado no se escribe a mano', async () => {
    const hotel = servicios().find(s => s.item_id === 'hotel') as Fila
    rol = 'operator'
    areas = ['comercial']
    expect((await actualizarServicio(hotel.id as string, { localizador: 'K7P2Q' })).ok).toBe(false)
    expect(hotel.localizador).toBeUndefined()

    areas = ['operaciones']
    expect(await actualizarServicio(hotel.id as string, { localizador: ' K7P2Q ', fecha_limite_pago: '2026-11-01', estado: 'reservado' })).toEqual({ ok: true })
    expect([hotel.localizador, hotel.fecha_limite_pago, hotel.estado]).toEqual(['K7P2Q', '2026-11-01', 'reservado'])

    const r = await actualizarServicio(hotel.id as string, { estado: 'pagado' as never })
    expect(r.ok).toBe(false)
    expect(hotel.estado).toBe('reservado')
  })

  it('un negocio cerrado no se alimenta', async () => {
    const hotel = servicios().find(s => s.item_id === 'hotel') as Fila
    ;(tablas.negocios[0] as Fila).estado = 'completado'
    rol = 'owner'
    expect((await actualizarServicio(hotel.id as string, { localizador: 'X' })).ok).toBe(false)
  })
})
