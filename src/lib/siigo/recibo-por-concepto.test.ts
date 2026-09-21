/**
 * Un pago produce un recibo POR CONCEPTO, no uno por el total.
 *
 * EL CASO QUE IMPORTA: el cobro mixto. Un pago que cubre a la vez el honorario y la
 * tarifa UPME salía con UN recibo por el total, y ese total entraba entero a la cuenta
 * contable del tipo de comprobante configurado. La tarifa UPME es plata de terceros: no
 * es lo mismo que el honorario y no va a la misma cuenta.
 *
 * Medido en producción el 2026-09-19 sobre los 425 cobros vivos de SOENA: **63 mixtos**,
 * 317 solo honorario, 45 solo tarifa. Los 3 mixtos que ya tienen recibo se quedan como
 * están (re-emitir consume numeración y no se deshace).
 *
 * Es el tipo de comprobante (`document.id`) lo que decide a qué cuenta entra la plata:
 * la API de Siigo NO acepta la cuenta contable en el payload (el recibo `Detailed`, el
 * único que traía `items[].account.code`, fue retirado). Por eso lo único que cambia
 * entre los dos recibos es `document.id` y la observación.
 *
 * ⚠️ Los `document_id` de este archivo son EJEMPLOS. Cuál comprobante lleva cada
 * componente es configuración de la línea y lo decide Mauricio; el código no sabe ni
 * tiene por qué saber qué significa cada número.
 *
 * SE VIERON FALLAR contra la implementación anterior (un recibo por el total):
 *   - "un cobro mixto produce DOS recibos"                  → producía uno
 *   - "cada recibo sale con su propio tipo de comprobante"  → los dos con el mismo
 *   - "los dos recibos suman el monto exacto del cobro"     → un solo valor, el total
 *   - "cada componente lleva su propia clave de idempotencia" → una sola clave
 *   - "un cobro puro de tarifa sale con el comprobante de la tarifa" → con el del total
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const WS = 'ws-soena'
const NEG = 'neg-v0412'
/** Mixto: $1.000.000 = $400.000 de honorario + $600.000 de tarifa. */
const MIXTO = 'cobro-mixto'
/** Puro honorario: $400.000. */
const PURO_HONORARIO = 'cobro-honorario'
/** Puro tarifa: $600.000. */
const PURO_TARIFA = 'cobro-tarifa'

type FilaCobro = {
  id: string
  negocio_id: string | null
  monto: number | null
  fecha: string | null
  tipo_cobro: string | null
  siigo_recibo: unknown
  anulado_at: string | null
}

/** Fila de `v_cobro_valor`: el reparto canónico, que este frente CONSUME y no modifica. */
type FilaReparto = {
  cobro_id: string
  a_tramo1: number
  a_tarifa: number
  a_tramo2: number
  excedente: number
}

let cobros: Record<string, FilaCobro>
let reparto: Record<string, FilaReparto>
/** Si está puesto, ese cobro NO tiene fila en `v_cobro_valor`. */
let sinReparto: Set<string>
let clavesUsadas: string[]
let observacionesUsadas: string[]
let documentosUsados: number[]
let valoresUsados: number[]
/** Si está puesto, el POST del voucher falla con este error cuando el documento coincide. */
let fallaEnDocumento: { documentId: number; error: Error } | null
let avisos: Array<{ negocio: string; bloque: string }>
let consecutivo: number
/** Slugs de bloque a los que se archivó cada PDF, en orden. */
let bloquesArchivados: string[]
/** Lo que cada archivado recibió para acumular en `negocio_bloques.data.recibos`. */
let entradasDelHistorial: Record<string, unknown>[]
/** Si cada archivado pidió conservar la copia de Storage para el cliente. */
let copiasParaElCliente: unknown[]

