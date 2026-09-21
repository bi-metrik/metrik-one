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
 * manda es la foto de portada, que **hoy llega siempre `null`** porque el banco de fotos
 * por ciudad no está construido: donde iría la foto va una banda con el color y el logo
 * de la marca, que es una portada legítima y no un hueco.
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
import type { PrecioPorPasajeroPDF } from './cotizacion-props'
import { partirPalabraLarga } from '@/lib/cotizaciones/condiciones-comerciales'

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

function Titulo({ texto, color }: { texto: string; color: string }) {
  return (
    <View style={{ marginTop: 16, marginBottom: 6, borderBottomWidth: 1.2, borderBottomColor: color, paddingBottom: 3 }}>
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

/** El precio de un pasajero de cada tipo, en una línea. */
function PorPasajero({ precios, color }: { precios: PrecioPorPasajeroPDF; color: string }) {
  if (!precios || precios.length === 0) return null
  return (
    <Text style={{ fontSize: 7, color, marginTop: 2 }}>
      {precios.map(p => `${NOMBRE_PASAJERO[p.tipo]} ${pesos(p.precioUnitario)}`).join('  ·  ')}
    </Text>
  )
}

export default function CotizacionTrappvelPDF({
  cotizacion,
  empresa,
  vendedor,
  items,
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
  const lineas = items.map(i => {
    const cantidad = i.cantidad ?? 1
    const total = Math.round(i.precio_venta * cantidad * (1 - (i.descuento_porcentaje || 0) / 100))
    return { ...i, cantidad, total }
  })
  const subtotal = lineas.reduce((a, l) => a + l.total, 0)
  const iva = fiscal?.iva ?? 0
  const total = fiscal?.totalBruto ?? subtotal + iva

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
          {v.foto?.rotulo && (
            <Text
              style={{ position: 'absolute', bottom: 6, right: 12, fontSize: 6.5, color: BLANCO, letterSpacing: 1 }}
            >
              {v.foto.rotulo.toUpperCase()}
            </Text>
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

          {/* ── Vuelos ───────────────────────────────────────────────── */}
          {v.vuelos.length > 0 && (
            <View>
              <Titulo texto="Vuelos" color={acento} />
              {v.vuelos.map((vu, i) => {
                // ⚠️ La flecha «→» NO existe en la codificación de las fuentes estándar
                // del PDF: se vio impresa como un apóstrofo («Cúcuta CUC ’Armenia AXM»)
                // mirando la página, no en ninguna prueba. La raya larga sí existe.
                const ruta = [vu.origen, vu.destino].filter(Boolean).join(' – ')
                const fechas = [vu.fechaSalida, vu.fechaRegreso].filter(Boolean).join(' · ')
                const escalaIda = vu.escalaIda
                  ? `Escala en ${vu.escalaIda}`
                  : vu.escalas === 0
                    ? 'Vuelo directo'
                    : null
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
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                        {vu.aerolinea ?? vu.linea}
                      </Text>
                      {ruta !== '' && (
                        <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: acento }}>{ruta}</Text>
                      )}
                    </View>
                    {fechas !== '' && <Dato etiqueta="Fechas" valor={fechas} />}
                    {vu.numeroVuelo && <Dato etiqueta="Nº de vuelo" valor={vu.numeroVuelo} />}
                    {escalaIda && <Dato etiqueta="Ida" valor={escalaIda} />}
                    {vu.escalaRegreso && <Dato etiqueta="Regreso" valor={`Escala en ${vu.escalaRegreso}`} />}
                    {!general && vu.tarifa && <Dato etiqueta="Tarifa" valor={vu.tarifa} />}
                    {!general && vu.equipaje && <Dato etiqueta="Equipaje" valor={vu.equipaje} />}
                  </View>
                )
              })}
            </View>
          )}

          {/* ── Hoteles ──────────────────────────────────────────────── */}
          {v.hoteles.length > 0 && (
            <View>
              <Titulo texto={v.hoteles.length > 1 ? 'Alojamiento' : 'Hotel'} color={acento} />
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
                  {detallada && h.cancelacion && <Dato etiqueta="Cancelación" valor={h.cancelacion} />}
                  {h.localizador && <Dato etiqueta="Localizador" valor={h.localizador} />}
                </View>
              ))}
            </View>
          )}

          {/* ── Día a día ────────────────────────────────────────────── */}
          {bloquesDia.length > 0 && (
            <View>
              <Titulo texto="Día a día" color={acento} />
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
          <View>
            <Titulo texto="Inversión" color={acento} />
            {!general && (
              <View>
                {lineas.map((l, i) => (
                  <View
                    key={`precio-${i}`}
                    wrap={false}
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
                      {detallada && <PorPasajero precios={l.precioPorPasajero ?? null} color={GRIS_ETIQUETA} />}
                    </View>
                    <Text style={{ fontSize: 8.5, color: NEGRO }}>{pesos(l.total)}</Text>
                  </View>
                ))}
              </View>
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

            {/* Precio por tipo de pasajero, del viaje entero (§4 del diseño). */}
            {preciosPorPasajero && preciosPorPasajero.filas.length > 0 && (
              <View wrap={false} style={{ marginTop: 10, backgroundColor: GRIS_FONDO, padding: 8 }}>
                <Text style={{ fontSize: 7.5, color: GRIS_ETIQUETA, letterSpacing: 0.8, marginBottom: 3 }}>
                  PRECIO POR PASAJERO
                </Text>
                {preciosPorPasajero.filas.map(f => (
                  <View
                    key={`pax-${f.tipo}`}
                    style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 1.5 }}
                  >
                    <Text style={{ fontSize: 8.5, color: NEGRO }}>{NOMBRE_PASAJERO[f.tipo]}</Text>
                    <Text style={{ fontSize: 8.5, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                      {pesos(f.precioUnitario)}
                    </Text>
                  </View>
                ))}
                {preciosPorPasajero.sinReparto.length > 0 && (
                  <Text style={{ fontSize: 7, color: GRIS_ETIQUETA, marginTop: 3 }}>
                    {`No incluye lo que se cobra por el grupo: ${preciosPorPasajero.sinReparto.join(', ')}.`}
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

          {/* ── Opcionales ───────────────────────────────────────────── */}
          {opcionales.length > 0 && (
            <View>
              <Titulo texto="Opcionales" color={acento} />
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
