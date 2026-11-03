/**
 * `generarFormularioCore` con plantilla editable: el MISMO camino de siempre (datos de
 * `campos_fuente`, overrides, faltantes, versión del bloque, subida) y solo cambia el render.
 *
 *   · sin versión activa → el componente @react-pdf de hoy (ningún otro workspace cambia);
 *   · con versión activa → Chromium con ese texto y los datos ya resueltos (overrides incluidos),
 *     y el bloque recuerda qué versión imprimió;
 *   · una activa de OTRO workspace no cuenta;
 *   · si Chromium falla, no se cae al formato viejo ni se deja versión ni archivo.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'

type Fila = Record<string, unknown>

const WS = '7dea141d-d4da-483d-a78d-b14ef35500c5'
const OTRO_WS = '00000000-0000-4000-8000-0000000000aa'
const NEG = '3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const LINEA = 'linea-ve'
const DJ_FILA = '11111111-2222-4333-8444-555555555555'
const FACTURA_FILA = '22222222-2222-4333-8444-555555555555'
const VERSION = '33333333-2222-4333-8444-555555555555'

const escenario: { tablas: Record<string, Fila[]> } = { tablas: {} }
const efectos = {
  react: 0,
  chromium: [] as Array<{ tipo: string; contenido: string; datos: Record<string, unknown> }>,
  chromiumFalla: false,
  subidos: [] as string[],
}

function valorEnRuta(f: Fila, columna: string): unknown {
  let v: unknown = f
  for (const k of columna.split('.')) v = v && typeof v === 'object' ? (v as Fila)[k] : undefined
  return v
}

function consulta(tabla: string) {
  const eqs: Fila = {}
  let payload: Fila | null = null
  let insercion: Fila | null = null
  let tope: number | null = null
  const filtradas = () => {
    const fs = (escenario.tablas[tabla] ?? []).filter((f) => Object.entries(eqs).every(([c, v]) => valorEnRuta(f, c) === v))
    return tope == null ? fs : fs.slice(0, tope)
  }
  const copia = (f: Fila | undefined) => (f ? structuredClone(f) : null)
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => { eqs[c] = v; return q },
    in: () => q,
    order: () => q,
    limit: (n: number) => { tope = n; return q },
    update: (p: Fila) => { payload = p; return q },
    insert: (p: Fila) => { insercion = p; return q },
    maybeSingle: async () => ({ data: copia(filtradas()[0]), error: null }),
    single: async () => ({ data: copia(filtradas()[0]), error: null }),
    then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => {
      if (insercion) {
        ;(escenario.tablas[tabla] ??= []).push(structuredClone(insercion))
        return Promise.resolve({ data: null, error: null }).then(ok, ko)
      }
      if (payload) {
        for (const f of filtradas()) Object.assign(f, structuredClone(payload))
        return Promise.resolve({ data: null, error: null }).then(ok, ko)
      }
      return Promise.resolve({ data: filtradas().map((f) => copia(f)), error: null }).then(ok, ko)
    },
  }
  return q
}
const cliente = () => ({ from: (t: string) => consulta(t) })

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => cliente() }))
vi.mock('@/lib/negocios/disputa-generacion', () => ({ generacionNegadaPorDisputa: async () => null }))
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({
  almacenamientoExternoDe: async () => ({
    subirArchivo: async ({ buffer }: { buffer: Buffer }) => {
      efectos.subidos.push(buffer.toString())
      return { referencia: `ext://${efectos.subidos.length}` }
    },
  }),
}))
vi.mock('@react-pdf/renderer', async (orig) => ({
  ...(await orig<typeof import('@react-pdf/renderer')>()),
  renderToBuffer: async () => { efectos.react++; return Buffer.from('%PDF-react') },
}))
vi.mock('@/lib/plantillas-documento/imprimir', () => ({
  imprimirPlantilla: async (tipo: string, contenido: string, datos: Record<string, unknown>) => {
    efectos.chromium.push({ tipo, contenido, datos: { ...datos } })
    if (efectos.chromiumFalla) return { ok: false, error: 'No se pudo imprimir el PDF con la plantilla editable.' }
    return { ok: true, pdf: Buffer.from('%PDF-chromium'), medidas: {} }
  },
}))

import { generarFormularioCore } from './formulario-actions'
import type { SupabaseClient } from '@supabase/supabase-js'

const CFG_DJ = {
  label: '006_DECLARACION_JURAMENTADA',
  template: 'declaracion-juramentada',
  campos_fuente: [
    { slug: 'numero_factura', source: { bloque_slug: 'factura', etapa_orden: 2, bloque_orden: 1, campo_slug: 'numero_factura', tipo: 'ai' } },
    { slug: 'valor_iva', source: { bloque_slug: 'factura', etapa_orden: 2, bloque_orden: 1, campo_slug: 'valor_iva', tipo: 'ai' } },
  ],
}

function sembrar(activa: Fila | null) {
  efectos.react = 0
  efectos.chromium = []
  efectos.chromiumFalla = false
  efectos.subidos = []
  escenario.tablas = {
    negocio_bloques: [
      {
        id: DJ_FILA, negocio_id: NEG, data: { campos_override: { numero_factura: 'FEMM-OVERRIDE' } }, bloque_config_id: 'cfg-dj',
        bloque_configs: { orden: 1, slug: 'dj', config_extra: CFG_DJ, etapa_id: 'e5', etapas_negocio: { orden: 5, linea_id: LINEA } },
      },
      {
        id: FACTURA_FILA, negocio_id: NEG, bloque_config_id: 'cfg-fac',
        data: { campos: { numero_factura: { value: 'FEMM1', confidence: 0.95 }, valor_iva: { value: '4319048', confidence: 0.95 } } },
        bloque_configs: { orden: 1, slug: 'factura', config_extra: {}, etapa_id: 'e2', etapas_negocio: { orden: 2, linea_id: LINEA } },
      },
    ],
    negocios: [{ id: NEG, codigo: 'S1 26 3', carpeta_url: null, metadata: {} }],
    workspaces: [{ id: WS, drive_folder_id: null }],
    formulario_versiones: [],
    plantillas_documento_versiones: [
      { id: VERSION, workspace_id: WS, tipo: 'declaracion-juramentada', version_n: 2, contenido: 'TEXTO DE DEISY {{numero_factura}}' },
    ],
    plantillas_documento_activas: activa ? [activa] : [],
  }
}

const generar = () => generarFormularioCore(cliente() as unknown as SupabaseClient, WS, 'user-1', DJ_FILA, NEG)
const filaDj = () => escenario.tablas.negocio_bloques.find((f) => f.id === DJ_FILA)!.data as Fila

describe('generación de la DJ con plantilla editable', () => {
  beforeEach(() => sembrar(null))

  it('sin versión activa sale el componente @react-pdf de siempre', async () => {
    const r = await generar()
    expect(r).toMatchObject({ success: true, version_n: 1 })
    expect(efectos.react).toBe(1)
    expect(efectos.chromium).toEqual([])
    expect(efectos.subidos).toEqual(['%PDF-react'])
    expect(filaDj().plantilla_version).toBeNull()
  })

  it('con versión activa sale Chromium con ese texto y los datos ya resueltos', async () => {
    sembrar({ workspace_id: WS, tipo: 'declaracion-juramentada', version_id: VERSION })
    const r = await generar()
    expect(r).toMatchObject({ success: true, version_n: 1 })
    expect(efectos.react).toBe(0)
    expect(efectos.chromium).toHaveLength(1)
    expect(efectos.chromium[0]).toMatchObject({
      tipo: 'declaracion-juramentada',
      contenido: 'TEXTO DE DEISY {{numero_factura}}',
      // El override del operador manda sobre lo extraído, igual que con @react-pdf.
      datos: { numero_factura: 'FEMM-OVERRIDE', valor_iva: '4319048' },
    })
    expect(efectos.subidos).toEqual(['%PDF-chromium'])
    expect(escenario.tablas.formulario_versiones).toHaveLength(1)
    expect(filaDj().plantilla_version).toEqual({ id: VERSION, version_n: 2 })
  })

  it('la versión activa de OTRO workspace no cuenta', async () => {
    sembrar({ workspace_id: OTRO_WS, tipo: 'declaracion-juramentada', version_id: VERSION })
    await generar()
    expect(efectos.chromium).toEqual([])
    expect(efectos.react).toBe(1)
  })

  it('si Chromium falla no cae al formato viejo, ni deja versión ni archivo', async () => {
    sembrar({ workspace_id: WS, tipo: 'declaracion-juramentada', version_id: VERSION })
    efectos.chromiumFalla = true
    const r = await generar()
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/plantilla editable/)
    expect(efectos.react).toBe(0)
    expect(efectos.subidos).toEqual([])
    expect(escenario.tablas.formulario_versiones).toEqual([])
  })

  it('un faltante obligatorio sigue bloqueando antes de imprimir', async () => {
    sembrar({ workspace_id: WS, tipo: 'declaracion-juramentada', version_id: VERSION })
    const factura = escenario.tablas.negocio_bloques.find((f) => f.id === FACTURA_FILA)!
    ;(factura.data as Fila).campos = {}
    const r = await generar()
    expect(r).toMatchObject({ success: false, faltantes: ['valor_iva'] })
    expect(efectos.chromium).toEqual([])
  })
})
