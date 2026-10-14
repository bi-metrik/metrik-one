/**
 * C0 de la cotización integrada (Trappvel): la PRUEBA DE IGUALDAD DEL SERVIDOR y el
 * PRESUPUESTO DE IDAS A LA BASE. Criterios N1, N2 (fixture) y V5 de
 * `vera-criterios-aceptacion-cotizacion-integrada-2026-10-12.md`.
 *
 * ## Qué fija
 *
 * Para cuatro cotizaciones, la salida de las tres lecturas de plata del servidor:
 *  1. `recalcularTotales`: lo que escribe en `items` y en `cotizaciones` (`valor_total`,
 *     `costo_total`, `descuento_valor`), y lo que devuelve.
 *  2. El PDF: las props EXACTAS que recibe la plantilla (no los bytes, que llevan fecha), lo
 *     que devuelve la acción y lo que escribe al salir.
 *  3. `aceptarCotizacionNegocio`: `precio_aprobado` y todas sus escrituras.
 * Más, con tarifas, el precio de cada tarifa (`opcionesDeAprobacion`), que es la cifra que
 * `calcularCascada` le da a cada una.
 *
 * Las cuatro cotizaciones:
 *  · Termotech (plantilla `termotech`, sin tarifas, con AIU y descuento comercial).
 *  · Genérica (plantilla `metrik`, sin tarifas, con el ítem de cuadre del total fijado a mano).
 *  · Trappvel, el CASO FIJO de San Andrés y Providencia (`test/caso-san-andres.ts`, anonimizado).
 *  · Trappvel, el mismo caso armado como lo deja el flujo nuevo (N2): traslado elegido por
 *    tarifa, traslado Opcional, Recomendada en la propuesta, con el IVA sobre el ingreso propio.
 * Las de Trappvel corren dos veces, con `config_extra.cotizacion_por_pasos` apagado y
 * encendido, y tienen que dar lo mismo (el interruptor gobierna pantalla y escrituras nuevas,
 * nunca la lectura: nota técnica de Max §0).
 *
 * ## Cómo se fijó, y la regla que no se rompe
 *
 * `igualdad-servidor.fixture.json` se grabó UNA vez sobre `origin/main` (commit en
 * `_grabado.commit`), con:
 *
 *     GRABAR_IGUALDAD=1 npx vitest run igualdad-servidor
 *
 * La grabación solo escribe si el archivo NO existe. **No se regenera para que una prueba
 * pase** (regla 3 de Vera): si un PR de C1 a C7 cambia este fixture, el PR no entra.
 *
 * ## Se vio fallar
 *
 * Mutación de control (N1): `itemsDelItinerario` ignorando la selección en las ranuras no
 * combinables. La Premium vuelve a cobrar la lancha compartida en vez de la privada y cae la
 * igualdad del precio de la tarifa, del PDF y de `precio_aprobado`. Ver el PR.
 *
 * ## Presupuesto de idas a la base (V5)
 *
 * Cada acción cuenta sus idas con el doble (`test/igualdad-servidor-doble.ts`) y no puede
 * pasar del número grabado. Bajar sí se puede: ahí se baja el número a mano en el fixture, en
 * el mismo PR, y se dice. «Aceptar en lote» y «Deshacer» no existen todavía: entran con su
 * pieza (C4 y C5) y su número se fija ahí.
 *
 * Se queda en `.ts` por el `include` de vitest.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { base, clienteFalso, escrituras, tomarRegistro, type Fila, type Ida } from '../../../../test/igualdad-servidor-doble'
import {
  COMPOSICION,
  COSTO_RECOMENDADA,
  COT_SAN_ANDRES,
  FECHAS,
  NEG_SAN_ANDRES,
  WS_TRAPPVEL,
  tablasCasoSanAndres,
} from '../../../../test/caso-san-andres'

// ── La sesión y los servicios de fuera ───────────────────────────────────────

const sesion = vi.hoisted(() => ({ workspaceId: '', n: 0 }))

vi.mock('next/cache', () => ({ revalidatePath: () => {}, revalidateTag: () => {} }))
// Con el memo de las rutas, como en producción: dentro de una ruta la sesión se resuelve una vez.
vi.mock('@/lib/actions/get-workspace', async () => {
  const { memoDeRuta } = await import('@/lib/actions/memo-de-ruta')
  return {
    getWorkspace: memoDeRuta(async () => {
      sesion.n++
      return {
        supabase: clienteFalso(), workspaceId: sesion.workspaceId, userId: 'p-asesora', staffId: 's-asesora',
        role: 'operator', areas: [], impersonating: false, realRole: 'operator', error: null,
      }
    }),
  }
})
// El módulo contratado y la imagen del pantallazo no son de esta prueba.
vi.mock('@/lib/modulos/exigir-modulo', () => ({
  exigirModulo: async () => ({ ok: true }),
  MENSAJE_MODULO_NO_ACTIVO: 'sin módulo',
  REQUISITO: { clarity: 'clarity' },
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteFalso(), createClient: async () => clienteFalso() }))

const subidas = vi.hoisted(() => [] as string[])
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

// Las props de la plantilla: las del compositor (Trappvel) o las del único render (las demás).
// Se toma la PRIMERA de cada PDF: el compositor de Trappvel renderiza varias veces por dentro.
const captura = vi.hoisted(() => ({ activa: false, props: null as unknown }))
vi.mock('@/lib/pdf/plantillas-cotizacion', async importOriginal => {
  const real = await importOriginal<typeof import('@/lib/pdf/plantillas-cotizacion')>()
  return {
    ...real,
    compositorDePlantilla: (slug: string | null | undefined) => {
      const c = real.compositorDePlantilla(slug)
      if (!c) return null
      return async (props: Parameters<typeof c>[0]) => {
        if (captura.activa && captura.props === null) captura.props = props
        return c(props)
      }
    },
  }
})
vi.mock('@react-pdf/renderer', async importOriginal => {
  const real = await importOriginal<typeof import('@react-pdf/renderer')>()
  return {
    ...real,
    renderToBuffer: async (elemento: { props: unknown }) => {
      if (captura.activa && captura.props === null) captura.props = elemento.props
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return real.renderToBuffer(elemento as any)
    },
  }
})

import { recalcularTotales } from './cotizacion-actions'
import { generateCotizacionPDF } from './cotizacion-pdf-actions'
import { aceptarCotizacionNegocio, opcionesDeAprobacion } from './[id]/cotizacion/actions'
import { cambiarOpcionDeItinerario } from './itinerario-actions'
import { deshacerPorPasos, elegirOpcionEnTarifa } from './por-pasos-actions'
import { tablasPorPasos } from '../../../../test/caso-por-pasos'
import { POST as aceptarPorLaRuta } from '@/app/api/cotizaciones/[id]/aceptar-captura/route'
import { POST as aceptarLotePorLaRuta } from '@/app/api/cotizaciones/[id]/aceptar-lote/route'
import { onceDelCasoFijo } from '../../../../test/caso-once-pantallazos'
import { firmarBorrador } from '@/lib/cotizaciones/firma-borrador'
import { lecturaManual } from '@/lib/cotizaciones/ingreso-manual'
import { ranuraPorSlug } from '@/lib/cotizaciones/ranuras-pantallazo'

// ── Los escenarios ───────────────────────────────────────────────────────────

const WS_OTRO = 'ws-industrial-prueba'
const COT_OTRA = 'cot-industrial'
const NEG_OTRO = 'neg-industrial'

const rubro = (id: string, itemId: string, tipo: string, valor: number, cantidad = 1): Fila => ({
  id, item_id: itemId, tipo, descripcion: `Rubro ${id}`, cantidad, unidad: 'unidades',
  valor_unitario: valor, valor_total: valor * cantidad, sugerido: false,
})

/** Una cotización de un workspace que no es de viaje: sin tarifas, sin ranuras. */
function tablasOtroWorkspace(opts: { plantilla: 'termotech' | 'metrik'; conCuadre: boolean }): Record<string, Fila[]> {
  const item = (id: string, orden: number, extra: Fila): Fila => ({
    id, cotizacion_id: COT_OTRA, nombre: id.toUpperCase(), descripcion: null, grupo: null, opcion_de: null, orden,
    es_ajuste: false, cantidad: 1, subtotal: 0, descuento_porcentaje: 0, margen_porcentaje: null, precio_venta: 0,
    precio_manual: false, unidad: null, tarifa_pax: null, dia_relativo: null, entra_al_precio: null, base_iva: null,
    ...extra,
  })
  return {
    cotizaciones: [{
      id: COT_OTRA, workspace_id: WS_OTRO, negocio_id: NEG_OTRO, oportunidad_id: null,
      codigo: 'COT-2026-0100', consecutivo: 'COT-2026-0100', modo: 'detallada', descripcion: 'Obra planta de prueba',
      estado: 'borrador',
      // Con el cuadre, el total lo fijó alguien a mano y manda sobre la suma (rama LEGADO).
      valor_total: opts.conCuadre ? 9_800_000 : 0, costo_total: 0,
      margen_porcentaje: 20, margen_default_pct: 20, convencion_margen: 'sobre_venta',
      descuento_porcentaje: opts.conCuadre ? 0 : 5, descuento_valor: 0,
      aiu_admin_pct: opts.conCuadre ? null : 5, aiu_imprevistos_pct: opts.conCuadre ? null : 3,
      piso_margen_pct: null, aviso_margen_pct: null, fecha_envio: null, fecha_validez: '2026-11-12',
      condiciones_pago: '50 % de anticipo', notas: 'Incluye instalación', lugar_entrega: 'Planta de prueba',
      documento_cliente: null, terminos_condiciones: 'Validez 30 días.', tarifa_aceptada_id: null,
    }],
    items: [
      item('bomba', 1, { nombre: 'Bomba centrífuga', descripcion: 'Incluye instalación', cantidad: 2 }),
      item('ingenieria', 2, { nombre: 'Ingeniería', subtotal: 800_000, margen_porcentaje: 30, descuento_porcentaje: 10 }),
      item('transporte', 3, { nombre: 'Transporte', precio_venta: 120_000, precio_manual: true }),
      item('tablero', 4, { nombre: 'Tablero eléctrico', cantidad: 3 }),
      ...(opts.conCuadre ? [item('ajuste', 5, { nombre: 'Ajuste', es_ajuste: true, precio_venta: -1_000, precio_manual: true })] : []),
    ],
    rubros: [
      rubro('r1', 'bomba', 'materiales', 1_250_000),
      rubro('r2', 'bomba', 'mano_de_obra', 180_000, 2),
      rubro('r3', 'tablero', 'materiales', 933_333),
      rubro('r4', 'tablero', 'servicios_prof', 66_667),
      { ...rubro('r5', 'tablero', 'materiales', 50_000), sugerido: true },
    ],
    item_adicionales: [],
    cotizacion_itinerarios: [],
    itinerario_opciones: [],
    negocios: [{ id: NEG_OTRO, workspace_id: WS_OTRO, linea_id: 'linea-proyectos', nombre: 'OBRA PLANTA DE PRUEBA', codigo: 'E 26 4', carpeta_url: null, empresa_id: null, precio_aprobado: null, etapa_actual_id: 'e-propuesta' }],
    negocio_bloques: [],
    lineas_negocio: [{ id: 'linea-proyectos', workspace_id: WS_OTRO, config_extra: {} }],
    etapas_negocio: [{ id: 'e-propuesta', linea_id: 'linea-proyectos', orden: 1, config_extra: {} }],
    bloque_configs: [],
    cotizacion_excepciones_margen: [],
    cotizacion_ranuras: [],
    activity_log: [],
    decisiones_combinacion: [],
    cobros: [],
    profiles: [{ id: 'p-asesora', workspace_id: WS_OTRO, role: 'operator', full_name: 'Comercial de Prueba', platform_admin: false }],
    staff: [{ id: 's-asesora', workspace_id: WS_OTRO, full_name: 'Comercial de Prueba', position: 'Comercial' }],
    workspaces: [{ id: WS_OTRO, name: 'Industrial de Prueba', slug: 'industrial-prueba', logo_url: null, color_primario: null, cotizacion_template_slug: opts.plantilla, config_extra: {} }],
    empresas: [],
    fiscal_profiles: [{
      workspace_id: WS_OTRO, person_type: 'persona_juridica', tax_regime: 'ordinario', iva_responsible: true,
      is_declarante: true, self_withholder: false, ica_rate: null, ica_city: null, is_complete: true,
      nit: '900000002', razon_social: 'INDUSTRIAL DE PRUEBA S.A.S',
    }],
  }
}

