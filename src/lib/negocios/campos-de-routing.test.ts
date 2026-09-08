import { describe, it, expect, vi } from 'vitest'
import { camposDeRouting, bloqueDesactivado, type BloqueParaRouting } from './campos-de-routing'
import { destinoDeRouting, decisionesSinResponder, type RoutingEtapa } from './dato-de-decision'

// ── Fixtures copiados de producción el 2026-09-08 ────────────────────────────────────────
// SOENA, línea GIT EV/HEV. Si algún día estas pruebas cambian de veredicto, lo primero que
// hay que mirar es si la configuración de la etapa se movió, no el helper.

/** `etapas_negocio` orden 11 (Cartera). Lee el campo desde Documentación (orden 6). */
const ROUTING_CARTERA: RoutingEtapa = {
  conditional: [
    { condition: { field: 'requiere_cita_dian', value: 'true' }, etapa_orden: 16 },  // Cita
    { condition: { field: 'requiere_cita_dian', value: 'false' }, etapa_orden: 18 }, // Anexos
  ],
  source_etapa_orden: 6,
  default_etapa_orden: 12, // Entrega
}

/** `bloque_configs.config_extra.condition` del bloque `cita_dian_requerida`. */
const CONDICION_SOLO_IVA = {
  field: 'servicio',
  value: 'solo_iva',
  source_bloque_slug: 'servicio_contratado',
  source_etapa_orden: 4,
}

/** `negocio_bloques.data` de V0431 en `cita_dian_requerida`, sembrado por el cargue. */
const DATA_V0431 = { _migrado: true, seccional_display: null, requiere_cita_dian: false }

const bloqueCitaDian = (data: unknown, extra: Record<string, unknown> = {}): BloqueParaRouting => ({
  data,
  tipo: 'datos',
  config_extra: { condition: CONDICION_SOLO_IVA, ...extra },
})

const nunca = vi.fn(async () => {
  throw new Error('no se debería evaluar ninguna condición')
})

