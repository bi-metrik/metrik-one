/**
 * «Nada sale al cliente bajo el margen mínimo sin la firma de Edgar», probado LLAMANDO
 * A LAS ACCIONES, no mirando botones (decisión del 2026-09-22, Trappvel).
 *
 * Corre contra las funciones reales: `generateCotizacionPDF`, los dos «Enviar»,
 * «Aprobar», `autorizarBajoElMinimo`, `recalcularTotales`, `marcarEnPropuesta` y el
 * gate `evaluarGateMargen`. La sesión y el cliente de servicio se sustituyen por un
 * doble que ESCRIBE: con uno de solo lectura, «no se guardó» y «se guardó y no se ve»
 * serían indistinguibles.
 *
 * Los ocho casos de la verificación del brief están aquí, en el mismo orden.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { inflateSync } from 'node:zlib'

type Fila = Record<string, unknown>

let tablas: Record<string, Fila[]> = {}
let secuencia = 0

// ── Sesión ───────────────────────────────────────────────────────────────────

const WS = 'ws-trappvel'
const LINEA = 'linea-viaje'
const NEG = 'neg-1'
const COT = 'cot-1'

const PERSONAS = {
  edgar: { userId: 'p-edgar', staffId: 's-edgar', role: 'owner', nombre: 'Edgar Alarcón', platformAdmin: false },
  alejandra: { userId: 'p-ale', staffId: 's-ale', role: 'operator', nombre: 'Alejandra Lancheros', platformAdmin: false },
  admin: { userId: 'p-adm', staffId: 's-adm', role: 'admin', nombre: 'Admin Trappvel', platformAdmin: false },
  mauricio: { userId: 'p-mau', staffId: null, role: 'owner', nombre: 'Mauricio Moreno', platformAdmin: true },
} as const

let quien: keyof typeof PERSONAS = 'alejandra'
let suplantando = false

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => {
    const p = PERSONAS[quien]
    return {
      supabase: clienteFalso(),
      workspaceId: WS,
      userId: p.userId,
      staffId: p.staffId,
      role: p.role,
      areas: [],
      impersonating: suplantando,
      realRole: p.role,
      error: null,
    }
  },
}))

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => clienteFalso(),
  createClient: async () => clienteFalso(),
}))

// Almacenamiento: se registra lo que se sube, para afirmar que un borrador NO se guarda.
const subidas: string[] = []
vi.mock('@/lib/almacenamiento/proveedor', () => ({ usaAlmacenamientoExterno: async () => true }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async (a: { nombre: string }) => {
      subidas.push(a.nombre)
      return { referencia: `sbext://one-documentos/${a.nombre}`, path: '', bytes: 0, sha256: '' }
    },
  }),
}))
vi.mock('@/lib/google-drive', () => ({
  uploadFileToDrive: async () => { throw new Error('Drive no debe llamarse') },
  createDriveFolder: async () => { throw new Error('Drive no debe llamarse') },
}))
vi.mock('@/lib/pdf/pdf-render-client', () => ({
  isPdfRenderConfigured: () => false,
  renderViaService: async () => { throw new Error('no debería llamarse') },
}))

// ── El doble de la base ──────────────────────────────────────────────────────

function clienteFalso() {
  return { from: (tabla: string) => constructor(tabla) }
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
    if (columnas.includes('rubros(')) salida.rubros = []
    if (columnas.includes('lineas_negocio(')) {
      const l = (tablas.lineas_negocio ?? []).find(x => x.id === f.linea_id)
      salida.lineas_negocio = l ? { config_extra: l.config_extra } : null
    }
    if (columnas.includes('itinerario_opciones(')) {
      salida.itinerario_opciones = (tablas.itinerario_opciones ?? [])
        .filter(o => o.itinerario_id === f.id)
        .map(o => ({ item_id: o.item_id }))
    }
    if (columnas.includes('empresas(')) salida.empresas = null
    if (columnas.includes('oportunidades(')) salida.oportunidades = null
    return salida
  }

  const ejecutar = (): { data: unknown; error: { code?: string; message: string } | null } => {
    const todas = tablas[tabla] ?? (tablas[tabla] = [])
    const coinciden = todas.filter(f => filtros.every(fn => fn(f)))
    if (operacion === 'insert') {
      const nuevas = (Array.isArray(payload) ? payload : [payload]).map(p => ({
        id: `${tabla}-${++secuencia}`,
        created_at: new Date(Date.now() + secuencia).toISOString(),
        autorizada_at: new Date(Date.now() + secuencia).toISOString(),
        perdida_at: null,
        ...p,
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
    in(col: string, vals: unknown[]) { filtros.push(f => vals.includes(f[col])); return api },
    order(col: string, opts?: { ascending?: boolean }) {
      orden = { col, asc: opts?.ascending !== false }
      return api
    },
    limit(n: number) { limite = n; return api },
    single() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })
    },
    maybeSingle() {
      const r = ejecutar()
      return Promise.resolve({ data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error })
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    then(resolve: (v: any) => unknown, reject?: (e: unknown) => unknown) {
      return Promise.resolve(ejecutar()).then(resolve, reject)
    },
  }
  return api
}

import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { aceptarCotizacion, enviarCotizacion, recalcularTotales, updateCotizacion } from './cotizacion-actions'
import { aceptarCotizacionNegocio, enviarCotizacionNegocio } from './[id]/cotizacion/actions'
import { autorizarBajoElMinimo, getSalidaDeCotizacion } from './margen-salida-actions'
import { marcarEnPropuesta } from './itinerario-actions'
import { evaluarGateMargen } from '@/lib/cotizaciones/gate-margen-datos'
import { TEXTO_MARCA_BORRADOR } from '@/lib/pdf/marca-borrador'

// ── Escenario ────────────────────────────────────────────────────────────────

/** Una línea con precio escrito a mano: costo y precio exactos, margen exacto. */
function linea(id: string, costo: number, precio: number, extra: Fila = {}): Fila {
  return {
    id, cotizacion_id: COT, nombre: id.toUpperCase(), descripcion: null,
    grupo: null, opcion_de: null, orden: 1, es_ajuste: false, cantidad: 1,
    subtotal: costo, descuento_porcentaje: 0, margen_porcentaje: null,
    precio_venta: precio, precio_manual: true, unidad: null,
    ...extra,
  }
}