function servicioFalso() {
  const from = (tabla: string) => {
    if (tabla === 'cobros') {
      let id: string | null = null
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => { if (col === 'id') id = val; return chain },
        is: () => chain,
        order: () => chain,
        limit: () => chain,
        single: async () =>
          id && cobros[id] ? { data: { ...cobros[id] }, error: null } : { data: null, error: { message: 'no existe' } },
        maybeSingle: async () =>
          id && cobros[id] ? { data: { ...cobros[id] }, error: null } : { data: null, error: null },
        update: (patch: Record<string, unknown>) => {
          const upd = {
            eq: (col: string, val: string) => { if (col === 'id') id = val; return upd },
            then: (resolve: (v: { error: null }) => unknown) => {
              if (id && cobros[id]) Object.assign(cobros[id], patch)
              return resolve({ error: null })
            },
          }
          return upd
        },
      }
      return chain
    }
    if (tabla === 'v_cobro_valor') {
      let id: string | null = null
      const chain = {
        select: () => chain,
        eq: (col: string, val: string) => { if (col === 'cobro_id') id = val; return chain },
        maybeSingle: async () =>
          id && reparto[id] && !sinReparto.has(id)
            ? { data: { ...reparto[id] }, error: null }
            : { data: null, error: null },
      }
      return chain
    }
    if (tabla === 'negocios') {
      const chain = {
        select: () => chain,
        eq: () => chain,
        single: async () => ({ data: { id: NEG, codigo: 'V0412', nombre: 'Cliente Prueba' }, error: null }),
        maybeSingle: async () => ({ data: { id: NEG, codigo: 'V0412', nombre: 'Cliente Prueba' }, error: null }),
      }
      return chain
    }
    throw new Error(`tabla inesperada en el doble: ${tabla}`)
  }
  return {
    from,
    rpc: async (nombre: string, args: Record<string, string>) => {
      if (nombre === 'avisar_documento_al_cliente') {
        avisos.push({ negocio: args.p_negocio_id, bloque: args.p_bloque_config_id })
        return { data: true, error: null }
      }
      return { data: null, error: null }
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => servicioFalso(),
  createClient: async () => servicioFalso(),
}))

/** El comprobante que la configuración de la línea trae por defecto (el de hoy). */
const DOC_POR_DEFECTO = 2

vi.mock('./client', async () => {
  const real = await vi.importActual<typeof import('./client')>('./client')
  return {
    ...real,
    getSiigoConfig: async () => ({
      facturaDocumentId: 1, reciboDocumentId: DOC_POR_DEFECTO, sellerId: 3,
      productoCode: '11', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
    }),
    siigoRequest: async (
      _ws: string,
      ruta: string,
      opts?: {
        idempotencyKey?: string
        body?: { observations?: string; document?: { id?: number }; payment?: { value?: number } }
      },
    ) => {
      if (ruta.startsWith('/v1/vouchers?')) return { results: [] }
      const doc = opts?.body?.document?.id ?? 0
      clavesUsadas.push(opts?.idempotencyKey ?? '(sin clave)')
      observacionesUsadas.push(opts?.body?.observations ?? '(sin concepto)')
      documentosUsados.push(doc)
      valoresUsados.push(opts?.body?.payment?.value ?? 0)
      if (fallaEnDocumento && fallaEnDocumento.documentId === doc) throw fallaEnDocumento.error
      consecutivo += 1
      // El número lleva el comprobante adentro: así el test ve de cuál salió cada uno.
      return { id: `siigo-${doc}-${consecutivo}`, name: `RC-${doc}-${consecutivo}`, date: '2026-09-19' }
    },
  }
})

vi.mock('./clientes', () => ({
  asegurarClienteSiigo: async () => ({
    estado: 'ya_existia' as const, identificacion: '80815711', siigo_id: 'siigo-cli-1',
    branch_office: 0, nombre: 'JORGE ANDRES SUESCUN CHACON',
  }),
}))

vi.mock('@/lib/pdf/pdf-render-client', () => ({
  renderReciboCaja: async () => Buffer.from('%PDF-falso'),
}))

vi.mock('./archivar-documento', () => ({
  archivarPdfEnBloque: async (...args: unknown[]) => {
    const slug = args[2] as string
    bloquesArchivados.push(slug)
    const historial = args[6] as { entrada?: Record<string, unknown> } | undefined
    if (historial?.entrada) entradasDelHistorial.push(historial.entrada)
    copiasParaElCliente.push(args[9])
    return {
      ok: true as const,
      url: `https://drive.google.com/file/d/drive-${bloquesArchivados.length}/view`,
      driveFileId: `drive-${bloquesArchivados.length}`,
      bloqueConfigId: `bloque-${slug}`,
    }
  },
}))

import { emitirReciboDeCobro } from './recibos'
import { recibosDelCobro } from './recibo-componentes'

