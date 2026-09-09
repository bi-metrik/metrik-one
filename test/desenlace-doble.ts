// ============================================================
// Doble del cliente de Supabase para las pruebas del desenlace que devuelve el caso.
//
// **ESCRIBE**, como el de `redistribucion-doble.ts` y por la misma razón: la pregunta
// que se prueba es DÓNDE QUEDA el estado —qué casilla quedó `pendiente`, qué se archivó
// en `_ciclos`, qué conteo tiene la marca— y con un doble de solo lectura "no se archivó"
// y "se archivó y no se ve" son indistinguibles.
//
// Además reproduce el DEFECTO que el mecanismo cierra: las casillas de la etapa destino
// se siembran con las respuestas del ciclo anterior, que es exactamente lo que hace que
// el caso vuelva a salir por la misma rama.
//
// Vive en `test/` para que vitest no lo recoja como suite.
// ============================================================

export const WS = 'ws-soena'
export const NEGOCIO = 'neg-V0313'

export type Fila = Record<string, unknown>

export const estado: { tablas: Record<string, Fila[]> } = { tablas: {} }

export function reiniciarDoble(): void {
  estado.tablas = {}
}

export function filas(tabla: string): Fila[] {
  return estado.tablas[tabla] ?? []
}

/** Resuelve `bloque_configs.slug` separando por punto, como hace PostgREST con el join. */
function valorEn(fila: Fila, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>(
    (acc, k) => (acc == null ? undefined : (acc as Record<string, unknown>)[k]),
    fila,
  )
}

export function clienteFalso() {
  return {
    from(tabla: string) {
      const filtros: Array<(f: Fila) => boolean> = []
      let patch: Fila | null = null

      const seleccionadas = (): Fila[] =>
        (estado.tablas[tabla] ?? []).filter(f => filtros.every(p => p(f)))

      const escribir = () => {
        if (!patch) return
        for (const f of seleccionadas()) Object.assign(f, patch)
        patch = null
      }

      const chain = {
        select: () => chain,
        update: (p: Fila) => { patch = p; return chain },
        eq: (campo: string, valor: unknown) => {
          filtros.push(f => valorEn(f, campo) === valor)
          return chain
        },
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

// ─── Sembrado: el caso real de SOENA ───────────────────────────────────────
//
// Un negocio que fue por PQR (Cita → Notificación) y al que la DIAN le rechazó el PQR.
// Las tres casillas quedan como están hoy en producción: `via_solicitud = pqrs` y el
// radicado guardado, que es lo que haría que el caso volviera a salir por PQR.

export function sembrarCaso(opciones?: {
  /** Lo que respondieron en el bloque del desenlace. Sin valor, la señal no está viva. */
  resultado?: string | null
  /** `data._ciclos` ya presentes en el bloque de la señal (segundo rechazo). */
  ciclosPrevios?: unknown[]
  /** Metadata inicial del negocio: sirve para probar que la fusión conserva el resto. */
  metadata?: Record<string, unknown>
  /** Marca `conservar_en_reproceso` en el bloque de la vía (guard compartido). */
  conservarVia?: boolean
  radicado?: string
}): void {
  const o = opciones ?? {}

  estado.tablas.negocios = [
    {
      id: NEGOCIO,
      workspace_id: WS,
      codigo: 'V0313',
      metadata: o.metadata ?? {},
    },
  ]

  const data_senal: Fila = {}
  if (o.resultado !== null && o.resultado !== undefined) data_senal.resultado_pqr = o.resultado
  if (o.ciclosPrevios) data_senal._ciclos = o.ciclosPrevios

  estado.tablas.negocio_bloques = [
    {
      id: 'nb-via',
      negocio_id: NEGOCIO,
      estado: 'completo',
      completado_at: '2026-08-01T10:00:00Z',
      data: { via_solicitud: 'pqrs' },
      bloque_configs: {
        slug: 'via_solicitud_cita',
        estado: 'editable',
        es_gate: true,
        config_extra: o.conservarVia
          ? { conservar_en_reproceso: true, fields: [{ slug: 'via_solicitud', required: true }] }
          : { fields: [{ slug: 'via_solicitud', required: true }] },
      },
    },
    {
      id: 'nb-radicado',
      negocio_id: NEGOCIO,
      estado: 'completo',
      completado_at: '2026-08-01T11:00:00Z',
      data: { radicado_pqr: o.radicado ?? 'PQR-2026-0313' },
      bloque_configs: {
        slug: 'radicado_pqr',
        estado: 'editable',
        es_gate: true,
        config_extra: { fields: [{ slug: 'radicado_pqr', required: true }] },
      },
    },
    {
      id: 'nb-senal',
      negocio_id: NEGOCIO,
      estado: 'completo',
      completado_at: '2026-09-09T09:00:00Z',
      data: data_senal,
      bloque_configs: {
        slug: 'resultado_pqr',
        estado: 'editable',
        es_gate: true,
        config_extra: { fields: [{ slug: 'resultado_pqr', required: true }] },
      },
    },
    // Copia heredada readonly del radicado que vive en Notificación. El guard
    // `bloqueArchivable` la deja fuera; además tiene `slug` nulo, así que la
    // declaración por slug tampoco la alcanza. Se siembra para que la prueba lo fije.
    {
      id: 'nb-radicado-heredado',
      negocio_id: NEGOCIO,
      estado: 'completo',
      completado_at: '2026-08-01T11:00:00Z',
      data: { radicado_pqr: o.radicado ?? 'PQR-2026-0313' },
      bloque_configs: {
        slug: null,
        estado: 'visible',
        es_gate: false,
        config_extra: { source_bloque_slug: 'radicado_pqr', source_etapa_orden: 16 },
      },
    },
  ]
}

/** La etapa Notificación con el desenlace declarado, tal como iría en la config. */
export const ETAPAS_LINEA = [
  { orden: 16, config_extra: { routing: { conditional: [], default_etapa_orden: 17 } } },
  {
    orden: 17,
    config_extra: {
      routing: {
        conditional: [{ condition: { field: 'resultado_pqr', value: 'pqr_rechazado' }, etapa_orden: 16 }],
        default_etapa_orden: 18,
      },
      desenlace_retorno: [
        {
          bloque: 'resultado_pqr',
          campo: 'resultado_pqr',
          valor: 'pqr_rechazado',
          destino_orden: 16,
          marca: 'pqr_rechazos',
          chip: 'PQR rechazado',
          archivar: ['via_solicitud_cita', 'radicado_pqr'],
          referencia: { bloque: 'radicado_pqr', campo: 'radicado_pqr' },
        },
      ],
    },
  },
  { orden: 18, config_extra: {} },
]

/** La misma línea sin declarar nada: el caso de todos los demás workspaces. */
export const ETAPAS_SIN_DECLARAR = [
  { orden: 16, config_extra: { routing: { conditional: [], default_etapa_orden: 17 } } },
  { orden: 17, config_extra: { routing: { conditional: [], default_etapa_orden: 18 } } },
]

export function bloque(id: string): Fila {
  return filas('negocio_bloques').find(f => f.id === id)!
}

export function negocio(): Fila {
  return filas('negocios')[0]
}