function sembrar(opts: {
  items: Fila[]
  /** La línea declara el piso y el gate en una etapa (Trappvel). `false` = otro workspace. */
  conRegla?: boolean
  itinerarios?: Array<{ id: string; nombre: string; orden: number; va: boolean; principal?: boolean; seleccion: string[] }>
}) {
  const conRegla = opts.conRegla !== false
  secuencia = 0
  subidas.length = 0
  quien = 'alejandra'
  suplantando = false
  tablas = {
    cotizaciones: [{
      id: COT, workspace_id: WS, negocio_id: NEG, oportunidad_id: null,
      codigo: 'COT-2026-0007', consecutivo: 'COT-2026-0007', modo: 'detallada',
      descripcion: 'Cartagena', estado: 'borrador', valor_total: 0, costo_total: 0,
      margen_porcentaje: 15, margen_default_pct: 15, convencion_margen: 'sobre_venta',
      descuento_porcentaje: 0, descuento_valor: 0, aiu_admin_pct: 0, aiu_imprevistos_pct: 0,
      piso_margen_pct: 5, aviso_margen_pct: 10, fecha_envio: null, fecha_validez: null,
      condiciones_pago: null, notas: null,
    }],
    items: opts.items,
    negocios: [{ id: NEG, workspace_id: WS, linea_id: LINEA, nombre: 'Viaje Cartagena', carpeta_url: null, empresa_id: null, precio_aprobado: null }],
    lineas_negocio: [{
      id: LINEA,
      config_extra: conRegla
        ? { margen: { piso_pct: 5, aviso_pct: 10, convencion: 'sobre_venta', default_pct: 15 } }
        : {},
    }],
    etapas_negocio: [
      { id: 'e1', linea_id: LINEA, orden: 1, config_extra: {} },
      { id: 'e2', linea_id: LINEA, orden: 2, config_extra: conRegla ? { gates: ['margen_sobre_piso'] } : {} },
    ],
    cotizacion_itinerarios: (opts.itinerarios ?? []).map(i => ({
      id: i.id, cotizacion_id: COT, nombre: i.nombre, orden: i.orden,
      va_en_propuesta: i.va, es_principal: i.principal === true,
    })),
    itinerario_opciones: (opts.itinerarios ?? []).flatMap(i => i.seleccion.map(item => ({ itinerario_id: i.id, item_id: item }))),
    cotizacion_excepciones_margen: [],
    activity_log: [],
    decisiones_combinacion: [],
    negocio_bloques: [],
    profiles: Object.values(PERSONAS).map(p => ({
      id: p.userId, workspace_id: WS, role: p.role, full_name: p.nombre, platform_admin: p.platformAdmin,
    })),
    staff: Object.values(PERSONAS).filter(p => p.staffId).map(p => ({ id: p.staffId, full_name: p.nombre })),
    workspaces: [{ id: WS, name: 'Trappvel', logo_url: null, color_primario: null, cotizacion_template_slug: 'metrik', config_extra: {} }],
    empresas: [],
    fiscal_profiles: [],
  }
}