const IVA_INGRESO_PROPIO = { iva_cotizacion: { base: 'ingreso_propio', en_documento: 'linea_incluida' } }
/** El interruptor de la cotización por pasos, encendido con todas sus piezas (nota de Max §4.2). */
const INTERRUPTOR_ENCENDIDO = {
  cotizacion_por_pasos: {
    activo: true,
    piezas: { modelo_destino: true, toda_opcion_en_tarifas: true, opcional_traslado: true, incluye_por_one: true, lista_unica: true, margen_por_tarifa: true },
  },
}

interface Escenario {
  nombre: string
  workspaceId: string
  cotizacionId: string
  negocioId: string
  tablas: (interruptor: boolean) => Record<string, Fila[]>
  /** La tarifa que el cliente escoge al aprobar (solo con tarifas). */
  tarifaAprobada: string | null
}

const ESCENARIOS: Escenario[] = [
  {
    nombre: 'termotech',
    workspaceId: WS_OTRO, cotizacionId: COT_OTRA, negocioId: NEG_OTRO, tarifaAprobada: null,
    tablas: () => tablasOtroWorkspace({ plantilla: 'termotech', conCuadre: false }),
  },
  {
    nombre: 'generica-con-cuadre',
    workspaceId: WS_OTRO, cotizacionId: COT_OTRA, negocioId: NEG_OTRO, tarifaAprobada: null,
    tablas: () => tablasOtroWorkspace({ plantilla: 'metrik', conCuadre: true }),
  },
  {
    nombre: 'trappvel-caso-fijo',
    workspaceId: WS_TRAPPVEL, cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-premium',
    tablas: interruptor => tablasCasoSanAndres({ configWorkspace: interruptor ? INTERRUPTOR_ENCENDIDO : {} }),
  },
  {
    nombre: 'trappvel-flujo-nuevo',
    workspaceId: WS_TRAPPVEL, cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-premium',
    tablas: interruptor => tablasCasoSanAndres({
      flujoNuevo: true,
      configWorkspace: { ...IVA_INGRESO_PROPIO, ...(interruptor ? INTERRUPTOR_ENCENDIDO : {}) },
    }),
  },
  {
    nombre: 'trappvel-recomendada-otro-hotel',
    workspaceId: WS_TRAPPVEL, cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-recomendada',
    tablas: interruptor => tablasCasoSanAndres({ recomendada: 'otro-hotel', configWorkspace: interruptor ? INTERRUPTOR_ENCENDIDO : {} }),
  },
  {
    nombre: 'trappvel-recomendada-dos-hoteles',
    workspaceId: WS_TRAPPVEL, cotizacionId: COT_SAN_ANDRES, negocioId: NEG_SAN_ANDRES, tarifaAprobada: 'tf-premium',
    tablas: interruptor => tablasCasoSanAndres({ recomendada: 'dos-hoteles', configWorkspace: interruptor ? INTERRUPTOR_ENCENDIDO : {} }),
  },
]

