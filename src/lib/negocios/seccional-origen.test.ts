/**
 * La seccional del negocio deja de quedarse pegada a la PRIMERA lectura.
 *
 * ── El caso que obliga a esto (SOENA, V0264) ─────────────────────────────────
 *
 * 1. Se cargó un RUT que no era del titular. Sembró "Bogotá".
 * 2. El bloque se devolvió por `archivo_equivocado` y ese mismo día entró el RUT bueno,
 *    que dice "Dirección Seccional de Impuestos y Aduanas de Armenia".
 * 3. La seccional **nunca se movió**: el negocio figuró en Bogotá siendo de Armenia,
 *    con su propio bloque de cita diciendo Armenia.
 *
 * La causa era que la siembra escribía con `pisar: false` para proteger la elección
 * manual del 010, y ese booleano **no distingue** un override humano de una siembra
 * automática anterior. Estas pruebas fijan las cuatro reglas que lo reemplazan y el
 * recorrido completo del caso.
 *
 * Se corren contra las funciones REALES (`sembrarSeccionalDesdeRut`, `fijarSeccionalNegocio`,
 * `soltarSeccionalDelRut`) sobre un doble que **persiste**: con un doble de solo lectura,
 * "no se escribió" y "se escribió y no se ve" serían indistinguibles.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { sembrarSeccionalDesdeRut, soltarSeccionalDelRut } from './seccional-desde-documento'
import { fijarSeccionalNegocio, origenSeccional, CLAVE_ORIGEN_SECCIONAL } from './seccional-negocio'

const NEGOCIO = 'neg-v0264'
const LINEA = 'linea-ve'
const BLOQUE_RUT = 'nb-rut'
const BLOQUE_OTRO = 'nb-factura'

/** La única fila de `negocios`. El doble lee y escribe aquí. */
let negocio: { id: string; linea_id: string; metadata: Record<string, unknown> }
/** Slug del `bloque_config` de cada `negocio_bloques` que el doble conoce. */
const SLUG_POR_BLOQUE: Record<string, string> = {
  [BLOQUE_RUT]: 'rut',
  [BLOQUE_OTRO]: 'factura_venta_vehiculo',
}
/** Cuántos UPDATE recibió `negocios`. Distingue "no cambió" de "no se escribió". */
let escrituras = 0

/**
 * Las dos configs REALES de la línea VE de SOENA (`cita_dian_requerida` y `cita_dian_iva`):
 * las dos apuntan al mismo bloque de RUT.
 */
const CONFIGS_LINEA = [
  { config_extra: { cita_dian_confirmacion: { rut_slug: 'rut', seccional_field: 'direccion_seccional' } } },
  { config_extra: { cita_dian_confirmacion: { rut_slug: 'rut', seccional_field: 'direccion_seccional' } } },
]

