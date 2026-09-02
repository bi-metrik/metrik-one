// ============================================================
// Doble del cliente de Supabase para las pruebas de la cola de facturación, y el
// sembrador de casos que la alimenta.
//
// ⚠️ EL DOBLE REPRODUCE EL DEFECTO, no solo la forma de la tabla: recorta en
// 1.000 filas igual que PostgREST y honra `.range()`. Sin esa parte, las pruebas
// de paginación pasaban con el código viejo y no probaban nada.
//
// Vive en `test/` (fuera de `src/`) para que vitest no lo recoja como suite y
// para que dos archivos de pruebas de la misma cola no mantengan dos motores que
// se desincronizan. `vi.mock` sigue siendo por archivo: cada suite enlaza
// `createServiceClient` a `servicioFalso` por su cuenta.
// ============================================================

export const WS = 'ws-soena'
export const LINEA = 'linea-ve'

/** Tope de filas del servidor. El doble lo respeta: es el defecto que se prueba. */
export const MAX_ROWS = 1000

export type Fila = Record<string, unknown>

/** Estado del doble. Cada archivo de pruebas tiene el suyo (vitest aísla módulos). */
export const estado: {
  fixtures: Record<string, Fila[]>
  /** Tablas cuya lectura devuelve error, para probar que la cola no la disimula. */
  tablasQueFallan: Set<string>
} = { fixtures: {}, tablasQueFallan: new Set() }

export function reiniciarDoble(): void {
  estado.fixtures = {}
  estado.tablasQueFallan = new Set()
}

// ─── Doble: mini motor de consultas que RECORTA como PostgREST ──────────────

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
      let orden: string | null = null
      let tope: number | null = null
      let rango: [number, number] | null = null

      const resolver = (): Fila[] => {
        let filas = (estado.fixtures[tabla] ?? []).filter(f => filtros.every(p => p(f)))
        if (orden) {
          const campo = orden
          filas = [...filas].sort((a, b) =>
            String(valorEn(a, campo) ?? '').localeCompare(String(valorEn(b, campo) ?? '')),
          )
        }
        if (rango) {
          const [desde, hasta] = rango
          // Aunque pidan un rango más ancho, el servidor nunca manda más de MAX_ROWS.
          filas = filas.slice(desde, desde + Math.min(hasta - desde + 1, MAX_ROWS))
        } else {
          // Sin `.range()` el servidor recorta en seco y NO avisa: éste es el bug.
          filas = filas.slice(0, MAX_ROWS)
        }
        if (tope !== null) filas = filas.slice(0, tope)
        return filas
      }

      const chain = {
        select: () => chain,
        eq: (campo: string, valor: unknown) => {
          filtros.push(f => valorEn(f, campo) === valor)
          return chain
        },
        in: (campo: string, valores: unknown[]) => {
          const set = new Set(valores)
          filtros.push(f => set.has(valorEn(f, campo)))
          return chain
        },
        order: (campo: string) => {
          orden = campo
          return chain
        },
        limit: (n: number) => {
          tope = n
          return chain
        },
        range: (desde: number, hasta: number) => {
          rango = [desde, hasta]
          return chain
        },
        single: async () => ({ data: resolver()[0] ?? null, error: null }),
        maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
        then: (resolve: (v: { data: Fila[] | null; error: { message: string } | null }) => unknown) =>
          resolve(
            estado.tablasQueFallan.has(tabla)
              ? { data: null, error: { message: 'conexión caída' } }
              : { data: resolver(), error: null },
          ),
      }
      return chain
    },
  }
}

// ─── Fixtures ──────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(4, '0')

export const RUT_COMPLETO = {
  numero_identificacion: { value: '9771470' },
  tipo_persona: { value: 'Natural' },
  primer_nombre: { value: 'VICTOR' },
  primer_apellido: { value: 'RESTREPO' },
  razon_social: { value: 'RESTREPO TORO VICTOR HUGO' },
  direccion: { value: 'CR 15 14 31' },
  email: { value: 'victor@example.com' },
  municipio: { value: 'Armenia' },
  departamento: { value: 'Quindío' },
  pais: { value: 'COLOMBIA' },
}

export const SIIGO_CFG = {
  facturaDocumentId: 1, reciboDocumentId: 2, sellerId: 3,
  productoCode: '22', ivaId: 4, facturaPaymentId: 5, reciboPaymentId: 6,
}

/**
 * Arma un workspace con `casos` negocios listos para facturar.
 *
 * El ORDEN de las filas de bloques imita lo medido en producción: primero todos
 * los RUT, luego todos los servicios, y **las filas de factura al final**. Así el
 * recorte del servidor se lleva justo las que dicen "esto ya se facturó", que es
 * la forma más cara de fallar.
 */