// ── Correr y anotar ──────────────────────────────────────────────────────────

/**
 * JSON tal cual lo compararía alguien: sin `undefined`, sin funciones, y sin la carpeta
 * donde está el repo (las fotos de ciudad viajan como ruta absoluta del archivo, y en CI el
 * repo vive en otra carpeta que en la máquina que grabó).
 */
const RAIZ_REPO = path.resolve(__dirname, '../../../..')
const plano = <T,>(v: T): T => JSON.parse(JSON.stringify(v ?? null).split(RAIZ_REPO).join('<repo>'))

/** Las escrituras en un orden que no depende de cómo se repartan en paralelo. */
function ordenadas(registro: readonly Ida[]): Ida[] {
  return [...escrituras(registro)].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
}

function sembrar(e: Escenario, interruptor: boolean) {
  base.tablas = e.tablas(interruptor)
  base.secuencia = 0
  base.registro = []
  subidas.length = 0
  sesion.workspaceId = e.workspaceId
  sesion.n = 0
}

const cot = (e: Escenario) => base.tablas.cotizaciones.find(c => c.id === e.cotizacionId) as Fila

interface Salida {
  recalculo: unknown
  pdf: unknown
  tarifas: unknown
  aprobacion: unknown
}
interface Idas {
  recalcular: number
  pdf: number
  aprobar: number
}

