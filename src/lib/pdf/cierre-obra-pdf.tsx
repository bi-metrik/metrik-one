import { Document, Page, Text, View, Image as PdfImage } from '@react-pdf/renderer'

import { PALETA } from '@/lib/marca/paleta'
import { AVISO_FALTAN_GASTOS, type ResumenCierre } from '@/lib/obras/cierre'
import type { FacturaObra } from '@/lib/obras/facturas'
import { fechaLegible, pesos, porcentaje, textoJornadas } from '@/lib/obras/formato'

/**
 * El informe de cierre de una obra (C12), con el logo y los colores del workspace (como la
 * cotización). Lo arma ONE y solo sale de ONE (D6): el asistente de WhatsApp no lo manda.
 *
 * Todas las cifras llegan ya calculadas por `v_cierre_obra` y `v_facturas_obra`; el documento no
 * suma nada por su cuenta. Datos de composición por props (gotcha: nada de contexto de React).
 */
export interface CierreObraPDFProps {
  marca: {
    nombre: string
    logo_url: string | null
    color_primario: string | null
  }
  obra: {
    codigo: string | null
    nombre: string
    cliente: string | null
  }
  /** Día de Bogotá en que se genera (`YYYY-MM-DD`). */
  fecha: string
  cierre: ResumenCierre
  facturas: FacturaObra[]
}

const HEX = /^#[0-9a-f]{6}$/i

/** Mezcla un color con blanco (react-pdf no tiene rgba). `cuanto` = cuánto del color queda. */
function aclarar(hex: string, cuanto: number): string {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  return `#${c.map((v) => Math.round(v + (255 - v) * (1 - cuanto)).toString(16).padStart(2, '0')).join('')}`
}

const TINTA = '#111827'
const SUAVE = PALETA.tintaSuave
const BORDE = '#E5E7EB'

function Fila({ etiqueta, valor, fuerte, color, sangria }: { etiqueta: string; valor: string; fuerte?: boolean; color?: string; sangria?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottom: `0.5 solid ${BORDE}` }}>
      <Text style={{ fontSize: 9.5, color: sangria ? SUAVE : TINTA, paddingLeft: sangria ? 10 : 0, fontFamily: fuerte ? 'Helvetica-Bold' : 'Helvetica' }}>
        {etiqueta}
      </Text>
      <Text style={{ fontSize: 9.5, color: color ?? TINTA, fontFamily: fuerte ? 'Helvetica-Bold' : 'Helvetica' }}>{valor}</Text>
    </View>
  )
}

function Titulo({ children, color }: { children: string; color: string }) {
  return (
    <Text style={{ fontSize: 7.5, fontFamily: 'Helvetica-Bold', color, textTransform: 'uppercase', letterSpacing: 1.5, marginTop: 16, marginBottom: 6 }}>
      {children}
    </Text>
  )
}

