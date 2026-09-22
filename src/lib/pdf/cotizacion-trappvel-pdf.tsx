/**
 * Plantilla de cotización «trappvel» — ITINERARIO DE VIAJE con precio.
 *
 * Entrega B del brief `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-17-documento-cliente.md`.
 * Reproduce la anatomía de los TRES itinerarios reales que Trappvel manda hoy a sus
 * clientes (§2 de `propuesta-visual.md`, levantada de los PDF de Cancún, México–Cancún y
 * Europa) y le agrega lo único que esos documentos no llevan: el precio, y el precio por
 * tipo de pasajero.
 *
 * Es una plantilla de RENDER. No cambia qué se guarda, ni el cálculo fiscal, ni el total:
 * el dinero que imprime sale de las MISMAS props que la plantilla por defecto.
 *
 * ## Las cuatro decisiones que gobiernan este archivo
 *
 * **1 · Lo que no existe no se pinta, y el documento no se ve roto por eso.** No hay
 * placeholders, ni rayas, ni «—» en una ficha vacía: la ficha no aparece. El caso que
 * manda es la foto de portada: sale del banco PROVISIONAL de fotos por ciudad
 * (`fotos-ciudad.ts`), y cuando la ciudad destino no está en el banco, donde iría la foto
 * va una banda con el color y el logo de la marca, que es una portada legítima y no un
 * hueco.
 *
 * **2 · El dinero se imprime UNA vez.** El día a día, la tabla de vuelos y la ficha de
 * hotel describen el viaje **sin precios**, como en los itinerarios de referencia; todo el
 * dinero vive en la sección «Inversión». Con el precio repetido en dos sitios, basta que
 * una ranura tenga alternativas para que las dos cifras dejen de coincidir en el
 * documento que el cliente sí suma.
 *
 * **3 · Lo que el cliente TIENE QUE PAGAR no se recorta por nivel de detalle.** Los tres
 * niveles (§4.6) recortan descripción, nunca obligaciones: los cargos que se pagan en
 * destino y el «no incluye» salen en los tres, incluido el más general.
 *
 * **4 · Quién firma es decisión del cliente, no del código.** El pie y la firma salen de
 * `viaje.pie` / `viaje.firma`, que vienen de la configuración del workspace. Sin
 * configuración, el pie se arma con los datos del vendedor y firma quien generó el
 * documento (`emisor`), igual que en la plantilla `termotech`.
 */

import { Document, Page, Text, View, Image as PdfImage } from '@react-pdf/renderer'

import type { CotizacionPDFProps, ViajePDF } from './cotizacion-props'
import type { FotoPDF, PrecioPorPasajeroPDF } from './cotizacion-props'
import { creditosDeFotos } from './fotos-del-viaje'
import { partirPalabraLarga } from '@/lib/cotizaciones/condiciones-comerciales'
import { tituloDeBloquePDF } from '@/lib/cotizaciones/itinerarios'
import {
  columnasConDato,
  trayectosDelVuelo,
  type ColumnaTrayecto,
  type TrayectoPDF,
} from '@/lib/cotizaciones/detalle-viaje'

const GRIS_TEXTO = '#4B4B4B'
const GRIS_ETIQUETA = '#8A8A8A'
const GRIS_BORDE = '#DDDDDD'
const GRIS_FONDO = '#F6F6F6'
const NEGRO = '#1A1A1A'
const BLANCO = '#FFFFFF'

/** Ver la nota de `SIN_GUION` en la plantilla de Termotech: la regla es por `<Text>`. */
const SIN_GUION = partirPalabraLarga

const pesos = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const NOMBRE_PASAJERO: Record<'adulto' | 'nino' | 'infante', string> = {
  adulto: 'Adulto',
  nino: 'Niño',
  infante: 'Infante',
}

/** Un viaje vacío: lo que recibe una cotización que no es de viaje. No rompe nada. */
const VIAJE_VACIO: ViajePDF = {
  viajeros: null,
  destino: null,
  fechas: null,
  duracion: null,
  presentacion: null,
  foto: null,
  vuelos: [],
  hoteles: [],
  cargosEnDestino: [],
  nivelDetalle: 'normal',
  pie: null,
  firma: null,
}

/**
 * El título de una sección.
 *
 * ⚠️ `minPresenceAhead` no es un detalle de estilo: sin él el título cae al pie de una
 * página y su contenido arranca en la siguiente. Se vio en la página, con «INVERSIÓN»
 * solo al final de la primera y la tabla entera en la segunda — un renglón rosa suelto
 * sobre el pie, que es exactamente el aspecto de un documento roto. Los 54 pt son el alto
 * de un encabezado más dos filas: si no caben, la sección entera empieza en la página
 * siguiente.
 */
function Titulo({ texto, color }: { texto: string; color: string }) {
  return (
    <View
      minPresenceAhead={54}
      style={{ marginTop: 16, marginBottom: 6, borderBottomWidth: 1.2, borderBottomColor: color, paddingBottom: 3 }}
    >
      <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color, letterSpacing: 1 }}>
        {texto.toUpperCase()}
      </Text>
    </View>
  )
}

function Ficha({ etiqueta, valor, color }: { etiqueta: string; valor: string; color: string }) {
  return (
    <View style={{ flexGrow: 1, flexBasis: 0, paddingHorizontal: 6 }}>
      <Text style={{ fontSize: 6.5, color: GRIS_ETIQUETA, letterSpacing: 0.8 }}>{etiqueta}</Text>
      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color, marginTop: 2 }}>
        {valor}
      </Text>
    </View>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 2 }}>
      <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA, width: 74 }}>{etiqueta}</Text>
      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: NEGRO, flex: 1 }}>
        {valor}
      </Text>
    </View>
  )
}

