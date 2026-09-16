/**
 * Las cuatro etapas del motor de auditoría de llamadas piden el módulo, no solo el rol.
 *
 * El hueco (riesgo 11, cuarta ronda): el gate por ruta del middleware deja pasar todo `/api`
 * y `canViewCalidadTodos` lo tiene el owner de cualquier workspace. Con la sesión de 4D SOFT
 * (solo `valida_api`) se firmaban subidas al bucket de audio, se transcribía y auditaba con la
 * llave de Gemini de MeTRIK y se escribían llamadas en su workspace.
 *
 * Lo que se fija: sin el módulo, cada ruta responde 403 antes de tocar Storage, Gemini o la
 * base. Con el módulo (advise, CONTROL), cada ruta llega a su efecto.
 *
 * Además, `transcribir` rechaza una ruta de audio con `%2e%2e`: el control viejo
 * (`startsWith` + `includes('..')`) la dejaba pasar y `fetch` la normaliza hacia otro workspace.
 *
 * VISTO FALLAR (2026-09-16) contra `origin/main`: caen los 5 casos sin módulo y las 2 rutas con
 * `%2e%2e`; los 4 CONTROL y las 2 rutas que el control viejo ya rechazaba siguen verdes. Quitando
 * la puerta de `auditar` caen sus 2 casos.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { NextRequest } from 'next/server'
import { BLOQUES_CANONICOS } from '@/lib/calidad/motor-auditoria'

const WS = 'f95f87eb-af6b-4bc2-ba06-109a75cc0047'
const OTRO_WS = 'a21bfc88-1a60-48c3-afcd-144226aa2392'

/** Lo que las rutas le hicieron a Storage, a la base y a Gemini, en orden. */
const efectos: string[] = []

function clienteServicio() {
  const q: Record<string, unknown> = {}
  const cadena = () => q
  Object.assign(q, {
    select: cadena, eq: cadena,
    single: async () => ({ data: { id: 'llamada-1' }, error: null }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
  })
  return {
    from: (tabla: string) => ({
      insert: () => {
        efectos.push(`insert:${tabla}`)
        return q
      },
    }),
    storage: {
      from: (bucket: string) => ({
        list: async () => {
          efectos.push(`list:${bucket}`)
          return { data: [], error: null }
        },
        remove: async () => {
          efectos.push(`remove:${bucket}`)
          return { data: [], error: null }
        },
        createSignedUploadUrl: async (ruta: string) => {
          efectos.push(`firmar:${bucket}`)
          return { data: { path: ruta, token: 't' }, error: null }
        },
        download: async (ruta: string) => {
          efectos.push(`download:${ruta}`)
          return { data: new Blob(['audio'], { type: 'audio/mpeg' }), error: null }
        },
      }),
    },
  }
}

vi.mock('@/lib/actions/get-workspace', () => ({
  getWorkspace: async () => ({
    supabase: null,
    workspaceId: WS,
    userId: 'user-1',
    staffId: 'staff-1',
    role: 'owner',
    areas: [],
    error: null,
  }),
}))
vi.mock('@/lib/supabase/server', () => ({ createServiceClient: () => clienteServicio() }))
vi.mock('@/lib/modulos/exigir-modulo', async () =>
  (await import('../../../../test/exigir-modulo-doble')).dobleExigirModulo())
vi.mock('@/lib/calidad/transcribir', () => ({
  transcribirAudio: async () => {
    efectos.push('gemini:transcribir')
    return { texto: 'hola', turnos: [], ms: 1 }
  },
}))
vi.mock('@/lib/calidad/prompts', () => ({ getPromptsAuditoria: async () => ({}) }))
vi.mock('@/lib/calidad/motor-auditoria', async (original) => ({
  ...(await original<typeof import('@/lib/calidad/motor-auditoria')>()),
  auditarTranscripcion: async () => {
    efectos.push('gemini:auditar')
    return { ok: true }
  },
}))

import { MODULES, reiniciarModulo } from '../../../../test/exigir-modulo-doble'
import { POST as audioUrl } from './audio-url/route'
import { POST as transcribir } from './transcribir/route'
import { POST as auditar } from './auditar/route'
import { POST as guardar } from './guardar/route'

const ADVISE = { wa_customer_bot: true, calidad_llamadas: true, fab_registrar_cobro: true }

function peticion(cuerpo: unknown): NextRequest {
  return new Request('http://localhost/api/calidad', {
    method: 'POST',
    body: JSON.stringify(cuerpo),
  }) as unknown as NextRequest
}

const auditoria = {
  tecnica: { bloques: BLOQUES_CANONICOS.map((codigo) => ({ codigo, puntaje: 1, maximo: 2 })) },
  cumplimiento: { banderas: [] },
}

const LLAMADAS = [
  { nombre: 'audio-url', llamar: () => audioUrl(peticion({ nombreArchivo: 'x.mp3', bytes: 10 })), efecto: 'firmar:' },
  { nombre: 'transcribir', llamar: () => transcribir(peticion({ ruta: `${WS}/a.mp3` })), efecto: 'gemini:transcribir' },
  { nombre: 'auditar', llamar: () => auditar(peticion({ transcripcion: 'hola' })), efecto: 'gemini:auditar' },
  { nombre: 'guardar', llamar: () => guardar(peticion({ auditoria })), efecto: 'insert:calidad_llamadas' },
] as const

beforeEach(() => {
  efectos.length = 0
  process.env.GEMINI_API_KEY = 'llave-de-prueba'
})

describe('/api/calidad sin el módulo de llamadas', () => {
  for (const c of LLAMADAS) {
    it(`${c.nombre}: 4D SOFT recibe 403 y no toca Storage, Gemini ni la base`, async () => {
      reiniciarModulo(WS, MODULES.cuatroDSoft)
      const r = await c.llamar()
      expect(r.status).toBe(403)
      expect(efectos).toEqual([])
    })
  }

  it('SOENA (Clarity sin llamadas) tampoco audita', async () => {
    reiniciarModulo(WS, MODULES.soena)
    const r = await auditar(peticion({ transcripcion: 'hola' }))
    expect(r.status).toBe(403)
    expect(efectos).toEqual([])
  })
})

describe('/api/calidad con el módulo de llamadas (CONTROL)', () => {
  for (const c of LLAMADAS) {
    it(`${c.nombre}: advise pasa la puerta y llega a su efecto`, async () => {
      reiniciarModulo(WS, ADVISE)
      const r = await c.llamar()
      expect(r.status).toBe(200)
      expect(efectos.some((e) => e.startsWith(c.efecto))).toBe(true)
    })
  }
})

describe('/api/calidad/transcribir: la ruta del audio', () => {
  it.each([
    `${WS}/%2e%2e/${OTRO_WS}/a.mp3`,
    `${WS}/.%2E/${OTRO_WS}/a.mp3`,
    `${WS}/..\\${OTRO_WS}/a.mp3`,
    `${WS}x/a.mp3`,
  ])('rechaza %s sin descargar nada', async (ruta) => {
    reiniciarModulo(WS, ADVISE)
    const r = await transcribir(peticion({ ruta }))
    expect(r.status).toBe(404)
    expect(efectos.filter((e) => e.startsWith('download:'))).toEqual([])
  })
})
