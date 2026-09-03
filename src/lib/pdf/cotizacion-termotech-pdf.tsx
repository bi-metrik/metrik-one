/**
 * Plantilla de cotización «termotech» — PROPUESTA ECONÓMICA.
 *
 * Reproduce el formato que Termotech ya usa fuera de la plataforma (levantado del PDF
 * real COT-170726, especificación en `proyectos/arca/one/docs/entrada/`). Es una
 * plantilla de RENDER: no cambia el funcionamiento del bloque de cotización, ni el
 * cálculo fiscal, ni qué se guarda. Solo cómo se ve el PDF de ESE workspace.
 *
 * Tres datos del formato no existen como campo en el modelo y se resuelven así, sin
 * inventar nada y sin tablas nuevas:
 *
 *  · CAPÍTULO  — el formato agrupa los ítems en capítulos con subtotal propio. El
 *                modelo no tiene agrupación, así que se renderiza UN capítulo cuyo
 *                título es el nombre del negocio (en Termotech los negocios se llaman
 *                «MANTENIMIENTO PREVENTIVO GENERAL», «RCI COLEGIO SAN CARLOS»: ya
 *                tienen la forma de un capítulo). Sin negocio, título neutro.
 *  · UND.      — `items` no tiene unidad de medida (la unidad vive en `rubros`, que es
 *                desglose de COSTO interno y no se le muestra al cliente). Se imprime
 *                la constante UNIDAD_POR_DEFECTO.
 *  · VIGENCIA  — el formato la dice en días; el modelo guarda `fecha_validez`. Se
 *                deriva con `vigenciaEnDias`, y si no se puede derivar se omite la
 *                línea en vez de poner un número inventado.
 *
 * Lo que el formato original tiene y esta versión NO trae, a propósito: el resaltado
 * azul por fila. En el original marca los equipos verificados en la visita, y eso es
 * un flag semántico por ítem que el modelo no tiene — pintarlo por zebra alternada
 * diría algo falso sobre los equipos.
 */

import {
  Document,
  Page,
  Text,
  View,
  Image as PdfImage,
} from '@react-pdf/renderer'

import type { CotizacionPDFProps } from './cotizacion-props'
import {
  parsearCondicionesComerciales,
  partirPalabraLarga,
  vigenciaEnDias,
} from '@/lib/cotizaciones/condiciones-comerciales'

// Paleta del formato original.
const AZUL_MARINO = '#1F3864'
const AZUL_CAPITULO = '#BDD7EE'
const GRIS_BORDE = '#BFBFBF'
const GRIS_ETIQUETA = '#7F7F7F'
const NEGRO = '#000000'

/**
 * Separación silábica: solo se parte lo que no cabe. La regla vive en
 * `partirPalabraLarga` y está probada aparte.
 *
 * Va como prop de cada `<Text>` — por diseño, no por comodidad:
 * `Font.registerHyphenationCallback` es GLOBAL del proceso y cambiaría también el PDF
 * de los demás workspaces, que en este encargo no se puede tocar.
 */
const SIN_GUION = partirPalabraLarga

/** `items` no tiene columna de unidad. Ver cabecera del archivo. */
const UNIDAD_POR_DEFECTO = 'Und'

const TITULO_CAPITULO_SIN_NEGOCIO = 'DETALLE DE LA PROPUESTA'

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