/**
 * La tabla de vuelos de la referencia: una fila por trayecto, ida y regreso.
 *
 * Las columnas son las del itinerario que Trappvel manda hoy —RUTA, FECHA, SALIDA,
 * LLEGADA, con la AEROLÍNEA encabezando la tarjeta— más ESCALA, que §4.1 del brief pide
 * con nombre propio. Ni DURACIÓN ni número de vuelo: ver `detalle-viaje.ts`.
 *
 * ⚠️ Las columnas NO son fijas: se imprimen solo las que tienen dato en alguna fila
 * (`columnasConDato`). Una columna con dos rayas es exactamente la «tabla con guiones»
 * que este documento no puede tener.
 */
const TITULO_COLUMNA: Record<ColumnaTrayecto, string> = {
  sentido: '',
  ruta: 'RUTA',
  fecha: 'FECHA',
  salida: 'SALIDA',
  llegada: 'LLEGADA',
  escala: 'ESCALA',
}

/** El ancho relativo de cada columna. Se reparte entre las que efectivamente salen. */
const PESO_COLUMNA: Record<ColumnaTrayecto, number> = {
  sentido: 15,
  ruta: 30,
  fecha: 16,
  salida: 13,
  llegada: 13,
  escala: 22,
}

/**
 * ⚠️⚠️ El aire entre columnas. Sin esto la tabla no tiene NINGÚN canal.
 *
 * Los anchos se reparten al 100% del ancho disponible, así que la caja de una columna
 * termina justo donde empieza el texto de la siguiente. Medido: con las siete columnas
 * viejas la RUTA tenía 120,3 pt y «San Andrés ADZ – Providencia PVA» mide 120,2 pt, o sea
 * que la ruta acababa **pegada** a la fecha y se leía «Providencia PVA17 ene 2027».
 *
 * Quitar la columna DURACIÓN (que la referencia no trae) sube la RUTA a 138 pt y resuelve
 * ESTE caso; el canal resuelve la FAMILIA, porque cualquier ruta que use su columna
 * completa vuelve a tocar a la vecina. Las dos cosas hacen falta: una es el caso, la otra
 * es la regla.
 */
const CANAL_COLUMNA = 6

/**
 * Lo que vale para TODO el itinerario y no para un trayecto: tarifa, equipaje, adicionales.
 *
 * ⚠️ NO usa `Dato`, que reserva una columna fija de 74 pt para la etiqueta. Mirando la
 * página se vio que esa columna coincide con el inicio de la RUTA en una tarjeta y no en
 * la de al lado, porque la tabla ajusta sus anchos a las columnas que tenga: el mismo
 * documento mostraba las dos formas. Aquí la etiqueta y el valor van pegados, así que la
 * alineación deja de depender de qué columnas trajo la captura.
 */
function MetaVuelo({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 2.5 }}>
      <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA }}>{`${etiqueta} `}</Text>
      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: NEGRO, flex: 1 }}>
        {valor}
      </Text>
    </View>
  )
}

function TablaTrayectos({ trayectos, color }: { trayectos: TrayectoPDF[]; color: string }) {
  const columnas = columnasConDato(trayectos)
  if (columnas.length === 0) return null
  const total = columnas.reduce((a, c) => a + PESO_COLUMNA[c], 0)
  const ancho = (c: ColumnaTrayecto) => `${(PESO_COLUMNA[c] / total) * 100}%`
  // Con una sola columna con dato («RUTA» y nada más) una tabla es más ruido que la línea
  // suelta que ya se imprimía. El encabezado solo aparece si hay algo que encabezar.
  const conEncabezado = columnas.some(c => c !== 'sentido' && c !== 'ruta')
  return (
    <View style={{ marginTop: 4 }}>
      {conEncabezado && (
        <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: GRIS_BORDE, paddingBottom: 2 }}>
          {columnas.map((c, j) => (
            <Text
              key={`th-${c}`}
              style={{
                fontSize: 6,
                color: GRIS_ETIQUETA,
                letterSpacing: 0.6,
                width: ancho(c),
                paddingRight: j === columnas.length - 1 ? 0 : CANAL_COLUMNA,
              }}
            >
              {TITULO_COLUMNA[c]}
            </Text>
          ))}
        </View>
      )}
      {trayectos.map((t, i) => (
        <View key={`tr-${i}`} style={{ flexDirection: 'row', paddingTop: 2.5 }}>
          {columnas.map((c, j) => (
            <Text
              key={`td-${i}-${c}`}
              hyphenationCallback={SIN_GUION}
              style={{
                fontSize: 7.5,
                color: c === 'sentido' ? color : NEGRO,
                fontFamily: c === 'sentido' ? 'Helvetica-Bold' : 'Helvetica',
                width: ancho(c),
                // La última no lleva canal: el aire va ENTRE columnas, y restárselo a la
                // de la derecha solo le quitaría ancho contra el borde de la tarjeta.
                paddingRight: j === columnas.length - 1 ? 0 : CANAL_COLUMNA,
              }}
            >
              {t[c] ?? ''}
            </Text>
          ))}
        </View>
      ))}
    </View>
  )
}

/** El precio de un pasajero de cada tipo, en una línea. */
function PorPasajero({ precios, color }: { precios: PrecioPorPasajeroPDF; color: string }) {
  if (!precios || precios.length === 0) return null
  return (
    <Text style={{ fontSize: 7, color, marginTop: 2 }}>
      {precios.map(p => `${NOMBRE_PASAJERO[p.tipo]} ${pesos(p.precioUnitario)}`).join('  ·  ')}
    </Text>
  )
}