async function correr(e: Escenario, interruptor: boolean): Promise<{ salida: Salida; idas: Idas; sesiones: Idas }> {
  sembrar(e, interruptor)

  // 1 · Recalcular.
  const resRecalculo = await recalcularTotales(e.cotizacionId)
  const regRecalculo = tomarRegistro()
  const sesRecalculo = sesion.n
  const c = cot(e)
  const recalculo = {
    resultado: resRecalculo,
    escrituras: ordenadas(regRecalculo),
    cotizacion: { valor_total: c.valor_total, costo_total: c.costo_total, descuento_valor: c.descuento_valor },
    preciosPorLinea: Object.fromEntries(base.tablas.items.map(i => [i.id, i.precio_venta])),
  }

  // 2 · El precio de cada tarifa, como lo calcula el servidor (es lectura: no cuenta en V5).
  const tarifas = await opcionesDeAprobacion(e.cotizacionId)
  tomarRegistro()

  // 3 · El PDF.
  sesion.n = 0
  captura.activa = true
  captura.props = null
  const resPdf = await generateCotizacionPDF(e.cotizacionId) as Fila
  captura.activa = false
  const regPdf = tomarRegistro()
  const sesPdf = sesion.n
  expect(resPdf.success, String(resPdf.error ?? '')).toBe(true)
  expect(captura.props, 'la plantilla no recibió props').not.toBeNull()
  const { pdf: _bytes, ...resultadoPdf } = resPdf
  const pdf = {
    props: captura.props,
    resultado: resultadoPdf,
    escrituras: ordenadas(regPdf),
    subidas: [...subidas],
  }

  // 4 · Aprobar.
  sesion.n = 0
  const resAprobar = await aceptarCotizacionNegocio(e.cotizacionId, e.negocioId, e.tarifaAprobada)
  const regAprobar = tomarRegistro()
  const sesAprobar = sesion.n
  const aprobacion = {
    resultado: resAprobar,
    precio_aprobado: (base.tablas.negocios.find(n => n.id === e.negocioId) as Fila).precio_aprobado,
    escrituras: ordenadas(regAprobar),
  }

  return {
    salida: plano({ recalculo, pdf, tarifas, aprobacion }),
    idas: { recalcular: regRecalculo.length, pdf: regPdf.length, aprobar: regAprobar.length },
    sesiones: { recalcular: sesRecalculo, pdf: sesPdf, aprobar: sesAprobar },
  }
}

