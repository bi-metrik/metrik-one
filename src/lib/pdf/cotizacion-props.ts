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
    /**
     * Unidad de cara al cliente: «pax», «noche», «trayecto». Opcional: las
     * cotizaciones anteriores a `items.unidad` no la traen y la columna de cantidad
     * se imprime igual que siempre.
     */
    unidad?: string | null
  }[]

  /**
   * R7 · los bloques de la propuesta, uno por itinerario marcado «va en propuesta».
   *
   * `null` o ausente —que es TODA cotización sin itinerarios, o sea todas las que
   * existían antes de este frente— hace que la plantilla imprima la lista plana de
   * `items`, exactamente como hoy. No hay un flag que encender: hay un arreglo que
   * no llega.
   *
   * El PRINCIPAL viene primero, y es el único cuyo total coincide con
   * `cotizacion.valor_total`: los demás son alternativas con su propio precio. Una
   * plantilla que imprima los tres tiene que decir cuál es cuál, o el cliente no
   * sabe qué número está aceptando.
   */
  itinerarios?: {
    /** Vacío: la plantilla numera («Opción 1»). */
    nombre: string | null
    esPrincipal: boolean
    precio: number
    items: {
      nombre: string
      descripcion: string | null
      precio_venta: number
      descuento_porcentaje: number
      cantidad: number
      unidad?: string | null
    }[]
  }[] | null
  /**
   * El itinerario DÍA POR DÍA: un bloque por día, con las líneas que le tocan.
   *
   * `null`, ausente o vacío —que es TODA cotización sin un solo día asignado, o sea
   * las 20 que existen hoy— hace que la plantilla imprima la tabla plana de siempre.
   * Igual que con `itinerarios`: no hay un flag que encender, hay un arreglo que no
   * llega. Esa es la regla 1 de la reunión del 14, y es lo que protege a Termotech,
   * Arca y WMC, que cotizan bombas y no viajes.
   *
   * ⚠️ Los días vienen TAL COMO alguien los asignó: si hay 1 y 3 y ninguno 2, llegan
   * 1 y 3. Rellenar el hueco inventaría un día vacío en el documento del cliente.
   *
   * ⚠️ INVARIANTE que sostiene el documento: `dias` e `itemsSinDia` son una PARTICIÓN
   * de `items`, no algo aparte. `items` sigue trayendo todas las líneas que aportan al
   * total —sin cambiar una coma— porque de ahí salen el Subtotal y los impuestos; los
   * dos arreglos nuevos solo dicen cómo se reparten en la página. Una plantilla que
   * los ignore (Termotech) imprime `items` plano y su salida no cambia un píxel.
   */
  dias?: {
    /** El ordinal del viaje. Se imprime «Día 3», nunca una fecha. */
    dia: number
    items: {
      nombre: string
      descripcion: string | null
      precio_venta: number
      descuento_porcentaje: number
      cantidad: number
      unidad?: string | null
    }[]
  }[] | null

  /**
   * La otra mitad de la partición: lo que aporta al total y NO tiene día.
   *
   * Son los vuelos y hoteles (su sitio lo decide la tabla de combinaciones, no un día)
   * y las líneas que no declaran grupo (el seguro, un fee). Se imprimen en su propio
   * bloque, debajo de los días, porque son parte del viaje aunque no caigan en uno.
   *
   * Solo se consume cuando `dias` trae algo. Sin días, la plantilla imprime `items`.
   */
  itemsSinDia?: {
    nombre: string
    descripcion: string | null
    precio_venta: number
    descuento_porcentaje: number
    cantidad: number
    unidad?: string | null
  }[] | null

  /**
   * El paquete de sugeridos: «actividades adicionales no incluidas».
   *
   * Son las líneas que declaran un grupo NO combinable (tour, traslado, plan) y se
   * quedaron sin día, en una cotización que sí usa días. Un vuelo o un hotel no entran
   * nunca aquí: aparecerían como no incluidos mientras el cliente los está pagando.
   *
   * ⚠️ Llegan ya filtradas por el check de mostrar u ocultar. La plantilla imprime lo
   * que recibe.
   *
   * ⚠️⚠️ El precio que traen es INFORMATIVO y el bloque lo dice: estas líneas NO se
   * descuentan del total. Mientras «asignar día es incluirlo» siga siendo el único
   * interruptor, una sugerencia con precio sigue sumando — por eso el editor avisa con
   * nombre propio antes de generar el documento.
   */
  sugeridos?: {
    nombre: string
    descripcion: string | null
    /** Por persona si la línea declara `pax`; si no, el valor de la línea. 0 = sin precio. */
    precio_venta: number
    cantidad: number
    unidad?: string | null
  }[] | null

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
