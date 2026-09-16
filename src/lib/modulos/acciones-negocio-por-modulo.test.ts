/**
 * Las acciones de bloques y etapas de un negocio piden Clarity, y la planilla PILA pide cobros
 * recurrentes.
 *
 * El hueco (riesgo 11, cuarta ronda): la tercera ronda cerró CREAR negocios, gastos y horas,
 * pero no lo que se hace dentro de un negocio. Con la sesión de un workspace sin Clarity (4D
 * SOFT, solo `valida_api`) se llegaba a:
 *   - los tres guards de `guard-negocio.ts`, que son la puerta de la extracción con Gemini, de
 *     los formularios y propuestas que suben a Drive con las credenciales de MeTRIK y del
 *     almacenamiento externo;
 *   - la subida de documentos de `ve-documentos-negocio.ts`, donde el rol de corrección abría
 *     aunque el guard dijera que no;
 *   - la lectura de pantallazos con Gemini;
 *   - los cambios de etapa y de estado (cambiar etapa, perder, pausar, reactivar, cancelar,
 *     completar, reabrir, rehacer desde un cerrado), el reproceso y la devolución de un bloque,
 *     que escriben con el cliente de servicio;
 *   - la subida de la planilla PILA a Drive, que solo mostraba la pantalla con
 *     `cobros_recurrentes`.
 *
 * Lo que se fija: sin el módulo, cada acción responde antes de tocar la base, Storage o Gemini.
 * Con el módulo (CONTROL), pasa la puerta y llega a la base.
 *
 * Medido el 2026-09-16 por PostgREST: fuera de un workspace con Clarity solo hay 2 negocios
 * (advise, sin tocar desde el 2026-07-30 y ya fuera de su alcance por el gate de `/negocios`), y
 * `cobros_recurrentes` solo lo tiene metrik. Ninguna de estas puertas cierra algo que se use hoy.
 *
 * VISTO FALLAR (2026-09-16) contra `origin/main`: caen 21 (las 17 acciones, `esGerencial`, advise y
 * los 2 de PILA); los CONTROL siguen verdes. «No llega a Gemini» pasa en los dos lados: el ítem no
 * existe en el doble, así que vigila una regresión, no el hueco. Mutaciones: sin la puerta de
 * `ve-documentos` caen 2 (el paso por rol de corrección); sin la de `guard-negocio` caen 4.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = '64010015-a9a2-4aca-be83-e456cf217d96'
const NEGOCIO = 'a0000000-0000-4000-8000-000000000001'
const BLOQUE = 'a0000000-0000-4000-8000-000000000002'
const tocadas: string[] = []

function clienteQueRegistra() {
  const q: Record<string, unknown> = {}
  const cadena = () => q
  Object.assign(q, {
    select: cadena, eq: cadena, in: cadena, or: cadena, order: cadena, limit: cadena, is: cadena,
    not: cadena, ilike: cadena, gte: cadena, lte: cadena, neq: cadena, update: cadena, insert: cadena,
    upsert: cadena, delete: cadena,
    maybeSingle: async () => ({ data: null, error: null }),
    single: async () => ({ data: null, error: { message: 'sin fila en el doble' } }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok),
  })
  return {
    from: (tabla: string) => {
      tocadas.push(tabla)
      return q
    },
    rpc: async (fn: string) => {
      tocadas.push(`rpc:${fn}`)
      return { data: null, error: null }
    },
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: async () => {
          tocadas.push(`storage:${bucket}`)
          return { data: { token: 't', path: 'p' }, error: null }
        },
        upload: async () => {
          tocadas.push(`storage:${bucket}`)
          return { error: null }
        },
      }),
    },
  }
}

vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: clienteQueRegistra(),
    workspaceId: WS,
    userId: 'user-1',
    staffId: 'staff-1',
    role: 'owner',
    areas: [],
    error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteQueRegistra() }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/almacenamiento/supabase-externo', () => ({ almacenamientoExternoDe: async () => null }))
vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))

const extraerRanura = vi.fn(async () => ({ data: null, error: 'doble' }))
vi.mock('@/lib/ai/extraer-ranura', () => ({ extraerRanuraDesdeImagen: () => extraerRanura() }))
const subirADrive = vi.fn(async () => ({ fileId: 'f', webViewLink: 'l' }))
vi.mock('@/lib/google-drive', async (original) => ({
  ...(await original<typeof import('@/lib/google-drive')>()),
  createDriveFolder: async () => 'carpeta',
  uploadFileToDrive: () => subirADrive(),
}))

import { guardEditarBloque, guardVerNegocio, guardAvanzarStage, esGerencial } from '@/lib/permissions/guard-negocio'
import {
  cambiarEtapaNegocio,
  perderNegocio,
  pausarNegocio,
  reactivarNegocio,
  cancelarNegocio,
  completarNegocio,
} from '@/app/(app)/negocios/negocio-v2-actions'
import { reprocesarNegocio, registrarErrorSinDevolver, cerrarReproceso } from '@/lib/actions/reproceso-actions'
import { devolverBloque } from '@/lib/actions/devolucion-actions'
import { reabrirNegocio, crearNegocioDesdeCerrado } from '@/lib/actions/reapertura'
import { leerPantallazoDeItem } from '@/app/(app)/negocios/pantallazo-actions'
import { leerCasillaDeItem } from '@/app/(app)/negocios/tarifa-pax-actions'
import { getUploadUrlDocumentoNegocio } from '@/lib/actions/ve-documentos-negocio'
import { uploadPlanillaPila } from '@/app/(app)/mi-negocio/pila-actions'
import { MODULES, reiniciarModulo } from '../../../test/exigir-modulo-doble'

const MENSAJE = 'Este espacio no tiene activo el módulo que usa esta acción.'
const PNG = 'data:image/png;base64,iVBORw0KGgo='
const REPROCESO = { tipo: 'certificacion_upme', causa: 'error_propio', detalle: 'el radicado salió mal' } as const

function planilla(): FormData {
  const fd = new FormData()
  fd.set('anio', '2026')
  fd.set('mes', '8')
  fd.set('file', new File([new Uint8Array([37, 80, 68, 70])], 'pila.pdf', { type: 'application/pdf' }))
  return fd
}

/** Cada acción con su llamada y lo que devuelve al rechazar. */
const ACCIONES: Array<{ nombre: string; llamar: () => Promise<unknown>; error: (r: unknown) => unknown }> = [
  { nombre: 'guardEditarBloque', llamar: () => guardEditarBloque(BLOQUE), error: (r) => (r as { error?: string }).error },
  { nombre: 'guardVerNegocio', llamar: () => guardVerNegocio(NEGOCIO), error: (r) => (r as { error?: string }).error },
  { nombre: 'guardAvanzarStage', llamar: () => guardAvanzarStage(NEGOCIO, 'ejecucion'), error: (r) => (r as { error?: string }).error },
  { nombre: 'cambiarEtapaNegocio', llamar: () => cambiarEtapaNegocio(NEGOCIO, 'etapa-1'), error: (r) => (r as { error?: string }).error },
  { nombre: 'perderNegocio', llamar: () => perderNegocio(NEGOCIO, 'precio'), error: (r) => (r as { error?: string }).error },
  { nombre: 'pausarNegocio', llamar: () => pausarNegocio(NEGOCIO, 'cliente', '2026-10-01'), error: (r) => (r as { error?: string }).error },
  { nombre: 'reactivarNegocio', llamar: () => reactivarNegocio(NEGOCIO), error: (r) => (r as { error?: string }).error },
  { nombre: 'cancelarNegocio', llamar: () => cancelarNegocio(NEGOCIO, 'cliente', 'el cliente desistió del trámite'), error: (r) => (r as { error?: string }).error },
  { nombre: 'completarNegocio', llamar: () => completarNegocio(NEGOCIO), error: (r) => (r as { error?: string }).error },
  { nombre: 'reprocesarNegocio', llamar: () => reprocesarNegocio(NEGOCIO, REPROCESO), error: (r) => (r as { error?: string }).error },
  { nombre: 'registrarErrorSinDevolver', llamar: () => registrarErrorSinDevolver(NEGOCIO, REPROCESO), error: (r) => (r as { error?: string }).error },
  { nombre: 'cerrarReproceso', llamar: () => cerrarReproceso(NEGOCIO), error: (r) => (r as { error?: string }).error },
  { nombre: 'devolverBloque', llamar: () => devolverBloque(BLOQUE, { motivo: 'ilegible' }), error: (r) => (r as { error?: string }).error },
  { nombre: 'reabrirNegocio', llamar: () => reabrirNegocio(NEGOCIO), error: (r) => (r as { error?: string }).error },
  { nombre: 'crearNegocioDesdeCerrado', llamar: () => crearNegocioDesdeCerrado(NEGOCIO), error: (r) => (r as { error?: string }).error },
  { nombre: 'leerPantallazoDeItem', llamar: () => leerPantallazoDeItem('item-1', PNG), error: (r) => (r as { motivo?: string }).motivo },
  { nombre: 'leerCasillaDeItem', llamar: () => leerCasillaDeItem('item-1', 'grupo_completo', PNG), error: (r) => (r as { mensaje?: string }).mensaje },
  { nombre: 'getUploadUrlDocumentoNegocio', llamar: () => getUploadUrlDocumentoNegocio(BLOQUE, NEGOCIO, 'rut', 'pdf'), error: (r) => (r as { error?: string }).error },
]