/** Ejemplo de configuración por componente. Los números NO significan nada aquí. */
const POR_CONCEPTO = {
  honorario: { document_id: 101, concepto: 'Honorarios de asesoría' },
  pasante: { document_id: 202, concepto: 'Recaudo para pago de tarifa UPME' },
}

const BASE = { bloqueReciboSlug: 'recibo_caja_upme' }
/** Como emite hoy una línea que NO declara `recibo_por_concepto`. */
const LEGADO = { ...BASE, concepto: 'Dinero recibido del cliente' }
/** Como emite una línea que SÍ lo declara. */
const POR_COMPONENTE = { ...BASE, porConcepto: POR_CONCEPTO }

beforeEach(() => {
  cobros = {
    [MIXTO]: {
      id: MIXTO, negocio_id: NEG, monto: 1_000_000, fecha: '2026-08-10',
      tipo_cobro: 'anticipo', siigo_recibo: null, anulado_at: null,
    },
    [PURO_HONORARIO]: {
      id: PURO_HONORARIO, negocio_id: NEG, monto: 400_000, fecha: '2026-08-11',
      tipo_cobro: 'anticipo', siigo_recibo: null, anulado_at: null,
    },
    [PURO_TARIFA]: {
      id: PURO_TARIFA, negocio_id: NEG, monto: 600_000, fecha: '2026-08-12',
      tipo_cobro: 'pago', siigo_recibo: null, anulado_at: null,
    },
  }
  reparto = {
    [MIXTO]: { cobro_id: MIXTO, a_tramo1: 400_000, a_tarifa: 600_000, a_tramo2: 0, excedente: 0 },
    [PURO_HONORARIO]: { cobro_id: PURO_HONORARIO, a_tramo1: 300_000, a_tarifa: 0, a_tramo2: 100_000, excedente: 0 },
    [PURO_TARIFA]: { cobro_id: PURO_TARIFA, a_tramo1: 0, a_tarifa: 600_000, a_tramo2: 0, excedente: 0 },
  }
  sinReparto = new Set()
  clavesUsadas = []
  observacionesUsadas = []
  documentosUsados = []
  valoresUsados = []
  fallaEnDocumento = null
  avisos = []
  consecutivo = 0
  bloquesArchivados = []
  entradasDelHistorial = []
  copiasParaElCliente = []
})

// ─────────────────────────────────────────────────────────────────────────────
// LO QUE EL CORREO NECESITA: el bloque acumula con qué nombrar cada documento
// ─────────────────────────────────────────────────────────────────────────────