function dobleDb() {
  return {
    from(tabla: string) {
      let bloqueIdPedido: string | null = null
      let pendiente: Record<string, unknown> | null = null
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chain: any = {
        select: () => chain,
        eq: (col: string, val: string) => {
          if (tabla === 'negocio_bloques' && col === 'id') bloqueIdPedido = val
          return chain
        },
        in: () => chain,
        update: (payload: Record<string, unknown>) => {
          pendiente = payload
          return chain
        },
        maybeSingle: async () => {
          if (tabla === 'negocio_bloques') {
            const slug = bloqueIdPedido ? SLUG_POR_BLOQUE[bloqueIdPedido] : undefined
            return { data: slug ? { bloque_configs: { slug } } : null, error: null }
          }
          if (tabla === 'negocios') return { data: { ...negocio }, error: null }
          return { data: null, error: null }
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        then: (resolve: (v: any) => unknown) => {
          if (pendiente) {
            escrituras += 1
            negocio = { ...negocio, ...(pendiente as { metadata: Record<string, unknown> }) }
            return resolve({ data: null, error: null })
          }
          if (tabla === 'etapas_negocio') return resolve({ data: [{ id: 'etapa-1' }], error: null })
          if (tabla === 'bloque_configs') return resolve({ data: CONFIGS_LINEA, error: null })
          return resolve({ data: [], error: null })
        },
      }
      return chain
    },
  }
}

/** Los campos que la extracción deja en el bloque del RUT. */
function camposRut(texto: string) {
  return { direccion_seccional: { value: texto } }
}

beforeEach(() => {
  negocio = { id: NEGOCIO, linea_id: LINEA, metadata: {} }
  escrituras = 0
})

describe('origenSeccional', () => {
  it('lo que ya existe en la base, sin origen registrado, cuenta como sembrado por documento', () => {
    // Es la regla que permite que el RUT correcto arregle solo los casos históricos.
    expect(origenSeccional({ seccional: 'Bogotá' })).toBe('documento')
    expect(origenSeccional({})).toBe('documento')
    expect(origenSeccional(null)).toBe('documento')
    expect(origenSeccional(undefined)).toBe('documento')
  })

  it('solo el valor literal "manual" cuenta como elección del operador', () => {
    expect(origenSeccional({ [CLAVE_ORIGEN_SECCIONAL]: 'manual' })).toBe('manual')
    // Cualquier otra cosa (un valor de una versión futura, basura, un booleano) cae del
    // lado que se puede corregir solo. Lo contrario congelaría el dato sin que nadie
    // pueda saber por qué.
    expect(origenSeccional({ [CLAVE_ORIGEN_SECCIONAL]: 'MANUAL' })).toBe('documento')
    expect(origenSeccional({ [CLAVE_ORIGEN_SECCIONAL]: true })).toBe('documento')
  })
})

describe('la seccional se corrige cuando el documento que la sembró se reemplaza', () => {
  it('V0264 completo: RUT equivocado → devolución → RUT correcto → queda el del segundo', async () => {
    const db = dobleDb()

    // 1. El RUT de otro titular siembra Bogotá.
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO,
      bloqueId: BLOQUE_RUT,
      campos: camposRut('Impuestos de Bogotá'),
    })
    expect(negocio.metadata.seccional).toBe('Bogotá')
    expect(negocio.metadata[CLAVE_ORIGEN_SECCIONAL]).toBe('documento')

    // 2. Se devuelve el bloque: el dato que ese archivo sembró deja de valer.
    const suelta = await soltarSeccionalDelRut(db, { negocioId: NEGOCIO, bloqueId: BLOQUE_RUT })
    expect(suelta?.soltada).toBe('Bogotá')
    expect(negocio.metadata.seccional).toBeUndefined()
    expect(negocio.metadata[CLAVE_ORIGEN_SECCIONAL]).toBeUndefined()

    // 3. Entra el RUT bueno.
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO,
      bloqueId: BLOQUE_RUT,
      campos: camposRut('Impuestos y Aduanas de Armenia'),
    })
    expect(negocio.metadata.seccional).toBe('Armenia')
  })

  it('una lectura de RUT pisa una seccional sembrada por otro documento, sin devolución de por medio', async () => {
    // El arreglo de raíz: aunque nadie devuelva el bloque (reproceso, corrección del
    // campo a mano, re-carga), el documento nuevo manda sobre el viejo.
    const db = dobleDb()
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos de Bogotá'),
    })
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos y Aduanas de Armenia'),
    })
    expect(negocio.metadata.seccional).toBe('Armenia')
  })

  it('una seccional SIN origen (todo lo que ya existe en la base) sí la corrige el RUT', async () => {
    negocio.metadata = { seccional: 'Bogotá' } // como quedó el cargue histórico
    const db = dobleDb()
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos y Aduanas de Armenia'),
    })
    expect(negocio.metadata.seccional).toBe('Armenia')
    expect(negocio.metadata[CLAVE_ORIGEN_SECCIONAL]).toBe('documento')
  })
})