// ── Las acciones de V5 que no son de plata: elegir opción en una tarifa ───────

async function idasDeElegirOpcion(): Promise<number> {
  sembrar(ESCENARIOS[2], false)
  await recalcularTotales(COT_SAN_ANDRES)
  tomarRegistro()
  const r = await cambiarOpcionDeItinerario('tf-recomendada', 'hotel 2: Hotel en San Andrés', 'h-lord-pierre')
  expect(r.success, (r as { error?: string }).error).toBe(true)
  return tomarRegistro().length
}

/**
 * C4 · «Deshacer» (y la escritura que deshace): la opción de una tarifa en la cotización por pasos,
 * con el interruptor encendido de verdad (las cuatro condiciones). Entra al presupuesto con su
 * pieza, como decía C0.
 */
async function idasDeDeshacer(): Promise<{ elegir: number; deshacer: number }> {
  base.tablas = tablasPorPasos()
  base.secuencia = 0
  base.registro = []
  sesion.workspaceId = WS_TRAPPVEL
  await recalcularTotales(COT_SAN_ANDRES)
  tomarRegistro()
  const r = await elegirOpcionEnTarifa('tf-premium', 'actividad: Cayo Cangrejo', 'a-cayo-compartida')
  expect(r.success, (r as { error?: string }).error).toBe(true)
  const elegir = tomarRegistro().length
  const d = await deshacerPorPasos({ tipo: 'eleccion', cotizacionId: COT_SAN_ANDRES, itinerarioId: 'tf-premium', grupo: 'actividad: Cayo Cangrejo', escrita: 'a-cayo-compartida', anterior: 'a-cayo-privada' })
  expect(d.success, (d as { error?: string }).error).toBe(true)
  return { elegir, deshacer: tomarRegistro().length }
}

/**
 * «Aceptar» UNO desde la bandeja, por la ruta de verdad (`aceptar-captura`): un traslado nuevo
 * sobre el caso fijo ya armado. Cuenta las idas de la aceptación entera, con su recálculo.
 */
async function idasDeAceptarUno(): Promise<{ idas: number; sesiones: number }> {
  sembrar(ESCENARIOS[2], false)
  await recalcularTotales(COT_SAN_ANDRES)
  tomarRegistro()
  const r = lecturaManual({
    ranura: ranuraPorSlug('traslado_detalle')!,
    entrada: {
      tipo: 'traslado',
      datos: {
        ruta: 'Hotel - muelle de Providencia', fecha: '2026-11-24', adultos: 6, ninos: 1, infantes: 1, cobro: 'por_persona',
        precio: 'por_trayecto', neto: 25_000, netoNino: 25_000, netoInfante: 0, idaYRegreso: true,
        fuente: 'Proveedor de prueba',
      },
    },
    leidaEn: '2026-10-12T14:30:00.000Z',
    hoy: '2026-10-12',
  })
  if (!r.ok) throw new Error(JSON.stringify(r.errores))
  const lecturaJson = JSON.stringify(r.lectura)
  const cuerpo = {
    tipo: 'traslado', lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, 'traslado', lecturaJson)!,
    pistas: { lugar: 'Providencia', origen: null, destino: null }, decision: 'auto', destinoId: null,
    imagen: null, correcciones: null, idAceptacion: null,
  }
  sesion.n = 0
  const res = await aceptarPorLaRuta(
    new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-captura`, { method: 'POST', body: JSON.stringify(cuerpo) }),
    { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
  )
  const json = await res.json() as { ok: boolean; mensaje?: string }
  expect(json.ok, json.mensaje).toBe(true)
  return { idas: tomarRegistro().length, sesiones: sesion.n }
}

/**
 * C5 · «Aceptar los 11 en lote» (V4, V5): los 11 del caso fijo sobre la cotización por pasos
 * VACÍA, por la ruta de verdad (`aceptar-lote`), con un solo recálculo al final. La lancha privada
 * va como «Otra opción de» la compartida del mismo lote, como la elige quien cotiza.
 */
async function idasDeAceptarLote(): Promise<{ idas: number; sesiones: number }> {
  base.tablas = tablasPorPasos()
  base.tablas.items = []
  base.tablas.rubros = []
  base.tablas.cotizacion_itinerarios = []
  base.tablas.itinerario_opciones = []
  base.secuencia = 0
  base.registro = []
  sesion.workspaceId = WS_TRAPPVEL
  const filas = onceDelCasoFijo().map(p => {
    const lecturaJson = JSON.stringify(p.lectura)
    const hermana = p.id === 'cap-caso-10'
    return {
      id: p.id,
      borrador: {
        tipo: p.tipo, lecturaJson, firma: firmarBorrador(COT_SAN_ANDRES, p.tipo, lecturaJson)!, pistas: p.pistas,
        decision: hermana ? 'hermana' : 'auto', destinoId: null, imagen: null, correcciones: null, idAceptacion: p.id,
      },
      ...(hermana ? { destinoCaptura: 'cap-caso-09' } : {}),
    }
  })
  tomarRegistro()
  sesion.n = 0
  const res = await aceptarLotePorLaRuta(
    new Request(`https://x/api/cotizaciones/${COT_SAN_ANDRES}/aceptar-lote`, { method: 'POST', body: JSON.stringify({ filas }) }),
    { params: Promise.resolve({ id: COT_SAN_ANDRES }) },
  )
  const json = await res.json() as { ok: boolean; mensaje?: string; resultados: { resultado: { ok: boolean } }[] }
  expect(json.ok, json.mensaje).toBe(true)
  expect(json.resultados.every(r => r.resultado.ok)).toBe(true)
  return { idas: tomarRegistro().length, sesiones: sesion.n }
}

