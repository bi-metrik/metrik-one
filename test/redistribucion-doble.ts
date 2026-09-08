// ============================================================
// Doble del cliente de Supabase para las pruebas de `redistribuirReferencia`.
//
// A diferencia del doble de la cola de facturación (`cola-facturacion-doble.ts`),
// éste **ESCRIBE**: la pregunta que se prueba es en qué negocios queda puesto el
// aviso de recaudo cambiado, y ese aviso vive en `negocios.metadata`. Un doble de
// solo lectura no podría distinguir "no se puso" de "se puso y no se ve".
//
// Vive en `test/` para que vitest no lo recoja como suite.
// ============================================================

export const WS = 'ws-soena'

export type Fila = Record<string, unknown>

export const estado: { fixtures: Record<string, Fila[]> } = { fixtures: {} }

export function reiniciarDoble(): void {
  estado.fixtures = {}
}

export function filas(tabla: string): Fila[] {
  return estado.fixtures[tabla] ?? []
}

function valorEn(fila: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]),
    fila,
  )
}

export function servicioFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      let patch: Fila | null = null
      let aInsertar: Fila | Fila[] | null = null

      const seleccionadas = (): Fila[] =>
        (estado.fixtures[tabla] ?? []).filter(f => filtros.every(p => p(f)))

      /** Aplica la escritura pendiente, si la hay. Idempotente por chain. */
      const escribir = () => {
        if (aInsertar) {
          const nuevas = Array.isArray(aInsertar) ? aInsertar : [aInsertar]
          estado.fixtures[tabla] = [...(estado.fixtures[tabla] ?? []), ...nuevas]
          aInsertar = null
          return
        }
        if (patch) {
          for (const f of seleccionadas()) Object.assign(f, patch)
          patch = null
        }
      }

      const chain = {
        select: () => chain,
        update: (p: Fila) => { patch = p; return chain },
        insert: (f: Fila | Fila[]) => { aInsertar = f; return chain },
        eq: (campo: string, valor: unknown) => {
          filtros.push(f => valorEn(f, campo) === valor)
          return chain
        },
        in: (campo: string, valores: unknown[]) => {
          const set = new Set(valores)
          filtros.push(f => set.has(valorEn(f, campo)))
          return chain
        },
        is: (campo: string, valor: unknown) => {
          filtros.push(f => (valorEn(f, campo) ?? null) === valor)
          return chain
        },
        not: (campo: string, _op: string, _valor: unknown) => {
          filtros.push(f => (valorEn(f, campo) ?? null) !== null)
          return chain
        },
        order: () => chain,
        limit: () => chain,
        single: async () => { escribir(); return { data: seleccionadas()[0] ?? null, error: null } },
        maybeSingle: async () => { escribir(); return { data: seleccionadas()[0] ?? null, error: null } },
        then: (resolve: (v: { data: Fila[] | null; error: null }) => unknown) => {
          escribir()
          return resolve({ data: seleccionadas(), error: null })
        },
      }
      return chain
    },
  }
}

// ─── Sembrado ──────────────────────────────────────────────────────────────

/**
 * El caso real: V0442 y V0443 de SOENA (ref EXT-593279, 2026-09-07).
 *
 * Honorario $637.500 + tarifa UPME $701.812 = $1.339.312 por negocio. El pago de
 * $2.713.000 entró completo en V0442 y se repartió en dos mitades de $1.356.500,
 * así que cada uno cubre su cuenta con $17.188 a favor.
 */
export const HONORARIO = 637_500
export const TARIFA = 701_812
export const PAGO = 2_713_000

export function sembrarNegocio(opciones: {
  id: string
  codigo: string
  etapa?: string
  /** `null` = negocio sin cotizar (no hay con qué medir su cuenta). */
  honorario?: number | null
  tarifa?: number
  /** Cobros del negocio que NO son de la referencia que se redistribuye. */
  otrosCobros?: Array<{ monto: number; origen?: string }>
}): void {
  const { id, codigo, etapa = 'Negociación', honorario = HONORARIO, tarifa = TARIFA } = opciones

  estado.fixtures.negocios = [
    ...(estado.fixtures.negocios ?? []),
    {
      id,
      codigo,
      workspace_id: WS,
      precio_aprobado: honorario,
      precio_estimado: null,
      metadata: {},
      etapas_negocio: { nombre: etapa },
    },
  ]

  const bloques: Fila[] = []
  if (honorario !== null) {
    bloques.push({
      negocio_id: id,
      data: { aprobado_plan: 2, aprobado_honorario: honorario, aprobado_at: '2026-09-01T00:00:00Z' },
      bloque_configs: { bloque_definitions: { tipo: 'propuesta_economica' }, config_extra: {}, slug: null },
    })
  }
  if (tarifa > 0) {
    bloques.push({
      negocio_id: id,
      data: { tarifa_confirmada: true, tarifa_upme_confirmada: tarifa },
      // La clave literal es la que manda PostgREST: el filtro real es
      // `.eq('bloque_configs.config_extra->tarifa_confirmacion->>enabled', 'true')`,
      // y el doble resuelve rutas separando por punto, no por flecha.
      bloque_configs: {
        bloque_definitions: { tipo: 'datos' },
        'config_extra->tarifa_confirmacion->>enabled': 'true',
        slug: 'confirmar_tarifa_upme',
      },
    })
  }
  estado.fixtures.negocio_bloques = [...(estado.fixtures.negocio_bloques ?? []), ...bloques]

  for (const c of opciones.otrosCobros ?? []) {
    estado.fixtures.cobros = [
      ...(estado.fixtures.cobros ?? []),
      {
        id: `cobro-otro-${id}-${Math.random().toString(36).slice(2, 8)}`,
        workspace_id: WS,
        negocio_id: id,
        monto: c.monto,
        external_ref: 'OTRA-REF',
        tipo_cobro: 'pago',
        split_json: c.origen ? { origen: c.origen } : null,
        anulado_at: null,
      },
    ]
  }
}

/** Una porción viva de la referencia que se va a redistribuir. */
export function sembrarPorcion(opciones: { cobroId: string; negocioId: string; monto: number; ref: string }): void {
  estado.fixtures.cobros = [
    ...(estado.fixtures.cobros ?? []),
    {
      id: opciones.cobroId,
      workspace_id: WS,
      negocio_id: opciones.negocioId,
      monto: opciones.monto,
      external_ref: opciones.ref,
      tipo_cobro: 'pago',
      split_json: null,
      anulado_at: null,
    },
  ]
}

/** El aviso que quedó puesto en un negocio, o `null`. */
export function avisoDe(negocioId: string): Record<string, unknown> | null {
  const neg = filas('negocios').find(n => n.id === negocioId)
  const meta = (neg?.metadata ?? {}) as Record<string, unknown>
  return (meta.recaudo_cambiado_pendiente ?? null) as Record<string, unknown> | null
}