/** Tres tarifas en la ranura de vuelo: solo la Económica queda bajo el piso (3 %). */
function sembrarTresTarifas(conRegla = true) {
  sembrar({
    conRegla,
    items: [
      linea('va', 970, 1000, { grupo: 'vuelo', orden: 1 }),
      linea('vb', 880, 1000, { grupo: 'vuelo', opcion_de: 'va', orden: 2 }),
      linea('vc', 800, 1000, { grupo: 'vuelo', opcion_de: 'va', orden: 3 }),
    ],
    itinerarios: [
      { id: 'it-eco', nombre: 'Económica', orden: 1, va: true, seleccion: ['va'] },
      { id: 'it-rec', nombre: 'Recomendada', orden: 2, va: true, principal: true, seleccion: ['vb'] },
      { id: 'it-pre', nombre: 'Premium', orden: 3, va: true, seleccion: ['vc'] },
    ],
  })
}

/** El texto de un PDF: se inflan los flujos y se leen los operadores de texto. */
function textoDelPDF(base64: string): string {
  const buf = Buffer.from(base64, 'base64')
  const trozos: string[] = []
  let desde = 0
  for (;;) {
    const ini = buf.indexOf('stream', desde)
    if (ini === -1) break
    let inicio = ini + 'stream'.length
    if (buf[inicio] === 0x0d) inicio++
    if (buf[inicio] === 0x0a) inicio++
    const fin = buf.indexOf('endstream', inicio)
    if (fin === -1) break
    try { trozos.push(inflateSync(buf.subarray(inicio, fin)).toString('latin1')) } catch { /* fuente o imagen */ }
    // Después de `endstream`, no dentro: buscar desde `fin + 1` vuelve a encontrar el
    // «stream» de «endstream» y se salta el flujo siguiente — que en un PDF de pdf-lib
    // es justo el de la marca de agua.
    desde = fin + 'endstream'.length
  }
  const piezas: string[] = []
  const re = /<([0-9A-Fa-f\s]*)>|\(((?:\\.|[^\\)])*)\)/g
  let m: RegExpExecArray | null
  const contenido = trozos.join('\n')
  while ((m = re.exec(contenido)) !== null) {
    if (m[1] !== undefined) {
      const hex = m[1].replace(/\s+/g, '')
      let s = ''
      for (let i = 0; i + 1 < hex.length; i += 2) s += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16))
      piezas.push(s)
    } else {
      piezas.push(m[2] ?? '')
    }
  }
  return piezas.join(' ')
}

function estadoCot() {
  return (tablas.cotizaciones[0] as Fila).estado
}

function logsDeExcepcion() {
  return (tablas.activity_log ?? []).filter(l => l.campo_modificado === 'excepcion_margen')
}

beforeEach(() => {
  sembrar({ items: [] })
})

// ── 1 · Sin tarifas marcadas, bajo el piso ───────────────────────────────────

