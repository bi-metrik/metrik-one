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

import type {
  CargoEnDestinoPDF,
  HotelPDF,
  NivelDetalle,
  VueloPDF,
} from '@/lib/cotizaciones/detalle-viaje'

/**
 * El precio de UN pasajero de cada tipo en una línea (tarifa por pasajero, diseño §4).
 *
 * Opcional en toda línea: solo lo traen las que tienen costo por pasajero confirmado y
 * vigente. Una plantilla que lo ignore imprime la línea como siempre.
 */
export type PrecioPorPasajeroPDF = {
  tipo: 'adulto' | 'nino' | 'infante'
  cantidad: number
  precioUnitario: number
}[] | null

/**
 * La foto de una sección del documento (portada, ciudad).
 *
 * Desde el 2026-09-22 la llena un banco PROVISIONAL (`src/lib/pdf/fotos-ciudad.ts`): el
 * real, curado por el cliente, espera a que se decida quién aprueba una foto antes de que
 * salga. Sin foto para la ciudad, este campo llega `null` y la plantilla pone la banda de
 * marca: nunca un hueco ni una imagen rota.
 */
export interface FotoPDF {
  /** URL o ruta absoluta en disco. @react-pdf acepta las dos. */
  url: string
  /** Rótulo en mayúscula sostenida, como en los itinerarios de Trappvel: `MADRID · EDIFICIO METRÓPOLIS`. */
  rotulo: string | null
  /**
   * Lo que la licencia obliga a imprimir: `Felviper (Wikimedia Commons, CC BY-SA 4.0)`.
   * Casi todas las fotos del banco son CC BY o BY-SA: sin el crédito, usarlas incumple la
   * licencia. `null` solo para una foto propia del cliente.
   */
  credito: string | null
  /**
   * Los nombres con que el viaje llama a esta ciudad («Providencia», «Providencia PVA»).
   * Con ellos la plantilla pone la foto en el capítulo de su ciudad sin conocer el banco.
   */
  lugares?: string[]
}

/**
 * El viaje que describe el documento del cliente: portada, vuelos, hoteles y cargos en
 * destino (§2 de `proyectos/trappvel/clarity/docs/diseno/propuesta-visual.md`).
 *
 * `null` o ausente —que es TODA cotización que no sea de viaje, o sea Termotech, Arca y
 * WMC— hace que la plantilla que lo consuma imprima la lista plana de siempre. Igual que
 * `dias` e `itinerarios`: no hay un flag que encender, hay un objeto que no llega.
 *
 * Lo arma `detalle-viaje.ts` con lo que la lectura del pantallazo ya guardó en cada línea;
 * no hay una tabla nueva de «datos del vuelo».
 */