/**
 * «Abrir la cotización»: la página del servidor (`[id]/cotizacion/[cotId]/page.tsx`), con el
 * marco del negocio de Trappvel. Cuenta las idas de la carga, sin pintar nada.
 */
async function idasDeAbrir(): Promise<{ idas: number; sesiones: number; escrituras: number }> {
  sembrar(ESCENARIOS[2], false)
  await recalcularTotales(COT_SAN_ANDRES)
  tomarRegistro()
  sesion.n = 0
  const { default: Pagina } = await import('./[id]/cotizacion/[cotId]/page')
  const jsx = await Pagina({ params: Promise.resolve({ id: NEG_SAN_ANDRES, cotId: COT_SAN_ANDRES }) })
  expect(jsx).toBeTruthy()
  const registro = tomarRegistro()
  return { idas: registro.length, sesiones: sesion.n, escrituras: escrituras(registro).length }
}

// ── El fixture ───────────────────────────────────────────────────────────────

const RUTA_FIXTURE = path.join(__dirname, 'igualdad-servidor.fixture.json')
const GRABAR = process.env.GRABAR_IGUALDAD === '1'

interface Fixture {
  _grabado: { commit: string; fecha: string; como: string; regla: string }
  salidas: Record<string, Salida>
  presupuesto: Record<string, number>
}

const corridas: Record<string, { apagado: Awaited<ReturnType<typeof correr>>; encendido: Awaited<ReturnType<typeof correr>> }> = {}
let idasElegir = 0
let aceptarUno = { idas: 0, sesiones: 0 }
let abrir = { idas: 0, sesiones: 0, escrituras: 0 }
let porPasos = { elegir: 0, deshacer: 0 }
let lote = { idas: 0, sesiones: 0 }

beforeAll(async () => {
  // El reloj fijo: las fechas que el servidor escribe (aprobación, registro) no pueden variar.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-12T15:00:00.000Z') })
  for (const e of ESCENARIOS) {
    corridas[e.nombre] = { apagado: await correr(e, false), encendido: await correr(e, true) }
  }
  idasElegir = await idasDeElegirOpcion()
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'secreto-de-prueba')
  aceptarUno = await idasDeAceptarUno()
  abrir = await idasDeAbrir()
  porPasos = await idasDeDeshacer()
  lote = await idasDeAceptarLote()
}, 120_000)