export default function CierreObraPDF({ marca, obra, fecha, cierre, facturas }: CierreObraPDFProps) {
  const pc = marca.color_primario && HEX.test(marca.color_primario) ? marca.color_primario : PALETA.acento
  const tinte = aclarar(pc, 0.08)
  const utilidadNegativa = cierre.utilidad < 0

  return (
    <Document title={`Cierre de obra ${obra.codigo ?? obra.nombre}`}>
      <Page size="LETTER" style={{ paddingTop: 44, paddingBottom: 56, paddingHorizontal: 48, fontSize: 10, fontFamily: 'Helvetica', color: TINTA }}>
        {/* Encabezado: la marca a la izquierda, el documento a la derecha. */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <View style={{ maxWidth: '55%' }}>
            {marca.logo_url ? (
              <PdfImage src={marca.logo_url} style={{ width: 100, height: 50, objectFit: 'contain', marginBottom: 4 }} />
            ) : null}
            <Text style={{ fontSize: 13, fontFamily: 'Helvetica-Bold' }}>{marca.nombre}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ fontSize: 10, fontFamily: 'Helvetica-Bold', color: SUAVE, textTransform: 'uppercase', letterSpacing: 3 }}>
              Cierre de obra
            </Text>
            <Text style={{ fontSize: 9, color: SUAVE, marginTop: 3 }}>Al {fechaLegible(fecha)}</Text>
          </View>
        </View>
        <View style={{ height: 2, backgroundColor: pc, marginTop: 12, marginBottom: 14 }} />

        {/* La obra */}
        <Text style={{ fontSize: 15, fontFamily: 'Helvetica-Bold' }}>{obra.nombre}</Text>
        <Text style={{ fontSize: 9, color: SUAVE, marginTop: 2 }}>
          {[obra.codigo, obra.cliente].filter(Boolean).join(' · ')}
          {cierre.cerrada ? ' · Obra cerrada' : ' · Obra en curso'}
        </Text>

        {/* La utilidad, arriba y grande */}
        <View style={{ marginTop: 14, padding: 12, backgroundColor: tinte, borderLeft: `3 solid ${pc}` }}>
          <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: pc, textTransform: 'uppercase', letterSpacing: 1.2 }}>
            {cierre.tituloUtilidad}
          </Text>
          <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', color: utilidadNegativa ? PALETA.alerta : TINTA, marginTop: 3 }}>
            {pesos(cierre.utilidad)}
            {cierre.utilidadPct !== null ? `  (${porcentaje(cierre.utilidadPct)})` : ''}
          </Text>
          {!cierre.cerrada ? <Text style={{ fontSize: 8.5, color: SUAVE, marginTop: 3 }}>{AVISO_FALTAN_GASTOS}</Text> : null}
        </View>

        <Titulo color={pc}>Resultado</Titulo>
        <Fila etiqueta="Vendido" valor={pesos(cierre.vendido)} fuerte />
        {cierre.rubros.map((r) => (
          <Fila key={r.rubro} etiqueta={r.rubro} valor={pesos(r.total)} sangria />
        ))}
        <Fila etiqueta={`Mano de obra (${textoJornadas(cierre.jornadas)})`} valor={pesos(cierre.manoObra)} sangria />
        <Fila etiqueta="Total gastado" valor={pesos(cierre.gastosTotal + cierre.manoObra)} />
        <Fila etiqueta={cierre.tituloUtilidad} valor={pesos(cierre.utilidad)} fuerte color={utilidadNegativa ? PALETA.alerta : undefined} />

        <Titulo color={pc}>Facturación y recaudo</Titulo>
        <Fila etiqueta="Facturado" valor={pesos(cierre.facturado)} />
        <Fila etiqueta="Cobrado" valor={pesos(cierre.cobrado)} />
        <Fila etiqueta="Retenido (facturas pagadas)" valor={pesos(cierre.retenido)} />
        <Fila etiqueta="Por cobrar" valor={pesos(cierre.porCobrar)} fuerte />

        {facturas.length > 0 ? (
          <>
            <Titulo color={pc}>Facturas</Titulo>
            <View style={{ flexDirection: 'row', paddingBottom: 3, borderBottom: `0.5 solid ${SUAVE}` }}>
              {['Factura', 'Fecha', 'Total', 'Recibido', 'Estado', 'Retenido'].map((h, i) => (
                <Text key={h} style={{ width: i === 0 ? '18%' : i === 4 ? '14%' : '17%', fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: SUAVE, textAlign: i >= 2 && i !== 4 ? 'right' : 'left' }}>
                  {h}
                </Text>
              ))}
            </View>
            {facturas.map((f) => (
              <View key={f.id} wrap={false} style={{ flexDirection: 'row', paddingVertical: 3, borderBottom: `0.5 solid ${BORDE}` }}>
                <Text style={{ width: '18%', fontSize: 8.5 }}>{f.numero_factura ?? '—'}</Text>
                <Text style={{ width: '17%', fontSize: 8.5 }}>{fechaLegible(f.fecha_emision)}</Text>
                <Text style={{ width: '17%', fontSize: 8.5, textAlign: 'right' }}>{pesos(f.monto)}</Text>
                <Text style={{ width: '17%', fontSize: 8.5, textAlign: 'right' }}>{pesos(f.recibido)}</Text>
                <Text style={{ width: '14%', fontSize: 8.5, paddingLeft: 6 }}>{f.estado === 'pagada' ? 'Pagada' : 'Abierta'}</Text>
                <Text style={{ width: '17%', fontSize: 8.5, textAlign: 'right' }}>{f.estado === 'pagada' ? pesos(f.retenido) : '—'}</Text>
              </View>
            ))}
          </>
        ) : null}

        {cierre.avisos.filter((a) => a !== AVISO_FALTAN_GASTOS).map((a) => (
          <Text key={a} style={{ fontSize: 8.5, color: PALETA.advertencia, marginTop: 10 }}>
            {a}
          </Text>
        ))}

        <Text
          fixed
          style={{ position: 'absolute', bottom: 28, left: 48, right: 48, fontSize: 7, color: SUAVE, textAlign: 'center' }}
        >
          Retenido = diferencia entre lo facturado y lo recibido en las facturas marcadas como pagadas. No es un certificado de retención.
        </Text>
      </Page>
    </Document>
  )
}
