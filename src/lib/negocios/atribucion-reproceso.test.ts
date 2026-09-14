import { describe, it, expect } from 'vitest'
import { resolverAtribucionReproceso } from './atribucion-reproceso'

/**
 * Atribución de un reproceso con la forma real de V0142 (SOENA, medido el 2026-09-14):
 *
 *  - devolución DIAN por error propio, abierta el 2026-09-07 14:41:13 UTC
 *    («Está mal la relación de las facturas»);
 *  - `confirmacion_envio_a_dian` sin `completado_por` (caso migrado);
 *  - los cuatro documentos de Generación, v1, generados el 2026-08-20 por María Camila;
 *  - la relación v2 generada 5 minutos DESPUÉS de abrir el reproceso, por Deisy, que es
 *    la supervisora que lo corrigió.
 *
 * El doble APLICA los filtros (`eq`, `in`, `not is null`, `lt`, `order`, `limit`) sobre
 * rutas con punto, igual que PostgREST sobre los recursos embebidos. Un doble que
 * devolviera lo mismo para cualquier consulta haría pasar la prueba sin filtrar nada.
 * La forma de la consulta de versiones se verificó contra el PostgREST de producción el
 * mismo día: devuelve la relación v1 de María Camila.
 *
 * Vistas fallar contra `main` (sin el respaldo por versiones y sin filtro de workspace),
 * medido el 2026-09-14: caen 4 de 8 — «V0142», «versión posterior», «staff de otro
 * workspace» y «cae a quien generó los documentos».
 */

const WS = 'ws-soena'
const OTRO_WS = 'ws-metrik'
const NEG = 'neg-v0142'
const MARIA = 'prof-maria'
const DEISY = 'prof-deisy'
const MAURICIO = 'prof-mauricio'

type Fila = Record<string, unknown>

function leer(fila: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Fila)[k] : undefined), fila)
}

function doble(tablas: Record<string, Fila[]>) {
  const consultas: string[] = []
  return {
    consultas,
    from(tabla: string) {
      let filas = [...(tablas[tabla] ?? [])]
      const q = {
        select: () => q,
        eq: (ruta: string, v: unknown) => { filas = filas.filter((f) => leer(f, ruta) === v); return q },
        in: (ruta: string, vs: unknown[]) => { filas = filas.filter((f) => vs.includes(leer(f, ruta))); return q },
        not: (ruta: string, op: string, v: unknown) => {
          if (op !== 'is' || v !== null) throw new Error('filtro no soportado por el doble')
          filas = filas.filter((f) => leer(f, ruta) != null)
          return q
        },
        lt: (ruta: string, v: string) => { filas = filas.filter((f) => String(leer(f, ruta)) < v); return q },
        order: (ruta: string, o: { ascending: boolean }) => {
          filas.sort((a, b) => {
            const x = String(leer(a, ruta)), y = String(leer(b, ruta))
            return o.ascending ? x.localeCompare(y) : y.localeCompare(x)
          })
          return q
        },
        limit: (n: number) => { filas = filas.slice(0, n); return q },
        maybeSingle: async () => ({ data: filas[0] ?? null, error: null }),
        then: (res: (v: { data: Fila[]; error: null }) => unknown) => {
          consultas.push(tabla)
          return Promise.resolve({ data: filas, error: null }).then(res)
        },
      }
      return q
    },
  }
}

const bloque = (slug: string, completado_por: string | null, completado_at: string | null = null) => ({
  negocio_id: NEG,
  completado_por,
  completado_at,
  bloque_configs: { slug },
})

const version = (slug: string, generated_by: string, generated_at: string, workspace_id = WS) => ({
  workspace_id,
  generated_by,
  generated_at,
  negocio_bloques: { negocio_id: NEG, bloque_configs: { slug } },
})

const STAFF = [
  { id: 'staff-maria', profile_id: MARIA, workspace_id: WS },
  { id: 'staff-deisy', profile_id: DEISY, workspace_id: WS },
  { id: 'staff-mauricio', profile_id: MAURICIO, workspace_id: OTRO_WS },
]

const V0142 = {
  negocio_bloques: [bloque('confirmacion_envio_a_dian', null)],
  formulario_versiones: [
    version('formulario_dian', MARIA, '2026-08-20T04:29:18.169Z'),
    version('declaracion_juramentada', MARIA, '2026-08-20T04:30:18.782Z'),
    version('formulario_1668', MARIA, '2026-08-20T04:35:01.858Z'),
    version('relacion_de_facturas', MARIA, '2026-08-20T04:35:31.383Z'),
    version('relacion_de_facturas', DEISY, '2026-09-07T14:46:46.154Z'),
  ],
  staff: STAFF,
}
const ABIERTO = '2026-09-07T14:41:13.225Z'

describe('resolverAtribucionReproceso', () => {
  it('V0142: sin completado_por, responde quien generó los documentos del tramo', async () => {
    const r = await resolverAtribucionReproceso(doble(V0142), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBe('staff-maria')
  })

  it('versión posterior al reproceso: la que CORRIGE el error no se lleva la culpa', async () => {
    // Sin `antesDe` ganaría Deisy, la supervisora que regeneró la relación: el indicador al revés.
    const conCorte = await resolverAtribucionReproceso(doble(V0142), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    const sinCorte = await resolverAtribucionReproceso(doble(V0142), NEG, 'devolucion_dian', { workspaceId: WS })
    expect(conCorte).toBe('staff-maria')
    expect(sinCorte).toBe('staff-deisy')
  })

  it('con completado_por en el bloque del tramo, manda ese (no mira versiones)', async () => {
    const datos = { ...V0142, negocio_bloques: [bloque('confirmacion_envio_a_dian', DEISY, '2026-08-30T00:00:00Z')] }
    const r = await resolverAtribucionReproceso(doble(datos), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBe('staff-deisy')
  })

  it('staff de otro workspace: no se presta (staff.profile_id es único global)', async () => {
    // El bloque lo cerró el platform_admin operando en SOENA; su staff vive en MeTRIK.
    const datos = {
      ...V0142,
      negocio_bloques: [bloque('confirmacion_envio_a_dian', MAURICIO, '2026-08-30T00:00:00Z')],
      formulario_versiones: [],
    }
    const r = await resolverAtribucionReproceso(doble(datos), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBeNull()
  })

  it('y en ese caso cae a quien generó los documentos, que sí es de aquí', async () => {
    const datos = { ...V0142, negocio_bloques: [bloque('confirmacion_envio_a_dian', MAURICIO, '2026-08-30T00:00:00Z')] }
    const r = await resolverAtribucionReproceso(doble(datos), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBe('staff-maria')
  })

  it('las copias de Envío no cuentan como trabajo del tramo', async () => {
    const datos = { ...V0142, formulario_versiones: [version('formulario_dian_envio', DEISY, '2026-08-25T00:00:00Z')] }
    const r = await resolverAtribucionReproceso(doble(datos), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBeNull()
  })

  it('certificación UPME no tiene documentos generados: sin autor, sin atribuir', async () => {
    const datos = { ...V0142, negocio_bloques: [bloque('radicado_de_certificacion', null)] }
    const r = await resolverAtribucionReproceso(doble(datos), NEG, 'certificacion_upme', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBeNull()
  })

  it('sin nada que atribuir, null (no se le cuelga a nadie por descarte)', async () => {
    const datos = { negocio_bloques: [], formulario_versiones: [], staff: STAFF }
    const r = await resolverAtribucionReproceso(doble(datos), NEG, 'devolucion_dian', { workspaceId: WS, antesDe: ABIERTO })
    expect(r).toBeNull()
  })
})