describe('1 · cotización bajo el piso sin tarifas marcadas', () => {
  beforeEach(() => sembrar({ items: [linea('paquete', 970, 1000)] }))

  it('el PDF sale, con marca de agua, y no se guarda ni se registra', async () => {
    const res = await generateCotizacionPDF(COT) as { success: boolean; pdf: string; filename: string; borrador?: boolean; aviso?: string }
    expect(res.success).toBe(true)
    expect(res.borrador).toBe(true)
    expect(res.filename).toMatch(/BORRADOR\.pdf$/)
    const texto = textoDelPDF(res.pdf)
    expect(texto).toContain('BORRADOR')
    expect(texto).toContain('margen bajo el m')
    expect(subidas).toEqual([])
    expect(tablas.decisiones_combinacion).toEqual([])
    expect(res.aviso).toContain('3 %')
  })

  it('«Enviar» del editor se rechaza en el servidor, con margen y mínimo', async () => {
    const res = await enviarCotizacion(COT)
    expect(res.success).toBe(false)
    expect(res.error).toBe('La cotización deja un margen de 3 %, por debajo del mínimo de 5 %. Pídele a Edgar que la autorice o ajusta el precio.')
    expect(estadoCot()).toBe('borrador')
  })

  it('«Enviar» del bloque se rechaza en el servidor', async () => {
    const res = await enviarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(estadoCot()).toBe('borrador')
  })

  it('«Aprobar» se rechaza y no toca el precio aprobado', async () => {
    const res = await aceptarCotizacionNegocio(COT, NEG)
    expect(res.success).toBe(false)
    expect(estadoCot()).toBe('borrador')
    expect((tablas.negocios[0] as Fila).precio_aprobado).toBeNull()
  })

  it('las puertas traseras también: la aprobación vieja y el `estado` por el endpoint genérico', async () => {
    tablas.cotizaciones[0].estado = 'enviada'
    expect((await aceptarCotizacion(COT)).success).toBe(false)
    expect(estadoCot()).toBe('enviada')
    tablas.cotizaciones[0].estado = 'borrador'
    expect((await updateCotizacion(COT, { estado: 'enviada' })).success).toBe(false)
    expect(estadoCot()).toBe('borrador')
  })
})

// ── 2 · Tres tarifas, solo la Económica bajo el piso ─────────────────────────

describe('2 · tres tarifas y solo la Económica bajo el piso', () => {
  beforeEach(() => sembrarTresTarifas())

  it('el PDF sale con marca de agua', async () => {
    const res = await generateCotizacionPDF(COT) as { borrador?: boolean; pdf: string }
    expect(res.borrador).toBe(true)
    expect(textoDelPDF(res.pdf)).toContain('BORRADOR')
  })

  it('«Enviar» y «Aprobar» se rechazan nombrando la Económica, su margen y el mínimo', async () => {
    const esperado = 'La tarifa Económica deja un margen de 3 %, por debajo del mínimo de 5 %. Pídele a Edgar que la autorice o ajusta el precio.'
    expect((await enviarCotizacion(COT)).error).toBe(esperado)
    expect((await enviarCotizacionNegocio(COT, NEG)).error).toBe(esperado)
    expect((await aceptarCotizacionNegocio(COT, NEG)).error).toBe(esperado)
    expect(estadoCot()).toBe('borrador')
  })

  it('la Económica bajo el piso SÍ se puede marcar para la propuesta: el candado está en la salida', async () => {
    tablas.cotizacion_itinerarios[0].va_en_propuesta = false
    const res = await marcarEnPropuesta('it-eco', true)
    expect(res.success).toBe(true)
    expect(tablas.cotizacion_itinerarios[0].va_en_propuesta).toBe(true)
  })

  it('el gate de etapa aplica la misma regla y nombra la Económica', async () => {
    const v = await evaluarGateMargen(clienteFalso(), NEG, {
      workspaceId: WS, servicio: () => clienteFalso(), staffId: null,
    })
    expect(v.bloquea).toBe(true)
    expect(v.mensaje).toContain('La tarifa Económica deja un margen de 3 %')
  })
})

// ── 3 · Solo el dueño autoriza ───────────────────────────────────────────────

describe('3 · una operadora, un admin o un platform admin no autorizan', () => {
  beforeEach(() => sembrarTresTarifas())

  it.each(['alejandra', 'admin', 'mauricio'] as const)('%s no ve el botón y la acción directa se rechaza', async persona => {
    quien = persona
    expect((await getSalidaDeCotizacion(COT)).puedeAutorizar).toBe(false)
    const res = await autorizarBajoElMinimo(COT, 'El cliente es recurrente')
    expect(res.success).toBe(false)
    expect(tablas.cotizacion_excepciones_margen).toEqual([])
    expect(logsDeExcepcion()).toEqual([])
  })

  it('«Ver como» Edgar no es Edgar', async () => {
    quien = 'edgar'
    suplantando = true
    expect((await getSalidaDeCotizacion(COT)).puedeAutorizar).toBe(false)
    expect((await autorizarBajoElMinimo(COT, 'El cliente es recurrente')).success).toBe(false)
  })

  it('el dueño sí ve el botón', async () => {
    quien = 'edgar'
    expect((await getSalidaDeCotizacion(COT)).puedeAutorizar).toBe(true)
  })

  it('sin motivo no hay autorización, ni siquiera del dueño', async () => {
    quien = 'edgar'
    expect((await autorizarBajoElMinimo(COT, '  ')).success).toBe(false)
    expect(tablas.cotizacion_excepciones_margen).toEqual([])
  })
})

