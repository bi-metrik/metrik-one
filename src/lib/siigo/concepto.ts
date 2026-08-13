/**
 * Qué CONCEPTO se factura, y en qué casos.
 *
 * En Siigo el concepto que ve el cliente es el nombre del producto del catálogo,
 * así que elegir el concepto es elegir el `code` del producto. Hasta hoy había
 * uno solo para todo (`siigo_config.productoCode`), y por eso un caso de solo
 * devolución de IVA se facturaba con un texto que menciona la UPME.
 *
 * ⚠️ El mapeo NO se escribe en el código: es CONFIGURACIÓN por línea. Qué
 * producto de la contabilidad del cliente corresponde a cada servicio es una
 * decisión contable suya, y cambiarla no puede exigir un despliegue. El código
 * solo decide QUÉ SERVICIO aplica; el catálogo lo resuelve la configuración.
 *
 * Regla vigente en SOENA (Diana Parra, 2026-08-12):
 *   · Certificación UPME + devolución de IVA → "obtención de incentivos tributarios"
 *   · Solo devolución de IVA                 → el MISMO concepto
 *   · Solo certificación UPME                → "certificación UPME"
 *
 * El default de los casos sin declarar es el primero (decisión de Mauricio,
 * 2026-08-12): medido ese día, 156 de los 181 casos de la cola no declaran qué
 * contrató el cliente, y de los declarados 25 de 29 son el servicio completo.
 * Un default que mencione la UPME le afirmaría a un cliente de solo IVA un
 * servicio que no se le prestó.
 */

/** Lo que el cliente contrató (bloque `servicio_contratado`, campo `servicio`). */
export type ServicioContratado = 'completo' | 'solo_upme' | 'solo_iva'

/** Los tres valores del catálogo, para validar lo que llega de la base. */
const SERVICIOS: ServicioContratado[] = ['completo', 'solo_upme', 'solo_iva']

export const esServicioContratado = (v: unknown): v is ServicioContratado =>
  typeof v === 'string' && (SERVICIOS as string[]).includes(v)

/**
 * Mapeo declarado en `lineas_negocio.config_extra.siigo.conceptos`.
 * Cada clave es un `code` de producto del catálogo de Siigo del cliente.
 */
export interface ConceptosConfig {
  completo?: string
  solo_upme?: string
  solo_iva?: string
  /** Para los casos que no declararon servicio. */
  default?: string
}

export interface ConceptoResuelto {
  /** `code` del producto de Siigo que se enviará en el ítem de la factura. */
  code: string
  /** Servicio que gobernó la elección; null cuando el caso no lo declara. */
  servicio: ServicioContratado | null
  /**
   * true cuando el concepto NO salió del servicio declarado, sino del default.
   * La pantalla lo advierte: es la diferencia entre facturar lo que se vendió y
   * facturar lo que se supone que se vendió.
   */
  porDefecto: boolean
}

/**
 * Resuelve el concepto de un caso.
 *
 * `productoCodeBase` es el `siigo_config.productoCode` de siempre y actúa como
 * último respaldo: **una línea que no declare `conceptos` factura exactamente
 * como hoy**, con un solo concepto para todo. Quien no configura nada recibe el
 * comportamiento que ya tenía, no una regla nueva.
 */
export function conceptoFactura(
  servicioDeclarado: unknown,
  conceptos: ConceptosConfig | undefined,
  productoCodeBase: string,
): ConceptoResuelto {
  const servicio = esServicioContratado(servicioDeclarado) ? servicioDeclarado : null
  const c = conceptos ?? {}

  if (servicio) {
    const code = c[servicio]
    // Un servicio declarado SIN concepto configurado cae al default y se marca
    // como tal: es un hueco de configuración, no una elección.
    if (code) return { code, servicio, porDefecto: false }
  }

  return {
    code: c.default ?? productoCodeBase,
    servicio,
    porDefecto: true,
  }
}