export interface ViajePDF {
  /** «2 adultos y 1 niño». `null` si nadie declaró la composición del grupo. */
  viajeros: string | null
  destino: string | null
  /** «23 oct 2026 – 30 oct 2026». `null` si no hay fechas. */
  fechas: string | null
  /** «7 días / 6 noches». `null` si no se puede derivar de fechas completas. */
  duracion: string | null
  /** El párrafo de presentación del destino, escrito por quien cotiza. */
  presentacion: string | null
  /** La foto de portada: la de la ciudad destino del negocio. */
  foto: FotoPDF | null
  /**
   * Una foto por ciudad del viaje, sin repetir la de portada. Entre las dos no pasan de
   * cuatro (`fotos-del-viaje.ts`). Opcional: ausente o vacío, el documento no imprime la
   * franja de fotos.
   */
  fotosCiudades?: FotoPDF[]
  /**
   * La fecha de salida en ISO (`2027-01-17`). Con ella la línea de tiempo pone la fecha en
   * cada día («17 ENE»); sin ella, el círculo dice «DÍA 3». Opcional.
   */
  fechaInicio?: string | null
  /**
   * El titular de la portada, del texto para el cliente (`cotizaciones.documento_cliente`).
   * Reemplaza al nombre del negocio como título. Ausente o `null`, el título es el de
   * siempre. Solo llega un texto que una persona REVISÓ (`textoImprimible`).
   */
  titular?: string | null
  /** Una o dos frases que presentan el viaje, bajo el título. Misma regla que `titular`. */
  intro?: string | null
  /**
   * El recuadro «Antes de viajar» (§4.9 del sistema visual). Sale del texto para el cliente
   * revisado; sin él, no se imprime. No se inventa contenido por defecto.
   */
  antesDeViajar?: string[]
  /**
   * «Incluido en el plan»: lo que el cliente RECIBE (traslados, equipaje, alimentación,
   * impuestos), en frases cortas. Sale del texto para el cliente revisado; sin él, la
   * columna no se imprime. NO se arma con los nombres de las líneas, que es la lista de
   * «Inversión» repetida.
   */
  incluye?: string[]
  vuelos: VueloPDF[]
  hoteles: HotelPDF[]
  cargosEnDestino: CargoEnDestinoPDF[]
  nivelDetalle: NivelDetalle
  /**
   * El pie de marca que va en todas las páginas y la firma del documento.
   *
   * Salen de la configuración del workspace, no del código: quién firma un documento que
   * va al cliente es una decisión del cliente, y clavarla aquí obligaría a un despliegue
   * para cambiar un cargo. Sin configuración, el pie se arma con los datos del vendedor y
   * la firma cae en `emisor` (quien generó el documento).
   */
  pie: string | null
  firma: { nombre: string; cargo: string | null; contacto: string | null } | null
}

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
    /** Precio por pasajero de la línea. Ausente = se cobra por el grupo. */
    precioPorPasajero?: PrecioPorPasajeroPDF
    /**
     * Los adicionales de ESTA variante, en palabras: «Equipaje de bodega adicional ×2».
     *
     * Van DENTRO de la línea, no como ítem aparte: *«que me lo muestre todo junto»*. Son
     * texto, sin cifra propia — el dinero del documento se imprime una sola vez y va en el
     * total de la línea (ver `valorAdicionales`).
     */
    adicionales?: string[]
    /**
     * Lo que los adicionales le suman al total de la línea, en pesos.
     *
     * ⚠️ TIENE que entrar en el total impreso. `precio_venta` es el precio BASE de la
     * variante (`items.precio_venta`), y sin este sumando la columna que el cliente suma
     * quedaría por debajo del TOTAL, que sale de `valor_total` y sí los incluye. Dos
     * cifras del mismo dinero que no cuadran, en el documento que el cliente sí suma.
     *
     * Ausente vale 0: es todo lo que no es un viaje con adicionales.
     */
    valorAdicionales?: number
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
      /** Precio por pasajero de la línea. Ausente = se cobra por el grupo. */
      precioPorPasajero?: PrecioPorPasajeroPDF
      /** Ver `items[].adicionales`: van dentro de la línea, en palabras. */
      adicionales?: string[]
      /** Ver `items[].valorAdicionales`: TIENE que entrar en el total impreso. */
      valorAdicionales?: number
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
      /** Precio por pasajero de la línea. Ausente = se cobra por el grupo. */
      precioPorPasajero?: PrecioPorPasajeroPDF
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
    /** Precio por pasajero de la línea. Ausente = se cobra por el grupo. */
    precioPorPasajero?: PrecioPorPasajeroPDF
  }[] | null

  /**
   * El paquete de sugeridos: «actividades adicionales no incluidas».
   *
   * Son las líneas que declaran un grupo NO combinable (tour, traslado, plan) y se
   * quedaron sin día, en una cotización que sí usa días; y, con o sin días, las que
   * alguien sacó del precio a propósito. Un vuelo o un hotel no entran nunca aquí:
   * aparecerían como no incluidos mientras el cliente los está pagando.
   *
   * ⚠️ Llegan ya filtradas por el check de mostrar u ocultar. La plantilla imprime lo
   * que recibe.
   *
   * ⚠️⚠️ El precio que traen es INFORMATIVO y el bloque lo dice. Si la línea está fuera
   * del precio (`items.entra_al_precio = false`), no suma al total y el documento
   * cuadra. Si entra al precio, sigue sumando: esa contradicción la avisa el editor con
   * nombre propio antes de generar el documento. La plantilla no la resuelve.
   */
  sugeridos?: {
    nombre: string
    descripcion: string | null
    /** Por persona si la línea declara `pax`; si no, el valor de la línea. 0 = sin precio. */
    precio_venta: number
    cantidad: number
    unidad?: string | null
  }[] | null

  /**
   * El precio por pasajero de TODO el viaje: por cada tipo, la suma del precio de cada
   * componente que lo incluye (diseño §4: «por ítem y en total»).
   *
   * `null` o ausente cuando ninguna línea trae precio por pasajero: la sección no se imprime
   * y el documento de Termotech, Arca y WMC no cambia un píxel.
   */
  preciosPorPasajero?: {
    filas: {
      tipo: 'adulto' | 'nino' | 'infante'
      /** Cuántos viajan de ese tipo. `null` = las líneas no coinciden y no se multiplica. */
      cantidad: number | null
      precioUnitario: number
    }[]
    /**
     * Lo que la tabla por pasajero explica (Σ `precioUnitario × cantidad`).
     *
     * ⚠️ Es lo que permite que el documento NO muestre dos cifras que no cierran: la
     * plantilla resta `total − cubierto` y nombra la diferencia. `null` = no se puede
     * reconciliar, y entonces la plantilla lo dice en vez de sugerir que la columna suma.
     */
    cubierto: number | null
    /** Componentes que se cobran por el grupo y NO están en la suma. Se nombran en el pie. */
    sinReparto: string[]
  } | null

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
   * Los precios de ESTE documento ya traen el IVA adentro (`iva-cotizacion.ts`): el
   * workspace liquida el IVA sobre el ingreso propio y la plantilla lo sabe imprimir
   * (`plantillaImprimePreciosConIva`). Cada línea, cada tarifa, la tabla por pasajero y el
   * TOTAL ya lo incluyen, así que la plantilla NO imprime «Subtotal» ni «IVA» aparte.
   *
   * `null` o ausente en todo lo demás: la plantilla imprime Subtotal, IVA y TOTAL como
   * siempre.
   */
  ivaEnPrecios?: {
    /** El IVA del TOTAL. */
    iva: number
    /** `true` = «Incluye IVA de $X sobre la tarifa de servicio de la agencia» (`linea_incluida`). */
    nota: boolean
    /** El IVA de cada tarifa, en el orden de `itinerarios`. */
    porBloque: number[]
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

  /**
   * El viaje: portada, vuelos, hoteles y cargos en destino. Ver `ViajePDF`.
   *
   * Solo lo consume la plantilla `trappvel`. `null` en toda cotización que no sea de
   * viaje, y la plantilla por defecto ni lo mira.
   */
  viaje?: ViajePDF | null
}