describe('camposDeRouting', () => {
  it('descarta el bloque cuyo `condition` no se cumple, aunque traiga valor (V0431)', async () => {
    const campos = await camposDeRouting([bloqueCitaDian(DATA_V0431)], async () => false)

    // El valor huérfano no existe para el motor: ni la llave queda.
    expect(campos).not.toHaveProperty('requiere_cita_dian')
    // Y el routing cae al default, que es Entrega (12) — no Anexos (18).
    expect(destinoDeRouting(ROUTING_CARTERA, campos)).toBe(12)
  })

  it('conserva el valor cuando el `condition` SÍ se cumple (el caso solo_iva)', async () => {
    const campos = await camposDeRouting(
      [bloqueCitaDian({ ...DATA_V0431, requiere_cita_dian: true })],
      async () => true,
    )

    expect(campos.requiere_cita_dian).toBe(true)
    expect(destinoDeRouting(ROUTING_CARTERA, campos)).toBe(16) // Cita
  })

  it('la rama `false` sigue decidiendo cuando el bloque aplica', async () => {
    const campos = await camposDeRouting([bloqueCitaDian(DATA_V0431)], async () => true)

    expect(campos.requiere_cita_dian).toBe(false)
    expect(destinoDeRouting(ROUTING_CARTERA, campos)).toBe(18) // Anexos
  })

  it('descarta el bloque `desactivado: true` aunque traiga valor y sin evaluar condición', async () => {
    const campos = await camposDeRouting(
      [{ data: { requiere_cita_dian: true }, tipo: 'datos', config_extra: { desactivado: true } }],
      nunca,
    )

    expect(campos).toEqual({})
    expect(destinoDeRouting(ROUTING_CARTERA, campos)).toBe(12)
    expect(nunca).not.toHaveBeenCalled()
  })

  it('un bloque SIN `condition` queda intacto y no gasta una llamada', async () => {
    const campos = await camposDeRouting(
      [{ data: { cargado_upme: 'no', otro: 1 }, tipo: 'datos', config_extra: {} }],
      nunca,
    )

    expect(campos).toEqual({ cargado_upme: 'no', otro: 1 })
    expect(nunca).not.toHaveBeenCalled()
  })

  it('solo los bloques `datos` alimentan el routing', async () => {
    const campos = await camposDeRouting(
      [
        { data: { drive_url: 'x', campos: { marca: 'TOYOTA' } }, tipo: 'documento', config_extra: {} },
        { data: { requiere_cita_dian: true }, tipo: 'datos', config_extra: {} },
      ],
      nunca,
    )

    expect(campos).toEqual({ requiere_cita_dian: true })
  })

  it('el bloque que no aplica no tapa el valor del que sí, sin importar el orden', async () => {
    const aplica: BloqueParaRouting = {
      data: { requiere_cita_dian: true },
      tipo: 'datos',
      config_extra: {},
    }
    const noAplica = bloqueCitaDian({ requiere_cita_dian: false })
    const evaluar = async (c: Record<string, unknown>) => c !== CONDICION_SOLO_IVA

    expect((await camposDeRouting([aplica, noAplica], evaluar)).requiere_cita_dian).toBe(true)
    expect((await camposDeRouting([noAplica, aplica], evaluar)).requiere_cita_dian).toBe(true)
  })

  it('evalúa UNA vez por condición, no una por bloque ni una por campo', async () => {
    const evaluar = vi.fn(async () => true)
    await camposDeRouting(
      [bloqueCitaDian({ a: 1 }), bloqueCitaDian({ b: 2 }), bloqueCitaDian({ c: 3 })],
      evaluar,
    )

    expect(evaluar).toHaveBeenCalledTimes(1)
  })

  it('una condición que no se puede evaluar descarta el bloque (misma convención que el gate)', async () => {
    // `camposDecisionDelNegocio` deja `aplica = false` cuando la RPC falla. Si aquí el valor
    // sobreviviera, el gate no exigiría el dato y el routing sí lo usaría: el desacople que
    // este helper existe para evitar.
    const campos = await camposDeRouting([bloqueCitaDian(DATA_V0431)], async () => false)
    const decision = [{ campo: 'requiere_cita_dian', aplica: false }]

    expect(decisionesSinResponder(decision, campos)).toEqual([])
    expect(destinoDeRouting(ROUTING_CARTERA, campos)).toBe(12)
  })

  it('ignora `data` que no es un objeto plano', async () => {
    const campos = await camposDeRouting(
      [
        { data: null, tipo: 'datos', config_extra: {} },
        { data: ['x'], tipo: 'datos', config_extra: {} },
        { data: { ok: 1 }, tipo: 'datos', config_extra: {} },
      ],
      nunca,
    )

    expect(campos).toEqual({ ok: 1 })
  })
})

describe('coherencia gate ↔ routing', () => {
  it('el gate y el conditional ven el MISMO mapa: si no aplica, ni se exige ni decide', async () => {
    const campos = await camposDeRouting([bloqueCitaDian(DATA_V0431)], async () => false)

    // El gate no lo exige (el bloque no aplica: no hay dónde responder).
    expect(decisionesSinResponder([{ campo: 'requiere_cita_dian', aplica: false }], campos)).toEqual([])
    // Y el routing tampoco lo usa. Antes del arreglo esto daba 18 (Anexos).
    expect(destinoDeRouting(ROUTING_CARTERA, campos)).toBe(12)
  })

  it('si el bloque aplica y el dato falta, el gate frena antes de que el default decida', async () => {
    const campos = await camposDeRouting([bloqueCitaDian({ seccional_display: null })], async () => true)

    expect(decisionesSinResponder([{ campo: 'requiere_cita_dian', aplica: true }], campos))
      .toEqual([{ campo: 'requiere_cita_dian', aplica: true }])
  })
})

describe('bloqueDesactivado', () => {
  it('solo el booleano `true` desactiva', () => {
    expect(bloqueDesactivado({ desactivado: true })).toBe(true)
    expect(bloqueDesactivado({ desactivado: 'true' })).toBe(false)
    expect(bloqueDesactivado({})).toBe(false)
    expect(bloqueDesactivado(null)).toBe(false)
    expect(bloqueDesactivado(undefined)).toBe(false)
  })
})