// ── 4 · El dueño autoriza ────────────────────────────────────────────────────

describe('4 · el dueño autoriza con motivo', () => {
  beforeEach(() => sembrarTresTarifas())

  it('el PDF sale limpio, «Enviar» pasa y todo queda en activity_log', async () => {
    quien = 'edgar'
    const aut = await autorizarBajoElMinimo(COT, 'Cliente recurrente, compensa en el grupo de diciembre')
    expect(aut).toEqual({ success: true })

    const excepcion = tablas.cotizacion_excepciones_margen[0]
    expect(excepcion.autorizada_por_staff_id).toBe('s-edgar')
    expect(excepcion.autorizada_por_profile_id).toBe('p-edgar')
    expect(excepcion.motivo).toBe('Cliente recurrente, compensa en el grupo de diciembre')
    expect(excepcion.piso_pct).toBe(5)

    const [log] = logsDeExcepcion()
    expect(log.autor_id).toBe('s-edgar')
    expect(log.valor_nuevo).toBe('autorizada')
    expect(log.contenido).toContain('Autorizó COT-2026-0007 bajo el margen mínimo de 5 %')
    expect(log.contenido).toContain('tarifa Económica al 3 %')
    expect(log.contenido).toContain('Motivo: Cliente recurrente')

    // Quien trabaja la cotización ve la autorización.
    quien = 'alejandra'
    const vista = await getSalidaDeCotizacion(COT)
    expect(vista.bloquea).toBe(false)
    expect(vista.excepcion?.autorizadaPor).toBe('Edgar')
    expect(vista.excepcion?.motivo).toBe('Cliente recurrente, compensa en el grupo de diciembre')

    const pdf = await generateCotizacionPDF(COT) as { borrador?: boolean; pdf: string; filename: string }
    expect(pdf.borrador).toBeUndefined()
    expect(pdf.filename).not.toMatch(/BORRADOR/)
    expect(textoDelPDF(pdf.pdf)).not.toContain('BORRADOR')

    expect((await enviarCotizacion(COT)).success).toBe(true)
    expect(estadoCot()).toBe('enviada')

    // Y el gate de etapa la cuenta como aprobación.
    const gate = await evaluarGateMargen(clienteFalso(), NEG, { workspaceId: WS, servicio: () => clienteFalso() })
    expect(gate.bloquea).toBe(false)
  })
})

// ── 5 · Cambia un precio: la excepción se pierde sola ────────────────────────

describe('5 · después de autorizar cambia un precio', () => {
  beforeEach(() => sembrarTresTarifas())

  it('la excepción se pierde, vuelve la marca de agua y queda el registro con la causa', async () => {
    quien = 'edgar'
    await autorizarBajoElMinimo(COT, 'Cliente recurrente')

    quien = 'alejandra'
    const eco = tablas.items.find(i => i.id === 'va') as Fila
    eco.precio_venta = 990 // la Económica pasa de 3 % a 2 %
    await recalcularTotales(COT)

    const excepcion = tablas.cotizacion_excepciones_margen[0]
    expect(excepcion.perdida_at).not.toBeNull()
    expect(excepcion.perdida_causa).toContain('La tarifa Económica pasó de 3 %')

    const perdida = logsDeExcepcion().find(l => l.valor_nuevo === 'perdida')
    expect(perdida).toBeDefined()
    expect(perdida!.tipo).toBe('cambio_sistema')
    expect(perdida!.autor_id).toBe('s-ale')
    expect(perdida!.contenido).toContain('Se perdió la autorización de Edgar')

    const pdf = await generateCotizacionPDF(COT) as { borrador?: boolean }
    expect(pdf.borrador).toBe(true)
    expect((await enviarCotizacion(COT)).success).toBe(false)

    const vista = await getSalidaDeCotizacion(COT)
    expect(vista.perdida?.autorizadaPor).toBe('Edgar')
    expect(vista.perdida?.causa).toContain('Económica')

    // Se anota una sola vez aunque otra salida vuelva a mirarla.
    await generateCotizacionPDF(COT)
    expect(logsDeExcepcion().filter(l => l.valor_nuevo === 'perdida')).toHaveLength(1)
  })

  it('un cambio que NO recalcula igual invalida la excepción en la salida (la red)', async () => {
    quien = 'edgar'
    await autorizarBajoElMinimo(COT, 'Cliente recurrente')
    quien = 'alejandra'
    ;(tablas.items.find(i => i.id === 'vc') as Fila).subtotal = 810
    const res = await enviarCotizacion(COT)
    expect(res.success).toBe(false)
    expect(tablas.cotizacion_excepciones_margen[0].perdida_at).not.toBeNull()
  })

  it('renombrar una tarifa no mueve un peso y no pierde la excepción', async () => {
    quien = 'edgar'
    await autorizarBajoElMinimo(COT, 'Cliente recurrente')
    tablas.cotizacion_itinerarios[0].nombre = 'Básica'
    quien = 'alejandra'
    await recalcularTotales(COT)
    expect(tablas.cotizacion_excepciones_margen[0].perdida_at).toBeNull()
  })
})