describe('el bloque acumula lo que el aviso al cliente va a nombrar', () => {
  it('un cobro mixto deja DOS entradas, cada una con su concepto y su valor', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    // El concepto viaja con la entrada y no se deduce después: es lo que la línea
    // tenía configurado CUANDO se emitió. Leerlo de la config al mandar el correo
    // dejaría que un cambio de config reescribiera un documento ya emitido.
    expect(entradasDelHistorial).toMatchObject([
      { numero: 'RC-101-1', valor: 400_000, concepto: 'Honorarios de asesoría', componente: 'honorario' },
      { numero: 'RC-202-2', valor: 600_000, concepto: 'Recaudo para pago de tarifa UPME', componente: 'pasante' },
    ])
    // Las dos del MISMO cobro: así el correo nombra los dos documentos de este pago
    // y ninguno de un pago anterior.
    expect(new Set(entradasDelHistorial.map(e => e.cobro_id)).size).toBe(1)
  })

  it('un cobro puro deja UNA entrada', async () => {
    await emitirReciboDeCobro(WS, PURO_HONORARIO, null, POR_COMPONENTE)

    expect(entradasDelHistorial).toHaveLength(1)
    expect(entradasDelHistorial[0]).toMatchObject({ valor: 400_000, concepto: 'Honorarios de asesoría' })
  })

  it('una línea SIN recibo_por_concepto también deja su entrada, con el concepto de siempre', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, LEGADO)

    expect(entradasDelHistorial).toHaveLength(1)
    expect(entradasDelHistorial[0]).toMatchObject({ valor: 1_000_000, concepto: 'Dinero recibido del cliente' })
    // Sin `componente`: acusa el total. Es la misma asimetría que la marca del cobro.
    expect(entradasDelHistorial[0]).not.toHaveProperty('componente')
  })

  it('SIEMPRE pide conservar la copia en Storage: el de Drive nace cerrado', async () => {
    // Sin esa copia el correo promete una descarga y entrega un 401, que es el
    // defecto medido el 2026-09-21 sobre 14 avisos ya enviados a 8 clientes reales.
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)
    await emitirReciboDeCobro(WS, PURO_TARIFA, null, LEGADO)

    expect(copiasParaElCliente).toEqual([true, true, true])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EL CASO QUE IMPORTA
// ─────────────────────────────────────────────────────────────────────────────

describe('un cobro mixto produce un recibo por concepto', () => {
  it('produce DOS recibos, con números distintos', async () => {
    const r = await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(r.ok).toBe(true)
    const marcas = recibosDelCobro(cobros[MIXTO].siigo_recibo)
    expect(marcas).toHaveLength(2)
    expect(marcas[0].numero).not.toBe(marcas[1].numero)
  })

  it('cada recibo sale con el tipo de comprobante de SU componente', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(documentosUsados).toEqual([101, 202])
    // CONTROL: ninguno sale con el comprobante único de antes.
    expect(documentosUsados).not.toContain(DOC_POR_DEFECTO)
  })

  it('los dos recibos suman el monto EXACTO del cobro, sin centavo perdido', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    const marcas = recibosDelCobro(cobros[MIXTO].siigo_recibo)
    expect(marcas.map(m => m.valor)).toEqual([400_000, 600_000])
    expect(marcas.reduce((s, m) => s + m.valor, 0)).toBe(1_000_000)
    // Y es lo que viajó a Siigo, no solo lo que quedó escrito.
    expect(valoresUsados).toEqual([400_000, 600_000])
  })

  it('cada componente lleva su propia clave de idempotencia', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(clavesUsadas).toHaveLength(2)
    expect(clavesUsadas[0]).not.toBe(clavesUsadas[1])
  })

  it('cada recibo lleva la observación de SU componente', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(observacionesUsadas).toEqual([
      'Honorarios de asesoría',
      'Recaudo para pago de tarifa UPME',
    ])
  })

  it('la marca dice a qué componente corresponde cada recibo', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    const marcas = recibosDelCobro(cobros[MIXTO].siigo_recibo)
    expect(marcas.map(m => m.componente)).toEqual(['honorario', 'pasante'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CONTROLES POSITIVOS: un cobro puro sigue produciendo UN recibo
// ─────────────────────────────────────────────────────────────────────────────

describe('un cobro puro produce UN recibo, con el comprobante de su componente', () => {
  it('solo honorario: un recibo, con el comprobante del honorario', async () => {
    await emitirReciboDeCobro(WS, PURO_HONORARIO, null, POR_COMPONENTE)

    expect(documentosUsados).toEqual([101])
    const marcas = recibosDelCobro(cobros[PURO_HONORARIO].siigo_recibo)
    expect(marcas).toHaveLength(1)
    expect(marcas[0].valor).toBe(400_000)
  })

  it('solo tarifa: un recibo, con el comprobante de la tarifa', async () => {
    await emitirReciboDeCobro(WS, PURO_TARIFA, null, POR_COMPONENTE)

    expect(documentosUsados).toEqual([202])
    const marcas = recibosDelCobro(cobros[PURO_TARIFA].siigo_recibo)
    expect(marcas).toHaveLength(1)
    expect(marcas[0].componente).toBe('pasante')
    expect(marcas[0].valor).toBe(600_000)
  })

  it('un componente en cero no produce recibo, y tampoco produce error', async () => {
    const r = await emitirReciboDeCobro(WS, PURO_TARIFA, null, POR_COMPONENTE)

    expect(r.ok).toBe(true)
    expect(clavesUsadas).toHaveLength(1)
  })

  // ⚠️ Es el estado real de la configuración mientras el comprobante del componente
  // pasante no exista: se declara en 0 para que se vea que todavía no hay valor.
  it('con un comprobante sin configurar NO sale el otro: frena antes del primer POST', async () => {
    const r = await emitirReciboDeCobro(WS, MIXTO, null, {
      ...BASE,
      porConcepto: {
        ...POR_CONCEPTO,
        pasante: { ...POR_CONCEPTO.pasante, document_id: 0 },
      },
    })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toBe('faltan_datos')
    // Emitir solo el honorario dejaría el cobro a medias y consumiría numeración por
    // una configuración incompleta, que es lo contrario de lo que el gate protege.
    expect(clavesUsadas).toHaveLength(0)
    expect(recibosDelCobro(cobros[MIXTO].siigo_recibo)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// CONTROL DE COMPATIBILIDAD: lo que protege a `metrik` y a `valida`
// ─────────────────────────────────────────────────────────────────────────────

describe('una línea SIN recibo_por_concepto se comporta exactamente como hoy', () => {
  it('emite UN recibo por el total, con el comprobante único de la configuración', async () => {
    const r = await emitirReciboDeCobro(WS, MIXTO, null, LEGADO)

    expect(r.ok).toBe(true)
    expect(documentosUsados).toEqual([DOC_POR_DEFECTO])
    expect(valoresUsados).toEqual([1_000_000])
    expect(observacionesUsadas).toEqual(['Dinero recibido del cliente'])
  })

  it('la marca queda como OBJETO, no como lista', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, LEGADO)

    const guardada = cobros[MIXTO].siigo_recibo
    expect(Array.isArray(guardada)).toBe(false)
    expect(guardada).toMatchObject({ valor: 1_000_000 })
    // Y sin `componente`: la marca vieja no dice a qué concepto corresponde porque
    // acusa el total. `mis_cobros_de_servicio` la lee con `->> 'numero'`, que sobre
    // una lista devuelve NULL: cambiarle la forma habría dejado mudo el módulo de
    // Valida en otro workspace.
    expect((guardada as { componente?: string }).componente).toBeUndefined()
  })

  it('la clave de idempotencia sigue siendo la de siempre', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, LEGADO)

    // Determinista desde el cobro, con el sufijo 'rc' de siempre: si cambiara, un
    // reintento emitiría un recibo NUEVO y consumiría numeración.
    expect(clavesUsadas).toEqual(['cobromixtorc'])
  })

  it('no consulta el reparto: no lo necesita', async () => {
    // Si lo consultara y la vista no tuviera fila (cobros de otros workspaces sin
    // fecha, por ejemplo), se caería o dejaría de emitir.
    sinReparto = new Set([MIXTO])
    const r = await emitirReciboDeCobro(WS, MIXTO, null, LEGADO)

    expect(r.ok).toBe(true)
    expect(documentosUsados).toEqual([DOC_POR_DEFECTO])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IDEMPOTENCIA: emitir dos veces no produce un tercer recibo
// ─────────────────────────────────────────────────────────────────────────────

describe('idempotencia por componente', () => {
  it('reintentar el mismo cobro mixto no produce un tercer recibo', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)
    const repetido = await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(repetido.ok).toBe(false)
    expect(!repetido.ok && repetido.motivo).toBe('ya_emitido')
    expect(clavesUsadas).toHaveLength(2)
  })

  it('la clave de cada componente es ESTABLE entre corridas', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)
    const primera = [...clavesUsadas]

    cobros[MIXTO].siigo_recibo = null
    clavesUsadas = []
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    // Si cambiara entre despliegues, un reintento emitiría de nuevo y consumiría
    // numeración en la contabilidad de SOENA, que no se deshace.
    expect(clavesUsadas).toEqual(primera)
  })

  it('si el segundo componente falla, el primero queda marcado y el cobro sigue pendiente', async () => {
    fallaEnDocumento = { documentId: 202, error: new Error('Siigo se cayó') }
    const r = await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(r.ok).toBe(false)
    const marcas = recibosDelCobro(cobros[MIXTO].siigo_recibo)
    // El honorario YA existe en Siigo: no se puede borrar y su marca tiene que quedar,
    // o el reintento lo emitiría otra vez.
    expect(marcas).toHaveLength(1)
    expect(marcas[0].componente).toBe('honorario')
  })

  it('el reintento después de un fallo parcial emite SOLO lo que falta', async () => {
    fallaEnDocumento = { documentId: 202, error: new Error('Siigo se cayó') }
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    fallaEnDocumento = null
    documentosUsados = []
    const r = await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(r.ok).toBe(true)
    expect(documentosUsados).toEqual([202])
    expect(recibosDelCobro(cobros[MIXTO].siigo_recibo)).toHaveLength(2)
  })

  it('una marca VIEJA (sin componente) no se re-emite aunque la línea ya declare componentes', async () => {
    // Los 3 mixtos que ya tienen recibo por el total. Un recibo emitido consume
    // numeración y no se deshace: se quedan como están.
    cobros[MIXTO].siigo_recibo = { numero: 'RC-1-70', valor: 1_000_000, siigo_id: 'x', archivo_url: null, at: '', por: null }
    const r = await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toBe('ya_emitido')
    expect(clavesUsadas).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EL AVISO AL CLIENTE: uno solo, después de los dos
// ─────────────────────────────────────────────────────────────────────────────

describe('el aviso al cliente sale UNA vez, no una por recibo', () => {
  it('un cobro mixto con dos recibos produce UN solo aviso', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, { ...POR_COMPONENTE, avisarAlCliente: true })

    expect(avisos).toHaveLength(1)
  })

  it('si el segundo componente falla, el correo NO sale a medias', async () => {
    fallaEnDocumento = { documentId: 202, error: new Error('Siigo se cayó') }
    await emitirReciboDeCobro(WS, MIXTO, null, { ...POR_COMPONENTE, avisarAlCliente: true })

    // El cliente hizo UN pago y espera UNA confirmación: un correo que nombra la mitad
    // de lo que pagó se lee como un cobro incompleto. El cobro queda pendiente en el
    // panel y el aviso espera al reintento.
    expect(avisos).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EL VALOR CORREGIDO A MANO
// ─────────────────────────────────────────────────────────────────────────────

describe('el valor corregido desde Tesorería', () => {
  it('no se reparte a ojo: se rechaza en vez de inventar un reparto', async () => {
    const r = await emitirReciboDeCobro(WS, MIXTO, null, { ...POR_COMPONENTE, valorPagado: 999_000 })

    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toBe('faltan_datos')
    expect(clavesUsadas).toHaveLength(0)
  })

  it('un valor igual al del cobro sí pasa: no hay nada que repartir distinto', async () => {
    const r = await emitirReciboDeCobro(WS, MIXTO, null, { ...POR_COMPONENTE, valorPagado: 1_000_000 })

    expect(r.ok).toBe(true)
    expect(valoresUsados).toEqual([400_000, 600_000])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SIN REPARTO NO SE ADIVINA
// ─────────────────────────────────────────────────────────────────────────────

describe('un cobro sin fila en el reparto', () => {
  it('no se emite como si todo fuera honorario: se dice que falta el reparto', async () => {
    sinReparto = new Set([MIXTO])
    const r = await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    expect(r.ok).toBe(false)
    expect(!r.ok && r.motivo).toBe('faltan_datos')
    expect(clavesUsadas).toHaveLength(0)
  })

  it('salvo que el cobro sea de tipo pasante, que es 100% de terceros por definición', async () => {
    // `v_cobro_valor` excluye `tipo_cobro = 'pasante'` a propósito. Hoy no hay ninguno
    // en producción (medido el 2026-09-19 sobre los 516 cobros de la base), pero el día
    // que lo haya, su plata es toda de terceros.
    cobros[PURO_TARIFA].tipo_cobro = 'pasante'
    sinReparto = new Set([PURO_TARIFA])
    const r = await emitirReciboDeCobro(WS, PURO_TARIFA, null, POR_COMPONENTE)

    expect(r.ok).toBe(true)
    expect(documentosUsados).toEqual([202])
    expect(valoresUsados).toEqual([600_000])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// EL PDF DE CADA COMPONENTE
// ─────────────────────────────────────────────────────────────────────────────

describe('el PDF de cada componente', () => {
  it('cada recibo guarda su propio id de Drive: ninguno pisa al otro', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, POR_COMPONENTE)

    const marcas = recibosDelCobro(cobros[MIXTO].siigo_recibo)
    expect(marcas.map(m => m.drive_file_id)).toEqual(['drive-1', 'drive-2'])
  })

  it('un componente puede archivar en su propio bloque si la línea lo declara', async () => {
    await emitirReciboDeCobro(WS, MIXTO, null, {
      ...BASE,
      porConcepto: {
        ...POR_CONCEPTO,
        pasante: { ...POR_CONCEPTO.pasante, bloque_slug: 'recibo_caja_terceros' },
      },
    })

    expect(bloquesArchivados).toEqual(['recibo_caja_upme', 'recibo_caja_terceros'])
  })
})