afterAll(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function presupuestoMedido(): Record<string, number> {
  const p: Record<string, number> = {}
  for (const e of ESCENARIOS) {
    const { idas } = corridas[e.nombre].apagado
    p[`${e.nombre} · recalcular`] = idas.recalcular
    p[`${e.nombre} · pdf`] = idas.pdf
    p[`${e.nombre} · aprobar`] = idas.aprobar
  }
  p['trappvel-caso-fijo · elegir opción en una tarifa'] = idasElegir
  p['trappvel-caso-fijo · aceptar 1 (ruta)'] = aceptarUno.idas
  p['trappvel-caso-fijo · abrir la cotización'] = abrir.idas
  // La sesión también cuesta idas en producción (perfil y workspace): se cuenta aparte.
  p['trappvel-caso-fijo · aceptar 1 (ruta) · sesiones'] = aceptarUno.sesiones
  p['trappvel-caso-fijo · abrir la cotización · sesiones'] = abrir.sesiones
  // N7 («abrir no escribe») se exige desde C1; aquí queda la línea base.
  p['trappvel-caso-fijo · abrir la cotización · escrituras'] = abrir.escrituras
  // C4 · la forma por pasos: elegir la opción de una tarifa y deshacerlo.
  p['trappvel-por-pasos · elegir opción en una tarifa'] = porPasos.elegir
  p['trappvel-por-pasos · deshacer'] = porPasos.deshacer
  // C5 · «Aceptar los 11 en lote», con un solo recálculo (V4).
  p['trappvel-por-pasos · aceptar 11 en lote'] = lote.idas
  p['trappvel-por-pasos · aceptar 11 en lote · sesiones'] = lote.sesiones
  for (const e of ESCENARIOS) {
    const { sesiones } = corridas[e.nombre].apagado
    p[`${e.nombre} · recalcular · sesiones`] = sesiones.recalcular
    p[`${e.nombre} · pdf · sesiones`] = sesiones.pdf
    p[`${e.nombre} · aprobar · sesiones`] = sesiones.aprobar
  }
  return p
}

/**
 * Con GRABAR_IGUALDAD=1 y el fixture ya grabado, solo se AGREGAN escenarios o claves del
 * presupuesto que no estaban. Lo que ya está grabado no se toca nunca.
 */
function agregarLoQueFalta(f: Fixture): Fixture {
  if (!GRABAR) return f
  let cambio = false
  for (const e of ESCENARIOS) {
    if (!f.salidas[e.nombre]) { f.salidas[e.nombre] = corridas[e.nombre].apagado.salida; cambio = true }
  }
  for (const [k, v] of Object.entries(presupuestoMedido())) {
    if (!(k in f.presupuesto)) { f.presupuesto[k] = v; cambio = true }
  }
  if (cambio) writeFileSync(RUTA_FIXTURE, `${JSON.stringify(f, null, 1)}\n`)
  return f
}

function leerFixture(): Fixture {
  if (!existsSync(RUTA_FIXTURE)) {
    if (!GRABAR) throw new Error(`Falta ${RUTA_FIXTURE}. Se graba UNA vez sobre origin/main con GRABAR_IGUALDAD=1.`)
    const nuevo: Fixture = {
      _grabado: {
        commit: process.env.GRABAR_IGUALDAD_COMMIT ?? 'desconocido',
        fecha: '2026-10-12',
        como: 'GRABAR_IGUALDAD=1 npx vitest run igualdad-servidor, sobre origin/main sin cambios de código',
        regla: 'No se regenera para que una prueba pase. Si un PR lo cambia, el PR no entra (regla 3 de Vera).',
      },
      salidas: Object.fromEntries(ESCENARIOS.map(e => [e.nombre, corridas[e.nombre].apagado.salida])),
      presupuesto: presupuestoMedido(),
    }
    writeFileSync(RUTA_FIXTURE, `${JSON.stringify(nuevo, null, 1)}\n`)
  }
  return agregarLoQueFalta(JSON.parse(readFileSync(RUTA_FIXTURE, 'utf8')) as Fixture)
}

// ── Las pruebas ──────────────────────────────────────────────────────────────

describe('C0 · el caso fijo es el de los criterios', () => {
  it('8 servicios, 3 con opciones, y la Recomendada cuesta $19.081.590', () => {
    const t = tablasCasoSanAndres()
    const items = t.items
    expect(items).toHaveLength(11)
    expect(new Set(items.map(i => i.grupo)).size).toBe(8)
    const conOpciones = [...new Set(items.map(i => i.grupo))].filter(g => items.filter(i => i.grupo === g).length > 1)
    expect(conOpciones).toEqual(['hotel: Hotel en Providencia', 'hotel 2: Hotel en San Andrés', 'actividad: Cayo Cangrejo'])
    // La Recomendada: la primera pegada de cada servicio.
    const primera = new Map<string, Fila>()
    for (const i of [...items].sort((a, b) => Number(a.orden) - Number(b.orden))) if (!primera.has(i.grupo as string)) primera.set(i.grupo as string, i)
    const costo = [...primera.values()].reduce((a, i) => a + Number(i.subtotal), 0)
    expect(costo).toBe(COSTO_RECOMENDADA)
    expect(COMPOSICION).toEqual({ adultos: 6, ninos: 1, infantes: 1 })
    expect(FECHAS).toEqual({ inicio: '2026-11-23', fin: '2026-11-28' })
  })
})

describe('C0 · igualdad del servidor contra origin/main (N1, N2)', () => {
  for (const e of ESCENARIOS) {
    describe(e.nombre, () => {
      it('recalcularTotales escribe lo mismo y deja el mismo total', () => {
        expect(corridas[e.nombre].apagado.salida.recalculo).toEqual(leerFixture().salidas[e.nombre].recalculo)
      })
      it('el precio de cada tarifa es el mismo', () => {
        expect(corridas[e.nombre].apagado.salida.tarifas).toEqual(leerFixture().salidas[e.nombre].tarifas)
      })
      it('la plantilla del PDF recibe las mismas props, y la acción escribe y devuelve lo mismo', () => {
        expect(corridas[e.nombre].apagado.salida.pdf).toEqual(leerFixture().salidas[e.nombre].pdf)
      })
      it('aprobar fija el mismo precio_aprobado con las mismas escrituras', () => {
        expect(corridas[e.nombre].apagado.salida.aprobacion).toEqual(leerFixture().salidas[e.nombre].aprobacion)
      })
      it('con el interruptor encendido, exactamente lo mismo', () => {
        // Termotech y la genérica no tienen el interruptor: la segunda corrida es la misma
        // cotización y tiene que dar lo mismo (determinismo de la prueba).
        expect(corridas[e.nombre].encendido.salida).toEqual(corridas[e.nombre].apagado.salida)
        expect(corridas[e.nombre].encendido.idas).toEqual(corridas[e.nombre].apagado.idas)
      })
    })
  }

  it('las cifras que el fixture fija son las que dicen los criterios', () => {
    const fijo = leerFixture().salidas['trappvel-caso-fijo']
    const tarifas = (fijo.tarifas as { tarifas: { nombre: string; precio: number }[] }).tarifas
    // Económica = Recomendada: no se manda (decisión C), y por eso no se ofrece al aprobar.
    expect(tarifas.map(t => t.nombre)).toEqual(['Recomendada', 'Premium'])
    const recomendada = tarifas.find(t => t.nombre === 'Recomendada')!.precio
    const premium = tarifas.find(t => t.nombre === 'Premium')!.precio
    // El total del documento es el de la Recomendada, y lo aprobado es la Premium elegida.
    expect((fijo.recalculo as { cotizacion: { valor_total: number; costo_total: number } }).cotizacion).toMatchObject({
      valor_total: recomendada,
      costo_total: COSTO_RECOMENDADA,
    })
    expect((fijo.aprobacion as { precio_aprobado: number }).precio_aprobado).toBe(premium)
  })
})

describe('C0 · lo que hace hoy el servidor con la Recomendada (riesgo R1, COT-2026-0025)', () => {
  it('si elige otra opción que la primera pegada, el total es el suyo y no el supuesto', () => {
    const s = corridas['trappvel-recomendada-otro-hotel'].apagado.salida
    const rec = (s.tarifas as { tarifas: { nombre: string; precio: number }[] }).tarifas.find(t => t.nombre === 'Recomendada')!
    const base = corridas['trappvel-caso-fijo'].apagado.salida.recalculo as { cotizacion: { valor_total: number } }
    expect((s.recalculo as { cotizacion: { valor_total: number } }).cotizacion.valor_total).toBe(rec.precio)
    expect(rec.precio).not.toBe(base.cotizacion.valor_total)
  })

  it('si nombra DOS opciones de la misma ranura, el recálculo escribe el total con las dos y LUEGO la saca de la propuesta', () => {
    const s = corridas['trappvel-recomendada-dos-hoteles'].apagado.salida
    const r = s.recalculo as { resultado: { valorVenta: number; desmarcados: { nombre: string; motivo: string }[] }; cotizacion: { costo_total: number } }
    // Costo con Verde Mar Y Lord Pierre: el de la Recomendada base más $6.420.000.
    expect(r.cotizacion.costo_total).toBe(COSTO_RECOMENDADA + 6_420_000)
    expect(r.resultado.desmarcados.map(d => d.nombre)).toEqual(['Recomendada'])
    // Desde ahí la Recomendada no va: no se aprueba ni se envía, y el PDF sale borrador.
    expect((s.aprobacion as { resultado: { success: boolean } }).resultado.success).toBe(false)
    expect((s.pdf as { resultado: { borrador?: boolean } }).resultado.borrador).toBe(true)
  })
})

describe('C0 · presupuesto de idas a la base por acción (V5)', () => {
  it('ninguna acción hace más idas que en la línea base', () => {
    const fijado = leerFixture().presupuesto
    const medido = presupuestoMedido()
    expect(Object.keys(medido).sort()).toEqual(Object.keys(fijado).sort())
    for (const [accion, n] of Object.entries(medido)) {
      expect(n, `«${accion}» hace ${n} idas a la base y la línea base es ${fijado[accion]}`).toBeLessThanOrEqual(fijado[accion])
    }
  })
})