// ── 6 · Margen que no se puede medir ─────────────────────────────────────────

describe('6 · una línea con margen que no se puede medir', () => {
  it('precio escrito a mano y sin costo: mismo resultado que bajo el piso', async () => {
    sembrar({ items: [linea('paquete', 0, 1000)] })
    const res = await generateCotizacionPDF(COT) as { borrador?: boolean }
    expect(res.borrador).toBe(true)
    const env = await enviarCotizacion(COT)
    expect(env.success).toBe(false)
    expect(env.error).toContain('no tiene un margen que se pueda medir')
  })

  it('una línea sin costo dentro de una cotización con costo NO la vuelve inmedible (es el recargo)', async () => {
    sembrar({ items: [linea('paquete', 700, 1000), linea('recargo', 0, 100_000 / 1000)] })
    expect((await enviarCotizacion(COT)).success).toBe(true)
  })
})

// ── 7 · En el piso o encima: nada cambia ─────────────────────────────────────

describe('7 · cotización en el piso o encima', () => {
  it.each([
    ['justo en el piso', 950],
    ['encima', 800],
  ])('%s: PDF limpio y guardado, «Enviar» y «Aprobar» pasan', async (_c, costo) => {
    sembrar({ items: [linea('paquete', costo, 1000)] })
    const pdf = await generateCotizacionPDF(COT) as { borrador?: boolean; filename: string; pdf: string }
    expect(pdf.borrador).toBeUndefined()
    expect(textoDelPDF(pdf.pdf)).not.toContain('BORRADOR')
    expect(subidas).toEqual([pdf.filename])
    expect((await getSalidaDeCotizacion(COT)).bloquea).toBe(false)
    expect((await enviarCotizacionNegocio(COT, NEG)).success).toBe(true)
    expect((await aceptarCotizacionNegocio(COT, NEG)).success).toBe(true)
    expect(estadoCot()).toBe('aceptada')
  })
})

// ── 8 · Otro workspace: nada cambia ──────────────────────────────────────────

describe('8 · una línea sin piso configurado ni gate', () => {
  it('bajo el piso sale como siempre: PDF limpio y «Enviar» pasa', async () => {
    sembrar({ items: [linea('paquete', 970, 1000)], conRegla: false })
    const pdf = await generateCotizacionPDF(COT) as { borrador?: boolean }
    expect(pdf.borrador).toBeUndefined()
    expect((await getSalidaDeCotizacion(COT)).aplica).toBe(false)
    expect((await enviarCotizacion(COT)).success).toBe(true)
  })

  it('marcar una tarifa bajo el piso sigue rechazado, como antes', async () => {
    sembrarTresTarifas(false)
    tablas.cotizacion_itinerarios[0].va_en_propuesta = false
    const res = await marcarEnPropuesta('it-eco', true)
    expect(res.success).toBe(false)
    expect(tablas.cotizacion_itinerarios[0].va_en_propuesta).toBe(false)
  })

  it('el dueño no tiene nada que autorizar', async () => {
    sembrar({ items: [linea('paquete', 970, 1000)], conRegla: false })
    quien = 'edgar'
    expect((await autorizarBajoElMinimo(COT, 'Cliente recurrente')).success).toBe(false)
  })
})

it('el texto de la marca es el pedido', () => {
  expect(TEXTO_MARCA_BORRADOR).toBe('BORRADOR · margen bajo el mínimo · no enviar')
})