/** Una línea de dinero ya resuelta: lo que se imprime en «Inversión». */
interface LineaImpresa {
  nombre: string
  cantidad: number
  unidad?: string | null
  adicionales?: string[]
  precioPorPasajero?: PrecioPorPasajeroPDF
  total: number
}

/**
 * De las líneas que llegan a las que se imprimen.
 *
 * ⚠️ El adicional entra en el total de SU línea. `precio_venta` es el precio BASE de la
 * variante: sin este sumando, la columna que el cliente suma quedaría por debajo del
 * TOTAL, que sí los incluye. Ausente vale 0 — una cotización sin adicionales imprime
 * exactamente lo mismo que antes.
 */
function lineasImpresas(
  items: { nombre: string; precio_venta: number; descuento_porcentaje: number; cantidad: number; unidad?: string | null; adicionales?: string[]; valorAdicionales?: number; precioPorPasajero?: PrecioPorPasajeroPDF }[],
): LineaImpresa[] {
  return items.map(i => {
    const cantidad = i.cantidad ?? 1
    const base = Math.round(i.precio_venta * cantidad * (1 - (i.descuento_porcentaje || 0) / 100))
    return {
      nombre: i.nombre,
      cantidad,
      unidad: i.unidad,
      adicionales: i.adicionales,
      precioPorPasajero: i.precioPorPasajero,
      total: base + (i.valorAdicionales ?? 0),
    }
  })
}

/**
 * Una fila de «Inversión»: el concepto a la izquierda, su total a la derecha.
 *
 * ⚠️ `minPresenceAhead` reserva el alto de la franja de totales. Sin él la última fila se
 * queda al pie de una página y el TOTAL aparece solo arriba de la siguiente, separado de
 * la tabla que lo produce — el defecto que el brief describe como «una franja suelta».
 * Con esto, la fila que no deje sitio para el total se va con él a la página siguiente.
 */
function LineaPrecio({ l, detallada }: { l: LineaImpresa; detallada: boolean }) {
  return (
    <View
      wrap={false}
      minPresenceAhead={ALTO_TOTALES}
      style={{
        flexDirection: 'row',
        justifyContent: 'space-between',
        borderBottomWidth: 0.5,
        borderBottomColor: GRIS_BORDE,
        paddingVertical: 3,
      }}
    >
      <View style={{ flex: 1, paddingRight: 8 }}>
        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: NEGRO }}>
          {l.nombre}
          {l.cantidad > 1 ? `  ×${l.cantidad}${l.unidad ? ` ${l.unidad}` : ''}` : ''}
        </Text>
        {/* Los adicionales, DENTRO de la línea (§1.2): *«que me lo muestre todo junto»*.
            Sin cifra propia —el dinero del documento se imprime una vez y ya está en el
            total de la derecha—, pero con nombre: un cargo que sube el precio y no aparece
            en ninguna parte es lo que este renglón existe para que no pase.
            Sale en los TRES niveles de detalle: es plata que el cliente paga, y el nivel
            recorta descripción, nunca obligaciones. */}
        {(l.adicionales?.length ?? 0) > 0 && (
          <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7, color: GRIS_ETIQUETA, marginTop: 1 }}>
            {`Incluye: ${l.adicionales!.join(' · ')}`}
          </Text>
        )}
        {detallada && <PorPasajero precios={l.precioPorPasajero ?? null} color={GRIS_ETIQUETA} />}
      </View>
      <Text style={{ fontSize: 8.5, color: NEGRO }}>{pesos(l.total)}</Text>
    </View>
  )
}

/**
 * Una foto por ciudad del viaje, con su rótulo debajo, como en los itinerarios de
 * referencia (`MADRID · EDIFICIO METRÓPOLIS`).
 *
 * El rótulo va DEBAJO y en gris, no encima de la foto: así se lee igual sobre cualquier
 * imagen. La franja no se parte entre páginas (`wrap={false}`): media foto al pie y la
 * otra mitad arriba es exactamente el aspecto de un documento roto. Sin fotos, no existe.
 */
function FotosCiudades({ fotos }: { fotos: FotoPDF[] }) {
  if (fotos.length === 0) return null
  // Una sola foto a lo ancho sería otra portada: se limita al alto de la franja.
  const alto = fotos.length === 1 ? 150 : fotos.length === 2 ? 130 : 105
  return (
    <View wrap={false} style={{ flexDirection: 'row', marginTop: 14 }}>
      {fotos.map((f, i) => (
        <View
          key={`foto-${i}`}
          style={{ flexGrow: 1, flexBasis: 0, marginLeft: i === 0 ? 0 : 6 }}
        >
          <PdfImage src={f.url} style={{ width: '100%', height: alto, objectFit: 'cover' }} />
          {f.rotulo && (
            <Text style={{ fontSize: 6.5, color: GRIS_ETIQUETA, letterSpacing: 1, marginTop: 3 }}>
              {f.rotulo.toUpperCase()}
            </Text>
          )}
        </View>
      ))}
    </View>
  )
}

/** Lo que mide la franja de totales, para que ninguna fila la deje huérfana. */
const ALTO_TOTALES = 70