beforeEach(() => {
  tocadas.length = 0
  extraerRanura.mockClear()
  subirADrive.mockClear()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('4D SOFT (solo valida_api) no opera bloques ni etapas', () => {
  beforeEach(() => reiniciarModulo(WS, { ...MODULES.cuatroDSoft }))

  for (const a of ACCIONES) {
    it(`${a.nombre} responde sin tocar la base ni Storage`, async () => {
      const r = await a.llamar()
      expect(a.error(r)).toBe(MENSAJE)
      expect(tocadas).toEqual([])
    })
  }

  it('esGerencial no le reconoce al owner poderes de corrección fuera de Clarity', async () => {
    expect(await esGerencial()).toBe(false)
  })

  it('leerPantallazoDeItem no llega a Gemini', async () => {
    await leerPantallazoDeItem('item-1', PNG)
    expect(extraerRanura).not.toHaveBeenCalled()
  })

  it('leerCasillaDeItem (tarifa por pasajero) no llega a Gemini', async () => {
    await leerCasillaDeItem('item-1', 'grupo_completo', PNG)
    expect(extraerRanura).not.toHaveBeenCalled()
  })

  it('advise (llamadas, sin Clarity) tampoco sube documentos de negocio', async () => {
    reiniciarModulo(WS, { wa_customer_bot: true, calidad_llamadas: true, fab_registrar_cobro: true })
    const r = await getUploadUrlDocumentoNegocio(BLOQUE, NEGOCIO, 'rut', 'pdf')
    expect(r.error).toBe(MENSAJE)
    expect(tocadas).toEqual([])
  })
})

describe('Planilla PILA sin cobros recurrentes', () => {
  it('SOENA (Clarity sin cobros_recurrentes) no sube a Drive', async () => {
    reiniciarModulo(WS, { ...MODULES.soena })
    const r = await uploadPlanillaPila(planilla())
    expect(r).toEqual({ success: false, error: MENSAJE })
    expect(tocadas).toEqual([])
    expect(subirADrive).not.toHaveBeenCalled()
  })

  it('4D SOFT tampoco', async () => {
    reiniciarModulo(WS, { ...MODULES.cuatroDSoft })
    const r = await uploadPlanillaPila(planilla())
    expect(r).toEqual({ success: false, error: MENSAJE })
    expect(subirADrive).not.toHaveBeenCalled()
  })

  it('CONTROL: metrik (con cobros_recurrentes) pasa la puerta y lee su carpeta', async () => {
    reiniciarModulo(WS, { business: true, cobros_recurrentes: true })
    await uploadPlanillaPila(planilla())
    expect(tocadas).toContain('workspaces')
  })
})

describe('CONTROL: con Clarity las acciones pasan la puerta', () => {
  beforeEach(() => reiniciarModulo(WS, { ...MODULES.soena }))

  for (const a of ACCIONES) {
    it(`${a.nombre} llega a la base`, async () => {
      await a.llamar().catch(() => null)
      expect(tocadas.length).toBeGreaterThan(0)
    })
  }

  it('esGerencial reconoce al owner', async () => {
    expect(await esGerencial()).toBe(true)
  })
})