function fechaLarga(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getUTCDate()} de ${MESES[d.getUTCMonth()]} de ${d.getUTCFullYear()}`
}

const pesos = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

/** Numeración de dos dígitos, como el original: 01, 02, … 10, 11. */
const dosDigitos = (n: number) => String(n).padStart(2, '0')

// Anchos de la tabla de ítems. Suman 100.
const COL = {
  item: '7%',
  descripcion: '43%',
  cantidad: '8%',
  unidad: '8%',
  unitario: '17%',
  total: '17%',
} as const

function EtiquetaValor({
  etiqueta,
  valor,
  colorValor = NEGRO,
}: {
  etiqueta: string
  valor: string
  colorValor?: string
}) {
  return (
    <View style={{ flexDirection: 'row', marginTop: 1.5 }}>
      <Text style={{ fontSize: 7, color: GRIS_ETIQUETA }}>{etiqueta}: </Text>
      <Text style={{ fontSize: 7, color: colorValor }}>{valor}</Text>
    </View>
  )
}

function BandaSeccion({ titulo }: { titulo: string }) {
  return (
    <View
      style={{
        backgroundColor: AZUL_MARINO,
        paddingVertical: 4,
        paddingHorizontal: 6,
        marginTop: 14,
      }}
    >
      <Text
        style={{
          fontSize: 8.5,
          fontFamily: 'Helvetica-Bold',
          color: '#FFFFFF',
          letterSpacing: 0.8,
        }}
      >
        {titulo.toUpperCase()}
      </Text>
    </View>
  )
}

function FilaDatoCliente({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <View style={{ flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: GRIS_BORDE }}>
      <View
        style={{
          width: '25%',
          borderRightWidth: 0.5,
          borderRightColor: GRIS_BORDE,
          paddingVertical: 4,
          paddingHorizontal: 6,
        }}
      >
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: AZUL_MARINO }}>
          {etiqueta}
        </Text>
      </View>
      <View style={{ width: '75%', paddingVertical: 4, paddingHorizontal: 6 }}>
        <Text hyphenationCallback={SIN_GUION} style={{ fontSize: 8, color: NEGRO }}>
          {valor}
        </Text>
      </View>
    </View>
  )
}

export default function CotizacionTermotechPDF({
  cotizacion,
  empresa,
  vendedor,
  items,
  fiscal,
  negocio,
  emisor,
}: CotizacionPDFProps) {
  const conCantidad = items.map((item) => {
    const cantidad = item.cantidad ?? 1
    const bruto = Math.round(item.precio_venta * cantidad)
    const descuento = Math.round(bruto * ((item.descuento_porcentaje ?? 0) / 100))
    return { ...item, cantidad, neto: bruto - descuento }
  })

  // El subtotal del capítulo es el mismo valor sobre el que la plataforma liquida el
  // IVA: `valor_total` menos el descuento de cabecera. Recalcularlo aquí a partir de
  // las filas dejaría el PDF diciendo un número y el sistema cobrando otro.
  const subtotal = cotizacion.valor_total - (cotizacion.descuento_valor ?? 0)
  const iva = fiscal?.iva ?? 0
  const totalNeto = fiscal?.totalBruto ?? subtotal + iva
  const ivaPorcentaje = subtotal > 0 ? Math.round((iva / subtotal) * 100) : 0

  const vigencia = vigenciaEnDias(cotizacion.fecha_envio, cotizacion.fecha_validez)
  const condiciones = parsearCondicionesComerciales(cotizacion.terminos_condiciones)

  const nombreNegocio = negocio?.nombre?.trim() || null
  const capitulo = (nombreNegocio ?? TITULO_CAPITULO_SIN_NEGOCIO).toUpperCase()
  // Mismo criterio que el payload de WeasyPrint (`proyecto: negocio ?? descripcion`).
  const proyecto = nombreNegocio ?? cotizacion.descripcion?.trim() ?? '—'

  const ciudadVendedor = vendedor.ciudad?.trim() || null
  const razonSocial = vendedor.razon_social?.trim() || vendedor.nombre

  return (
    <Document>
      <Page
        size="LETTER"
        style={{
          paddingTop: 34,
          paddingBottom: 46,
          paddingHorizontal: 38,
          fontFamily: 'Helvetica',
          color: NEGRO,
        }}
      >
        {/* Marca de agua: el logo del workspace, muy claro, al centro de CADA página. */}
        {vendedor.logo_url && (
          <View
            fixed
            style={{
              position: 'absolute',
              top: 270,
              left: 156,
              width: 300,
              height: 300,
              opacity: 0.05,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <PdfImage
              src={vendedor.logo_url}
              style={{ width: 300, height: 300, objectFit: 'contain' }}
            />
          </View>
        )}

        {/* ── Encabezado ─────────────────────────────────────────────── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <View style={{ width: '55%' }}>
            {vendedor.logo_url && (
              <PdfImage
                src={vendedor.logo_url}
                style={{ width: 132, height: 44, objectFit: 'contain', marginBottom: 6 }}
              />
            )}
            {!vendedor.logo_url && (
              <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color: AZUL_MARINO }}>
                {razonSocial}
              </Text>
            )}
            {vendedor.nit && <EtiquetaValor etiqueta="NIT" valor={vendedor.nit} />}
            {vendedor.email && (
              <EtiquetaValor etiqueta="Contacto" valor={vendedor.email} colorValor={AZUL_MARINO} />
            )}
            {vendedor.telefono && <EtiquetaValor etiqueta="Teléfono" valor={vendedor.telefono} />}
            {ciudadVendedor && <EtiquetaValor etiqueta="Ciudad" valor={ciudadVendedor} />}
          </View>

          <View style={{ width: '42%', alignItems: 'flex-end' }}>
            <Text
              style={{
                fontSize: 15,
                fontFamily: 'Helvetica-Bold',
                color: AZUL_MARINO,
                letterSpacing: 0.5,
              }}
            >
              PROPUESTA ECONÓMICA
            </Text>
            <View style={{ marginTop: 8, alignItems: 'flex-end' }}>
              <Text style={{ fontSize: 7, color: GRIS_ETIQUETA }}>DOCUMENTO</Text>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                {cotizacion.consecutivo}
              </Text>
            </View>
            {cotizacion.fecha_envio && (
              <View style={{ marginTop: 5, alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA }}>FECHA DE EMISIÓN</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                  {fechaLarga(cotizacion.fecha_envio)}
                </Text>
              </View>
            )}
            {vigencia !== null && (
              <View style={{ marginTop: 5, alignItems: 'flex-end' }}>
                <Text style={{ fontSize: 7, color: GRIS_ETIQUETA }}>VIGENCIA</Text>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: NEGRO }}>
                  {vigencia} {vigencia === 1 ? 'día' : 'días'}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* ── Datos del cliente y proyecto ───────────────────────────── */}
        <BandaSeccion titulo="Datos del cliente y proyecto" />
        <View style={{ borderWidth: 0.5, borderColor: GRIS_BORDE, borderTopWidth: 0 }}>
          <FilaDatoCliente etiqueta="Cliente" valor={empresa.nombre || '—'} />
          <FilaDatoCliente etiqueta="NIT" valor={empresa.nit || '—'} />
          <FilaDatoCliente etiqueta="Atención a" valor={empresa.contacto_nombre || '—'} />
          <FilaDatoCliente etiqueta="Proyecto" valor={proyecto} />
        </View>

        {/* ── Tabla de ítems ─────────────────────────────────────────── */}
        <View style={{ marginTop: 14 }}>
          {/* `fixed` repite esta cabecera en cada página: con muchos ítems la tabla
              se parte y sin esto las columnas de la página 2 quedan sin nombre. */}
          <View
            fixed
            style={{
              flexDirection: 'row',
              backgroundColor: AZUL_MARINO,
              paddingVertical: 5,
            }}
          >
            {(
              [
                ['ÍTEM', COL.item, 'center'],
                ['DESCRIPCIÓN', COL.descripcion, 'left'],
                ['CANT.', COL.cantidad, 'center'],
                ['UND.', COL.unidad, 'center'],
                ['VLR. UNIT.', COL.unitario, 'right'],
                ['VLR. TOTAL', COL.total, 'right'],
              ] as const
            ).map(([titulo, ancho, alineacion]) => (
              <Text
                key={titulo}
                style={{
                  width: ancho,
                  paddingHorizontal: 4,
                  fontSize: 7.5,
                  fontFamily: 'Helvetica-Bold',
                  color: '#FFFFFF',
                  textAlign: alineacion,
                }}
              >
                {titulo}
              </Text>
            ))}
          </View>

          {/* Fila de capítulo */}
          <View
            style={{
              backgroundColor: AZUL_CAPITULO,
              paddingVertical: 4,
              borderBottomWidth: 0.5,
              borderBottomColor: GRIS_BORDE,
            }}
          >
            <Text
              style={{
                fontSize: 8,
                fontFamily: 'Helvetica-Bold',
                color: AZUL_MARINO,
                textAlign: 'center',
              }}
            >
              {capitulo}
            </Text>
          </View>

          {conCantidad.map((item, i) => (
            // `wrap={false}`: una fila no se parte entre dos páginas.
            <View
              key={i}
              wrap={false}
              style={{
                flexDirection: 'row',
                borderBottomWidth: 0.5,
                borderBottomColor: GRIS_BORDE,
                paddingVertical: 4,
                alignItems: 'flex-start',
              }}
            >
              <Text
                style={{
                  width: COL.item,
                  paddingHorizontal: 4,
                  fontSize: 8,
                  textAlign: 'center',
                }}
              >
                {dosDigitos(i + 1)}
              </Text>
              <View style={{ width: COL.descripcion, paddingHorizontal: 4 }}>
                <Text
                  hyphenationCallback={SIN_GUION}
                  style={{ fontSize: 8, fontFamily: 'Helvetica-Bold' }}
                >
                  {item.nombre}
                </Text>
                {item.descripcion && item.descripcion !== item.nombre && (
                  <Text
                    hyphenationCallback={SIN_GUION}
                    style={{ fontSize: 7.5, color: '#404040', marginTop: 1 }}
                  >
                    {item.descripcion}
                  </Text>
                )}
              </View>
              <Text
                style={{
                  width: COL.cantidad,
                  paddingHorizontal: 4,
                  fontSize: 8,
                  textAlign: 'center',
                }}
              >
                {item.cantidad}
              </Text>
              <Text
                style={{
                  width: COL.unidad,
                  paddingHorizontal: 4,
                  fontSize: 8,
                  textAlign: 'center',
                }}
              >
                {UNIDAD_POR_DEFECTO}
              </Text>
              <Text
                style={{
                  width: COL.unitario,
                  paddingHorizontal: 4,
                  fontSize: 8,
                  textAlign: 'right',
                }}
              >
                {pesos(item.precio_venta)}
              </Text>
              <Text
                style={{
                  width: COL.total,
                  paddingHorizontal: 4,
                  fontSize: 8,
                  textAlign: 'right',
                }}
              >
                {pesos(item.neto)}
              </Text>
            </View>
          ))}

          {/* Cierre del capítulo: subtotal, IVA y total neto */}
          <View wrap={false} style={{ marginTop: 6, alignSelf: 'flex-end', width: '55%' }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ fontSize: 8.5, color: '#404040' }}>Subtotal</Text>
              <Text style={{ fontSize: 8.5 }}>{pesos(subtotal)}</Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
              <Text style={{ fontSize: 8.5, color: '#404040' }}>IVA ({ivaPorcentaje}%)</Text>
              <Text style={{ fontSize: 8.5 }}>{pesos(iva)}</Text>
            </View>
            <View
              style={{
                flexDirection: 'row',
                justifyContent: 'space-between',
                borderTopWidth: 1,
                borderTopColor: AZUL_MARINO,
                borderBottomWidth: 1,
                borderBottomColor: AZUL_MARINO,
                paddingVertical: 4,
                marginTop: 3,
              }}
            >
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: AZUL_MARINO }}>
                TOTAL NETO
              </Text>
              <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: AZUL_MARINO }}>
                {pesos(totalNeto)}
              </Text>
            </View>
          </View>
        </View>

        {/* ── Condiciones comerciales ────────────────────────────────── */}
        {condiciones.length > 0 && (
          <View>
            <BandaSeccion titulo="Condiciones comerciales" />
            <View>
              {condiciones.map((c, i) => (
                <View
                  key={i}
                  wrap={false}
                  style={{
                    paddingVertical: 4,
                    paddingHorizontal: 6,
                    borderBottomWidth: 0.5,
                    borderBottomColor: GRIS_BORDE,
                  }}
                >
                  <Text
                    hyphenationCallback={SIN_GUION}
                    style={{ fontSize: 7.5, lineHeight: 1.5, color: '#262626' }}
                  >
                    {c.rotulo && (
                      <Text style={{ fontFamily: 'Helvetica-Bold', color: AZUL_MARINO }}>
                        {c.rotulo}:{c.texto ? ' ' : ''}
                      </Text>
                    )}
                    {c.texto}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* ── Firma ──────────────────────────────────────────────────── */}
        {emisor && (
          <View wrap={false} style={{ marginTop: 26, alignItems: 'center' }}>
            <Text style={{ fontSize: 8, color: GRIS_ETIQUETA }}>Emitido por:</Text>
            <Text
              style={{
                fontSize: 9.5,
                fontFamily: 'Helvetica-Bold',
                color: NEGRO,
                marginTop: 3,
              }}
            >
              {emisor.nombre.toUpperCase()}
            </Text>
            {emisor.cargo && (
              <Text style={{ fontSize: 8, color: GRIS_ETIQUETA, marginTop: 1 }}>
                {emisor.cargo}
              </Text>
            )}
          </View>
        )}

        {/* ── Pie ────────────────────────────────────────────────────── */}
        <View
          fixed
          style={{
            position: 'absolute',
            bottom: 22,
            left: 38,
            right: 38,
            borderTopWidth: 0.5,
            borderTopColor: GRIS_BORDE,
            paddingTop: 5,
            flexDirection: 'row',
            justifyContent: 'space-between',
          }}
        >
          <Text style={{ fontSize: 6.5, color: GRIS_ETIQUETA }}>{razonSocial}</Text>
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