export default function CotizacionTrappvelPDF({
  cotizacion,
  empresa,
  vendedor,
  items,
  itinerarios,
  dias,
  sugeridos,
  preciosPorPasajero,
  fiscal,
  negocio,
  emisor,
  viaje,
}: CotizacionPDFProps) {
  const v = viaje ?? VIAJE_VACIO
  const acento = vendedor.color_primario || '#1A1A1A'
  const detallada = v.nivelDetalle === 'muy_detallada'
  const general = v.nivelDetalle === 'general'

  const titulo = (negocio?.nombre ?? cotizacion.descripcion ?? 'Propuesta de viaje').trim()
  const bloquesDia = (dias ?? []).filter(d => d.items.length > 0)
  const opcionales = sugeridos ?? []

  // Lo que el cliente paga: la MISMA lista que alimenta el Subtotal. Ver decisión 2.
  const lineas = lineasImpresas(items)
  const subtotal = lineas.reduce((a, l) => a + l.total, 0)
  const iva = fiscal?.iva ?? 0
  const total = fiscal?.totalBruto ?? subtotal + iva

  /**
   * R7 · las TRES tarifas que van en la propuesta: Económica, Recomendada y Premium.
   *
   * Esta plantilla recibía `itinerarios` desde que existe y **no lo consumía**: la palabra
   * aparecía dos veces en el archivo y las dos eran comentarios. Encenderla para Trappvel
   * fue lo que perdió las tres opciones — antes del 21-sep una cotización salía con la
   * plantilla genérica, que sí las imprime (R7). Esto lo repone con la MISMA forma que la
   * genérica: no hay dos maneras de mostrar lo mismo.
   *
   * ⚠️ Cada bloque imprime SU combinación, no el abanico: una variante que no entró en
   * ninguna tarifa no aparece. Lo que hace comparables a las tres es que cada una sea una
   * propuesta cerrada con su propio precio.
   *
   * ⚠️ La RECOMENDADA va primera por ser la principal, no por precio: el orden lo fija
   * `bloquesParaPDF` y es la única cuyo total coincide con el TOTAL de abajo (R5).
   *
   * Con UNA sola tarifa o ninguna esto queda vacío y el documento se comporta exactamente
   * como hoy: un cliente con una sola opción no necesita que se la presenten como una
   * elección entre varias. El corte es que el arreglo no llegue, no un flag.
   */
  const bloques = (itinerarios ?? []).map((it, i) => ({
    titulo: tituloDeBloquePDF(it.nombre, it.esPrincipal, i + 1),
    precio: it.precio,
    lineas: lineasImpresas(it.items),
  }))
  const porTarifas = bloques.length > 1

  /**
   * Lo que la tabla por pasajero NO explica, para que el documento no muestre dos cifras
   * que no cierran una debajo de la otra (§0.1 del brief).
   *
   * `cubierto` es lo que suma la columna por pasajero. La diferencia contra el TOTAL se
   * imprime con nombre —el hotel que se cobra por el grupo, la maleta extra— y **cierra
   * por construcción**, porque sale de restar, no de volver a sumar. Lo que no se hace es
   * repartir esa diferencia entre los viajeros: una maleta la compra alguien concreto y
   * prorratearla sería inventar quién paga qué.
   */
  const cubierto = preciosPorPasajero?.cubierto ?? null
  const porElGrupo = cubierto === null ? null : total - cubierto

  /**
   * El «no incluye»: lo que el viajero paga aparte.
   *
   * Sale de hechos que el documento ya tiene —los cargos en destino y la existencia de
   * opcionales—, no de una lista genérica de exclusiones: nadie la escribió y afirmarla
   * en nombre de la agencia sería inventar una condición comercial.
   */
  const noIncluye = [
    ...v.cargosEnDestino.map(c => `${c.concepto}${c.ciudad ? ` (${c.ciudad})` : ''}, que se pagan en destino`),
    ...(opcionales.length > 0 ? ['Las actividades opcionales listadas al final de este documento'] : []),
  ]

  const pie = v.pie ?? [vendedor.nombre, vendedor.email, vendedor.telefono, vendedor.ciudad].filter(Boolean).join(' · ')
  const firma = v.firma ?? (emisor ? { nombre: emisor.nombre, cargo: emisor.cargo, contacto: null } : null)

  // Las fotos las elige `fotos-del-viaje.ts` (máximo cuatro, portada incluida). Aquí solo
  // se imprimen, y los créditos salen de las MISMAS que se imprimen.
  const fotosCiudades = v.fotosCiudades ?? []
  const creditos = creditosDeFotos([v.foto, ...fotosCiudades])

  const fichas: { etiqueta: string; valor: string }[] = []
  if (v.viajeros) fichas.push({ etiqueta: 'VIAJEROS', valor: v.viajeros })
  if (v.destino) fichas.push({ etiqueta: 'DESTINO', valor: v.destino })
  if (v.fechas) fichas.push({ etiqueta: 'FECHA', valor: v.fechas })
  if (v.duracion) fichas.push({ etiqueta: 'DURACIÓN', valor: v.duracion })

  return (
    <Document>
      <Page
        size="A4"
        style={{ paddingTop: 0, paddingBottom: 46, fontFamily: 'Helvetica', color: NEGRO }}
      >
        {/* ── Portada ─────────────────────────────────────────────────
            El hueco de la foto (decisión 1): con foto va la imagen y su rótulo; sin
            foto, la banda del color de la marca con el logo. Nunca un recuadro vacío.

            El título va DEBAJO de la banda y no encima de la imagen: sobreponerlo exige
            una capa translúcida, y un texto blanco sobre una foto que nadie revisó puede
            quedar ilegible. Debajo se lee igual con foto y sin ella. */}
        <View style={{ height: 150, backgroundColor: acento, justifyContent: 'center', alignItems: 'center' }}>
          {v.foto && (
            <PdfImage
              src={v.foto.url}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: 150, objectFit: 'cover' }}
            />
          )}
          {!v.foto && vendedor.logo_url && (
            <PdfImage src={vendedor.logo_url} style={{ width: 120, height: 52, objectFit: 'contain' }} />
          )}
          {/* Sin foto y sin logo la banda quedaba siendo un rectángulo de color vacío.
              El nombre del vendedor la convierte en una portada. */}
          {!v.foto && !vendedor.logo_url && (
            <Text style={{ fontSize: 20, fontFamily: 'Helvetica-Bold', color: BLANCO, letterSpacing: 2 }}>
              {(vendedor.razon_social ?? vendedor.nombre).toUpperCase()}
            </Text>
          )}
          {/* El rótulo lleva un respaldo oscuro: blanco a secas sobre el cielo o la arena
              de una foto que nadie revisó queda ilegible. */}
          {v.foto?.rotulo && (
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                backgroundColor: 'rgba(0,0,0,0.45)',
                paddingVertical: 3,
                paddingHorizontal: 8,
              }}
            >
              <Text style={{ fontSize: 6.5, color: BLANCO, letterSpacing: 1 }}>
                {v.foto.rotulo.toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={{ paddingHorizontal: 40, paddingTop: 12 }}>
          <Text
            hyphenationCallback={SIN_GUION}
            style={{ fontSize: 17, fontFamily: 'Helvetica-Bold', color: NEGRO, letterSpacing: 0.4 }}
          >
            {titulo.toUpperCase()}
          </Text>
          <Text style={{ fontSize: 8.5, color: GRIS_ETIQUETA, marginTop: 3, marginBottom: 10 }}>
            {[empresa.contacto_nombre, empresa.nombre].filter(Boolean).join(' · ') || 'Propuesta de viaje'}
          </Text>
        </View>

        {/* Las cuatro fichas de la portada. Solo las que tienen dato (decisión 1). */}
        {fichas.length > 0 && (
          <View
            style={{
              flexDirection: 'row',
              backgroundColor: GRIS_FONDO,
              paddingVertical: 8,
              marginHorizontal: 40,
              marginTop: -1,
            }}
          >
            {fichas.map(f => (
              <Ficha key={f.etiqueta} etiqueta={f.etiqueta} valor={f.valor} color={acento} />
            ))}
          </View>
        )}

        <View style={{ paddingHorizontal: 40, paddingTop: 4 }}>
          {/* ── Párrafo del destino ──────────────────────────────────── */}
          {v.presentacion && (
            <Text
              hyphenationCallback={SIN_GUION}
              style={{ fontSize: 8.5, color: GRIS_TEXTO, lineHeight: 1.5, marginTop: 14 }}
            >
              {v.presentacion}
            </Text>
          )}

          {/* ── Una foto por ciudad del viaje ─────────────────────────── */}
          <FotosCiudades fotos={fotosCiudades} />

          {/* ── Vuelos ───────────────────────────────────────────────── */}
          {v.vuelos.length > 0 && (
            <>
              <Titulo texto="Vuelos" color={acento} />
              <View>
              {v.vuelos.map((vu, i) => {
                // ⚠️ La flecha «→» NO existe en la codificación de las fuentes estándar
                // del PDF: se vio impresa como un apóstrofo («Cúcuta CUC ’Armenia AXM»)
                // mirando la página, no en ninguna prueba. La raya larga sí existe.
                const trayectos = trayectosDelVuelo(vu)
                return (
                  <View
                    key={`vuelo-${i}`}
                    wrap={false}
                    style={{
                      borderWidth: 0.5,
                      borderColor: GRIS_BORDE,
                      padding: 7,
                      marginBottom: 5,
                    }}
                  >
                    {/* La AEROLÍNEA encabeza la tarjeta en vez de repetirse en cada fila:
                        es la primera columna de la referencia y en nuestra tabla los dos
                        trayectos son de la misma. */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                        {vu.aerolinea ?? vu.linea}
                      </Text>
                    </View>
                    <TablaTrayectos trayectos={trayectos} color={acento} />
                    {!general && vu.tarifa && <MetaVuelo etiqueta="Tarifa" valor={vu.tarifa} />}
                    {!general && vu.equipaje && <MetaVuelo etiqueta="Equipaje" valor={vu.equipaje} />}
                    {/* §1.2 · el adicional va DENTRO del vuelo, no como item aparte:
                        *«mantener dentro de cada bloque todo el hilo de variables»*.
                        Sale en los TRES niveles —incluido el general— porque es plata que
                        el cliente paga, y el nivel recorta descripcion, nunca
                        obligaciones (decision 3 de la cabecera). Sin cifra: el dinero
                        vive en «Inversion» y se imprime una sola vez. */}
                    {vu.adicionales.length > 0 && (
                      <MetaVuelo etiqueta="Adicionales" valor={vu.adicionales.join(' · ')} />
                    )}
                  </View>
                )
              })}
              </View>
            </>
          )}

          {/* ── Hoteles ──────────────────────────────────────────────── */}
          {v.hoteles.length > 0 && (
            <>
              <Titulo texto={v.hoteles.length > 1 ? 'Alojamiento' : 'Hotel'} color={acento} />
              <View>
              {v.hoteles.map((h, i) => (
                <View
                  key={`hotel-${i}`}
                  wrap={false}
                  style={{ borderWidth: 0.5, borderColor: GRIS_BORDE, padding: 7, marginBottom: 5 }}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                      {h.hotel ?? h.linea}
                      {/* Las estrellas van en palabras: las fuentes estándar del PDF no
                          traen el glifo ★, y un carácter que la fuente no tiene se
                          imprime como un hueco. Hoy nunca entra (ver `HotelPDF`). */}
                      {h.estrellas ? ` · ${h.estrellas} estrellas` : ''}
                    </Text>
                    {h.ciudad && (
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: acento }}>{h.ciudad}</Text>
                    )}
                  </View>
                  {(h.checkIn || h.checkOut) && (
                    <Dato
                      etiqueta="Fechas"
                      valor={[h.checkIn, h.checkOut].filter(Boolean).join(' – ')
                        + (h.noches ? ` (${h.noches} ${h.noches === 1 ? 'noche' : 'noches'})` : '')}
                    />
                  )}
                  {!general && h.habitacion && <Dato etiqueta="Habitación" valor={h.habitacion} />}
                  {!general && h.regimen && <Dato etiqueta="Plan" valor={h.regimen} />}
                  {!general && h.ocupacion && <Dato etiqueta="Acomodación" valor={h.ocupacion} />}
                  {/* ⚠️ La política de cancelación estaba condicionada a «muy detallada»,
                      y ese nivel es INERTE: su bloque sigue oculto, así que todo sale en
                      «normal» y la política NO se imprimía nunca. §2.4 de la referencia la
                      lista dentro de la ficha del hotel. Pasa a `!general`, igual que
                      habitación, plan y acomodación: una tarifa no reembolsable es una
                      condición que el cliente tiene que conocer ANTES de pagar. */}
                  {!general && h.cancelacion && <Dato etiqueta="Cancelación" valor={h.cancelacion} />}
                  {h.localizador && <Dato etiqueta="Localizador" valor={h.localizador} />}
                  {/* Ver la nota del vuelo: el adicional vive dentro de su bloque. */}
                  {h.adicionales.length > 0 && (
                    <Dato etiqueta="Adicionales" valor={h.adicionales.join(' · ')} />
                  )}
                </View>
              ))}
              </View>
            </>
          )}

          {/* ── Día a día ────────────────────────────────────────────── */}
          {bloquesDia.length > 0 && (
            <>
              <Titulo texto="Día a día" color={acento} />
              <View>
              {bloquesDia.map(d => (
                <View key={`dia-${d.dia}`} wrap={false} style={{ marginBottom: 6, flexDirection: 'row' }}>
                  <View style={{ width: 46, paddingTop: 1 }}>
                    <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: acento, letterSpacing: 0.5 }}>
                      {`DÍA ${d.dia}`}
                    </Text>
                  </View>
                  <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: GRIS_BORDE, paddingLeft: 8 }}>
                    {d.items.map((it, i) => (
                      <View key={`dia-${d.dia}-${i}`} style={{ marginBottom: 2 }}>
                        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: NEGRO }}>
                          {it.nombre}
                        </Text>
                        {detallada && it.descripcion && (
                          <Text
                            hyphenationCallback={SIN_GUION}
                            style={{ fontSize: 7.5, color: GRIS_TEXTO, marginTop: 1 }}
                          >
                            {it.descripcion}
                          </Text>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              ))}
              </View>
            </>
          )}

          {/* ── Incluye / No incluye ─────────────────────────────────── */}
          {(lineas.length > 0 || noIncluye.length > 0) && (
            <View wrap={false}>
              <Titulo texto="Incluye / no incluye" color={acento} />
              <View style={{ flexDirection: 'row' }}>
                <View style={{ flex: 1, paddingRight: 10 }}>
                  {lineas.map((l, i) => (
                    <Text
                      key={`incluye-${i}`}
                      hyphenationCallback={SIN_GUION}
                      style={{ fontSize: 8, color: NEGRO, marginBottom: 2 }}
                    >
                      {`•  ${l.nombre}`}
                    </Text>
                  ))}
                </View>
                <View style={{ flex: 1, paddingLeft: 10, borderLeftWidth: 0.5, borderLeftColor: GRIS_BORDE }}>
                  {noIncluye.length === 0 && (
                    <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA }}>
                      Todo lo listado en este documento está incluido en el precio.
                    </Text>
                  )}
                  {noIncluye.map((n, i) => (
                    <Text
                      key={`noincluye-${i}`}
                      hyphenationCallback={SIN_GUION}
                      style={{ fontSize: 8, color: GRIS_TEXTO, marginBottom: 2 }}
                    >
                      {`×  ${n}`}
                    </Text>
                  ))}
                </View>
              </View>
            </View>
          )}

          {/* ── Inversión ────────────────────────────────────────────────
              Todo el dinero del documento vive aquí (decisión 2). En el nivel general
              se imprime el total y el precio por pasajero, sin el detalle por línea. */}
          <>
            <Titulo texto="Inversión" color={acento} />
            <View>
            {/* R7 · con tres tarifas, un bloque por cada una: su nombre, su precio y sus
                líneas. La RECOMENDADA primero. Sin ellas (o con una sola) se imprime la
                lista plana de siempre — el corte es que el arreglo no llegue.

                ⚠️ El encabezado de cada tarifa sale en los TRES niveles de detalle: el
                nombre y el precio de cada opción SON la oferta, y el nivel recorta
                descripción, nunca lo que el cliente tiene que decidir. Lo que el nivel
                general sí recorta es el desglose línea por línea. */}
            {porTarifas ? (
              <View>
                {bloques.map((b, i) => (
                  <View key={`tarifa-${i}`} style={{ marginBottom: 8 }} wrap={false} minPresenceAhead={ALTO_TOTALES}>
                    <View
                      style={{
                        flexDirection: 'row',
                        justifyContent: 'space-between',
                        backgroundColor: GRIS_FONDO,
                        paddingVertical: 3.5,
                        paddingHorizontal: 5,
                      }}
                    >
                      <Text
                        hyphenationCallback={SIN_GUION}
                        style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: acento, letterSpacing: 0.8 }}
                      >
                        {b.titulo.toUpperCase()}
                      </Text>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>{pesos(b.precio)}</Text>
                    </View>
                    {!general && b.lineas.map((l, j) => (
                      <LineaPrecio key={`tarifa-${i}-linea-${j}`} l={l} detallada={detallada} />
                    ))}
                  </View>
                ))}
                {/* Sin esta línea el cliente ve tres precios y un total, y no sabe cuál
                    está aceptando. El de abajo es el de la recomendada: es el que
                    `recalcularTotales` guardó en `valor_total` (R5). */}
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, marginTop: 2 }}>
                  El total de abajo corresponde a la opción recomendada. Las demás son alternativas
                  con el precio indicado en su encabezado.
                </Text>
              </View>
            ) : (
              !general && (
                <View>
                  {lineas.map((l, i) => (
                    <LineaPrecio key={`precio-${i}`} l={l} detallada={detallada} />
                  ))}
                </View>
              )
            )}

            {/* ⚠️ `wrap={false}`: sin esto el bloque del TOTAL se parte entre dos páginas
                y la franja queda cortada a media altura contra el pie — visto en la
                página, no en una prueba. El total no se puede imprimir a medias. */}
            <View wrap={false} style={{ marginTop: 6, alignSelf: 'flex-end', width: '55%' }}>
              {!general && iva > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                  <Text style={{ fontSize: 8, color: GRIS_ETIQUETA }}>Subtotal</Text>
                  <Text style={{ fontSize: 8, color: NEGRO }}>{pesos(subtotal)}</Text>
                </View>
              )}
              {iva > 0 && (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                  <Text style={{ fontSize: 8, color: GRIS_ETIQUETA }}>IVA</Text>
                  <Text style={{ fontSize: 8, color: NEGRO }}>{pesos(iva)}</Text>
                </View>
              )}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  backgroundColor: acento,
                  paddingVertical: 5,
                  paddingHorizontal: 7,
                  marginTop: 3,
                }}
              >
                <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: BLANCO }}>TOTAL</Text>
                <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: BLANCO }}>{pesos(total)}</Text>
              </View>
            </View>

            {/* ── Precio por tipo de pasajero, del viaje entero (§4 del diseño) ──
                ⚠️⚠️ Esta tabla y el TOTAL de arriba son dinero del MISMO viaje, y hasta el
                2026-09-22 se imprimían como dos hechos sueltos que nadie reconciliaba. En
                la prueba real de Providencia la suma por pasajero daba 13.861.000 contra
                un total de 14.221.000, y los 360.000 de diferencia eran el equipaje de
                bodega adicional, que se suma a la línea pero no al reparto.

                La diferencia se imprime, con nombre, y **cierra por construcción** porque
                sale de restar el total: Σ por pasajero + lo del grupo = TOTAL. Lo que NO
                se hace es repartir esa diferencia entre los viajeros — una maleta la
                compra alguien concreto y prorratearla inventaría quién paga qué. */}
            {preciosPorPasajero && preciosPorPasajero.filas.length > 0 && (
              <View wrap={false} style={{ marginTop: 10, backgroundColor: GRIS_FONDO, padding: 8 }}>
                <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA, letterSpacing: 0.8, marginBottom: 3 }}>
                  PRECIO POR PASAJERO
                </Text>
                {preciosPorPasajero.filas.map(f => (
                  <View
                    key={`pax-${f.tipo}`}
                    style={{ flexDirection: 'row', alignItems: 'flex-end', paddingVertical: 1.5 }}
                  >
                    <Text style={{ fontSize: 8.5, color: NEGRO, flex: 1 }}>
                      {NOMBRE_PASAJERO[f.tipo]}
                      {/* El «×6» es lo que permite al cliente rehacer la cuenta. Solo se
                          escribe cuando todas las líneas coinciden en cuántos son: con un
                          vuelo para 6 y un hotel para 4, multiplicar por cualquiera de los
                          dos daría un subtotal que no es el de nadie. */}
                      {f.cantidad !== null && f.cantidad > 1 ? `  ×${f.cantidad}` : ''}
                    </Text>
                    {/* ⚠️ El «c/u» y el subtotal a la derecha existen porque «Adulto ×6 …
                        $1.170.000» se lee igual de bien como «seis adultos cuestan
                        1.170.000», que es falso. Con las dos cifras separadas la columna
                        de la derecha SUMA el total y la ambigüedad desaparece. */}
                    {f.cantidad !== null && f.cantidad > 1 && (
                      <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA, paddingRight: 10 }}>
                        {`${pesos(f.precioUnitario)} c/u`}
                      </Text>
                    )}
                    <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                      {pesos(f.cantidad !== null && f.cantidad > 1 ? f.precioUnitario * f.cantidad : f.precioUnitario)}
                    </Text>
                  </View>
                ))}
                {porElGrupo !== null && porElGrupo !== 0 && (
                  <View
                    style={{
                      flexDirection: 'row',
                      justifyContent: 'space-between',
                      paddingTop: 3,
                      marginTop: 2,
                      borderTopWidth: 0.5,
                      borderTopColor: GRIS_BORDE,
                    }}
                  >
                    <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: GRIS_TEXTO, flex: 1, paddingRight: 10 }}>
                      {preciosPorPasajero.sinReparto.length > 0
                        ? `Se cobra por el grupo: ${preciosPorPasajero.sinReparto.join(', ')}`
                        : 'Se cobra por el grupo'}
                    </Text>
                    <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NEGRO }}>{pesos(porElGrupo)}</Text>
                  </View>
                )}
                {/* Sin `cubierto` no se puede afirmar que la columna sume el total: se dice,
                    en vez de dejar dos cifras que no cierran una debajo de la otra. */}
                {porElGrupo === null && preciosPorPasajero.sinReparto.length > 0 && (
                  <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7, color: GRIS_ETIQUETA, marginTop: 3 }}>
                    {`No incluye lo que se cobra por el grupo: ${preciosPorPasajero.sinReparto.join(', ')}.`}
                  </Text>
                )}
                {porElGrupo === null && preciosPorPasajero.sinReparto.length === 0 && (
                  <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, marginTop: 3 }}>
                    Es el precio de cada viajero; no suma el total de arriba.
                  </Text>
                )}
              </View>
            )}

            {cotizacion.condiciones_pago && (
              <Text style={{ fontSize: 7.5, color: GRIS_TEXTO, marginTop: 8 }}>
                {`Forma de pago: ${cotizacion.condiciones_pago}`}
              </Text>
            )}
            </View>
          </>

          {/* ── Opcionales ───────────────────────────────────────────── */}
          {opcionales.length > 0 && (
            <>
              <Titulo texto="Opcionales" color={acento} />
              <View>
              <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA, marginBottom: 4 }}>
                Actividades que se pueden coordinar aparte. No están incluidas en el precio de arriba.
              </Text>
              {opcionales.map((o, i) => {
                const valor = Math.round((o.precio_venta || 0) * (o.cantidad ?? 1))
                return (
                  <View
                    key={`opcional-${i}`}
                    wrap={false}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}
                  >
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8.5, color: NEGRO }}>
                        {o.nombre}
                      </Text>
                      {!general && o.descripcion && (
                        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: GRIS_TEXTO }}>
                          {o.descripcion}
                        </Text>
                      )}
                    </View>
                    {valor > 0 && (
                      <Text style={{ fontSize: 8.5, color: GRIS_TEXTO }}>
                        {`${pesos(valor)}${o.unidad ? ` / ${o.unidad}` : ''}`}
                      </Text>
                    )}
                  </View>
                )
              })}
              </View>
            </>
          )}

          {/* ── Cargos en destino ────────────────────────────────────────
              Plata del viajero: sale en los TRES niveles de detalle (decisión 3). */}
          {v.cargosEnDestino.length > 0 && (
            <View wrap={false}>
              <Titulo texto="Cargos a pagar en destino" color={acento} />
              <View style={{ flexDirection: 'row', backgroundColor: GRIS_FONDO, paddingVertical: 3, paddingHorizontal: 5 }}>
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, width: '22%' }}>CIUDAD</Text>
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, width: '33%' }}>CONCEPTO</Text>
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, width: '20%' }}>VALOR APROX.</Text>
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, width: '25%' }}>OBSERVACIÓN</Text>
              </View>
              {v.cargosEnDestino.map((c, i) => (
                <View
                  key={`cargo-${i}`}
                  wrap={false}
                  style={{
                    flexDirection: 'row',
                    paddingVertical: 3,
                    paddingHorizontal: 5,
                    borderBottomWidth: 0.5,
                    borderBottomColor: GRIS_BORDE,
                  }}
                >
                  <Text style={{ fontSize: 7.5, color: NEGRO, width: '22%' }}>{c.ciudad ?? ''}</Text>
                  <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: NEGRO, width: '33%' }}>
                    {c.concepto}
                  </Text>
                  <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: NEGRO, width: '20%' }}>
                    {c.monto}
                  </Text>
                  <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7, color: GRIS_TEXTO, width: '25%' }}>
                    {c.observacion}
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* ── Información importante ───────────────────────────────── */}
          {cotizacion.notas && (
            <View wrap={false}>
              <Titulo texto="Información importante" color={acento} />
              <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 7.5, color: GRIS_TEXTO, lineHeight: 1.4 }}>
                {cotizacion.notas}
              </Text>
            </View>
          )}

          {/* ── Firma ────────────────────────────────────────────────── */}
          {firma && (
            <View wrap={false} style={{ marginTop: 22, alignItems: 'center' }}>
              <Text style={{ fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                {firma.nombre}
              </Text>
              {firma.cargo && (
                <Text style={{ fontSize: 8, color: GRIS_ETIQUETA, marginTop: 1 }}>{firma.cargo}</Text>
              )}
              {firma.contacto && (
                <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA, marginTop: 1 }}>{firma.contacto}</Text>
              )}
            </View>
          )}
          {/* ── Créditos de las fotos ────────────────────────────────────
              Sin crédito, la licencia de casi todas (CC BY / BY-SA) no se cumple. Solo
              las que se imprimieron, y la línea no existe si no hubo ninguna. */}
          {creditos.length > 0 && (
            <Text
              hyphenationCallback={SIN_GUION}
              style={{ fontSize: 6, color: GRIS_ETIQUETA, marginTop: 18, lineHeight: 1.4 }}
            >
              {`Fotografías: ${creditos.join(' · ')}`}
            </Text>
          )}
        </View>

        {/* ── Pie de marca, en todas las páginas ───────────────────────── */}
        <View
          fixed
          style={{
            position: 'absolute',
            bottom: 20,
            left: 40,
            right: 40,
            borderTopWidth: 0.5,
            borderTopColor: GRIS_BORDE,
            paddingTop: 5,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 6.5, color: GRIS_ETIQUETA }}>{pie}</Text>
          <Text style={{ fontSize: 6.5, color: GRIS_ETIQUETA }}>{cotizacion.consecutivo}</Text>
          <Text
            style={{ fontSize: 6.5, color: GRIS_ETIQUETA }}
            render={({ pageNumber, totalPages }) => `${pageNumber} de ${totalPages}`}
          />
        </View>
      </Page>
    </Document>
  )
}
