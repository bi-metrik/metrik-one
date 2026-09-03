/**
 * Forma de los datos que recibe CUALQUIER plantilla de cotización.
 *
 * Vive aparte de las plantillas porque hay más de una y todas se invocan desde el
 * mismo sitio (`cotizacion-pdf-actions.ts`). Si cada plantilla declarara su propia
 * interfaz, agregar un campo obligaría a acordarse de tocar todas — y la que se
 * olvide no falla: deja de pintar el dato, en silencio.
 *
 * Los campos que solo usa una plantilla van como OPCIONALES: la plantilla por
 * defecto los ignora y su salida no cambia un píxel.
 */

export interface CotizacionPDFProps {
  cotizacion: {
    consecutivo: string
    descripcion: string | null
    valor_total: number
    modo: string
    fecha_envio: string | null
    fecha_validez: string | null
    condiciones_pago: string | null
    notas: string | null
    descuento_porcentaje: number | null
    descuento_valor: number | null
    /**
     * Texto libre del bloque «Condiciones comerciales» (migración 20260903100000).
     * Lo consume la plantilla `termotech`; la plantilla por defecto no lo imprime.
     */
    terminos_condiciones?: string | null
  }
  empresa: {
    nombre: string
    nit: string | null
    contacto_nombre: string | null
    contacto_email: string | null
    telefono: string | null
    direccion: string | null
    ciudad: string | null
  }
  vendedor: {
    nombre: string
    razon_social: string | null
    nit: string | null
    logo_url: string | null
    color_primario: string
    telefono: string | null
    email: string | null
    direccion: string | null
    ciudad: string | null
  }
  items: {
    nombre: string
    descripcion: string | null
    precio_venta: number
    descuento_porcentaje: number
    cantidad: number
  }[]
  fiscal: {
    subtotal: number
    iva: number
    reteFuente: number
    reteICA: number
    reteIVA: number
    totalBruto: number
    totalRetenciones: number
    teQueda: number
  } | null

  /**
   * Nombre del negocio al que cuelga la cotización. Es el mismo dato que el payload
   * de WeasyPrint ya manda como `proyecto`, y en la plantilla `termotech` alimenta
   * dos cosas: la fila «Proyecto» y el título del capítulo de la tabla.
   */
  negocio?: { nombre: string | null } | null

  /**
   * Quién emite el documento: el staff que genera el PDF.
   *
   * `cotizaciones` NO guarda quién la creó, así que este dato es «quién apretó
   * generar», no «quién la hizo». Si el usuario no tiene ficha de staff llega
   * `null` y el bloque de firma no se pinta — antes que firmar con un nombre
   * inventado, no firmar.
   */
  emisor?: { nombre: string; cargo: string | null } | null
}