export function sembrar(opciones: {
  casos: number
  facturados?: number[]
  copiasFactura?: number
  bloqueFacturaSlug?: boolean
  /**
   * Qué grupo de filas queda al final y por lo tanto se pierde con el recorte.
   * En producción el orden lo decide el plan de la consulta y **cambia entre
   * corridas**: en dos mediciones separadas por minutos el conteo de casos sin
   * servicio pasó de 24 a 23. Por eso se prueban las dos variantes.
   */
  ordenBloques?: 'factura-al-final' | 'rut-al-final' | 'servicio-al-final'
  /**
   * En cuál de las copias heredadas quedó cargada la factura. Por defecto la
   * nativa; poner una copia tardía reproduce el caso real (medido 2026-08-27:
   * 240 de 272 negocios no tienen fila en la configuración nativa).
   */
  facturaEnCopia?: number
  /**
   * Contacto del caso `i`. Por defecto reproduce lo medido en producción: SIN
   * correo (lo tiene el RUT) y con celular. Los casos que lo sobreescriben son
   * los que prueban la precedencia contacto → RUT.
   */
  contacto?: (i: number) => { email: string | null; telefono: string | null }
  /** Campos del bloque `rut` del caso `i`. Por defecto `RUT_COMPLETO`. */
  rut?: (i: number) => Record<string, { value: unknown }>
}) {
  const { casos, facturados = [], copiasFactura = 1, facturaEnCopia = 0 } = opciones
  const contactoDe = opciones.contacto ?? (() => ({ email: null, telefono: '3142557450' }))
  const rutDe = opciones.rut ?? (() => RUT_COMPLETO)
  const orden = opciones.ordenBloques ?? 'factura-al-final'
  const yaFacturado = new Set(facturados)

  estado.fixtures = {
    workspaces: [{ id: WS, config_extra: { siigo_config: SIIGO_CFG, siigo_access_key: 'k' } }],
    lineas_negocio: [{
      id: LINEA, workspace_id: WS,
      config_extra: {
        facturacion: { desde_etapa_numero: 5 },
        siigo: {
          conceptos: { completo: '11', solo_upme: '22', solo_iva: '11', default: '11' },
          ...(opciones.bloqueFacturaSlug ? { bloque_factura_slug: 'factura_emitida' } : {}),
        },
      },
    }],
    negocios: [],
    negocio_bloques: [],
    cobros: [],
    negocio_conciliacion: [],
    contactos: [],
    bloque_configs: [],
  }

  for (let i = 0; i < casos; i++) {
    const id = `neg-${pad(i)}`
    estado.fixtures.negocios.push({
      id, codigo: `V${pad(i)}`, nombre: `Caso ${i}`, workspace_id: WS, estado: 'abierto',
      precio_aprobado: 637500, contacto_id: `con-${pad(i)}`, linea_id: LINEA, metadata: {},
      etapas_negocio: { nombre: 'Cargue', numero: 6 },
    })
    estado.fixtures.contactos.push({ id: `con-${pad(i)}`, ...contactoDe(i) })
    // Honorario recaudado completo: así `falta_saldo` es 0 y lo único que puede
    // dejar un caso fuera de "listo" es que le falte un dato del borrador.
    estado.fixtures.cobros.push({ id: `cob-${pad(i)}`, negocio_id: id, monto: 637500, tipo_cobro: 'pago', split_json: null })
  }

  // Configuraciones del bloque de factura (la nativa y sus copias heredadas).
  for (let c = 0; c < copiasFactura; c++) {
    estado.fixtures.bloque_configs.push({
      id: `cfg-fact-${c}`,
      slug: c === 0 ? 'factura_emitida' : null,
      nombre: 'Factura emitida',
      etapas_negocio: { linea_id: LINEA },
    })
  }

  // El orden de inserción ES el orden que devuelve el servidor cuando nadie pide
  // uno: lo último que se siembra es lo primero que el techo se lleva.
  const push = (rango: number, i: number, slug: string, cfg: string, data: Fila) =>
    estado.fixtures.negocio_bloques.push({
      id: `blq-${rango}-${pad(i)}`, negocio_id: `neg-${pad(i)}`,
      bloque_config_id: cfg, data, bloque_configs: { slug },
    })

  const grupos: Record<string, (rango: number) => void> = {
    rut: r => { for (let i = 0; i < casos; i++) push(r, i, 'rut', 'cfg-rut', { campos: rutDe(i) }) },
    servicio: r => { for (let i = 0; i < casos; i++) push(r, i, 'servicio_contratado', 'cfg-srv', { servicio: 'completo' }) },
    upme: r => { for (let i = 0; i < casos; i++) push(r, i, 'comprobante_pago_upme', 'cfg-upm', { campos: { valor_pagado: { value: 701812 } } }) },
    factura: r => {
      for (let c = 0; c < copiasFactura; c++) {
        for (let i = 0; i < casos; i++) {
          const tieneNumero = yaFacturado.has(i) && c === facturaEnCopia
          push(r + c, i, 'factura_emitida', `cfg-fact-${c}`,
            tieneNumero ? { campos: { numero_factura: { value: `FV-${i}` } } } : { campos: {} })
        }
      }
    },
  }

  const secuencias: Record<string, string[]> = {
    'factura-al-final': ['rut', 'servicio', 'upme', 'factura'],
    'rut-al-final': ['servicio', 'upme', 'factura', 'rut'],
    'servicio-al-final': ['rut', 'upme', 'factura', 'servicio'],
  }
  const secuencia = secuencias[orden]
  let rango = 0
  for (const g of secuencia) {
    grupos[g](rango)
    rango += g === 'factura' ? copiasFactura : 1
  }
}