describe('la elección manual del 010 sigue siendo la decisión del operador', () => {
  it('una lectura de RUT NO pisa una seccional elegida a mano', async () => {
    const db = dobleDb()
    await fijarSeccionalNegocio(db, { negocioId: NEGOCIO, entrada: 'Cali', origen: 'manual' })
    expect(negocio.metadata.seccional).toBe('Cali')

    const esc = await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos de Bogotá'),
    })
    expect(esc?.motivo).toBe('override_manual')
    expect(esc?.guardado).toBeNull()
    expect(negocio.metadata.seccional).toBe('Cali')
  })

  it('devolver el bloque del RUT NO suelta una seccional elegida a mano', async () => {
    // El operador no eligió el archivo: eligió la seccional. Rechazar el archivo no
    // rechaza su decisión.
    const db = dobleDb()
    await fijarSeccionalNegocio(db, { negocioId: NEGOCIO, entrada: 'Cali', origen: 'manual' })

    const suelta = await soltarSeccionalDelRut(db, { negocioId: NEGOCIO, bloqueId: BLOQUE_RUT })
    expect(suelta?.soltada).toBeNull()
    expect(suelta?.conservada).toBe('Cali')
    expect(negocio.metadata.seccional).toBe('Cali')
  })

  it('la elección manual pisa lo que sembró un documento, y queda protegida', async () => {
    const db = dobleDb()
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos de Bogotá'),
    })
    await fijarSeccionalNegocio(db, { negocioId: NEGOCIO, entrada: 'Cali', origen: 'manual' })
    expect(negocio.metadata.seccional).toBe('Cali')
    expect(negocio.metadata[CLAVE_ORIGEN_SECCIONAL]).toBe('manual')
  })

  it('elegir a mano el MISMO valor que sembró el documento lo deja protegido', async () => {
    // Si esta escritura se saltara por "el valor no cambia", la seccional quedaría con
    // origen `documento` y la siguiente lectura del RUT la reemplazaría — deshaciendo en
    // silencio una decisión que el operador acaba de tomar.
    const db = dobleDb()
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos de Bogotá'),
    })
    await fijarSeccionalNegocio(db, { negocioId: NEGOCIO, entrada: 'Bogotá', origen: 'manual' })
    expect(negocio.metadata[CLAVE_ORIGEN_SECCIONAL]).toBe('manual')

    const esc = await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos y Aduanas de Armenia'),
    })
    expect(esc?.motivo).toBe('override_manual')
    expect(negocio.metadata.seccional).toBe('Bogotá')
  })
})

describe('lo que la suelta NO toca', () => {
  it('devolver un bloque que no es el RUT no toca la seccional', async () => {
    const db = dobleDb()
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos de Bogotá'),
    })
    const antes = escrituras

    const suelta = await soltarSeccionalDelRut(db, { negocioId: NEGOCIO, bloqueId: BLOQUE_OTRO })
    expect(suelta).toBeNull()
    expect(negocio.metadata.seccional).toBe('Bogotá')
    expect(escrituras).toBe(antes) // ni siquiera se intentó escribir
  })

  it('devolver el RUT de un negocio sin seccional no escribe nada', async () => {
    const db = dobleDb()
    const suelta = await soltarSeccionalDelRut(db, { negocioId: NEGOCIO, bloqueId: BLOQUE_RUT })
    expect(suelta?.soltada).toBeNull()
    expect(suelta?.conservada).toBeNull()
    expect(escrituras).toBe(0)
  })

  it('la suelta conserva el resto de la metadata del negocio', async () => {
    // `metadata` es un cajón compartido: ahí viven las marcas de Siigo, la atribución y
    // los avisos financieros. Soltar la seccional no puede llevarse nada más.
    negocio.metadata = { seccional: 'Bogotá', siigo_factura: { numero: 'FV-2-244' }, fuente_cargue: 'meta_lead' }
    const db = dobleDb()
    await soltarSeccionalDelRut(db, { negocioId: NEGOCIO, bloqueId: BLOQUE_RUT })
    expect(negocio.metadata).toEqual({ siigo_factura: { numero: 'FV-2-244' }, fuente_cargue: 'meta_lead' })
  })
})

describe('un texto que no se reconoce no degrada lo que ya había', () => {
  it('"Otras seccionales" es una clave de preset, no una seccional', async () => {
    const db = dobleDb()
    await sembrarSeccionalDesdeRut(db, {
      negocioId: NEGOCIO, bloqueId: BLOQUE_RUT, campos: camposRut('Impuestos y Aduanas de Armenia'),
    })
    const esc = await fijarSeccionalNegocio(db, {
      negocioId: NEGOCIO, entrada: 'Otras seccionales', origen: 'manual',
    })
    expect(esc.motivo).toBe('no_reconocida')
    expect(negocio.metadata.seccional).toBe('Armenia')
    expect(negocio.metadata[CLAVE_ORIGEN_SECCIONAL]).toBe('documento')
  })
})
