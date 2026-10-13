/**
 * El paquete de viaje (F4-4, Noor §7.4): lo que el viajero lleva. Itinerario día a día desde los
 * servicios del viaje (que nacieron de la tarifa aceptada), los vouchers (sus archivos van
 * adjuntos al final del mismo PDF), «Antes de viajar» del texto revisado de la cotización y los
 * contactos de emergencia de la línea.
 *
 * Una hoja sobria con la marca de la agencia: lo revisa Ren antes de encender.
 *
 * Helvetica es WinAnsi: todo texto pasa por `aLetraLatina` y lo que no se puede imprimir se
 * omite (nunca una caja vacía ni un PDF que revienta por una letra rara).
 */

import { Document, Page, Text, View } from '@react-pdf/renderer'
import { aLetraLatina, esWinAnsi } from '@/lib/texto/texto-latino'
import type { DiaDelItinerario } from '@/lib/viaje/entrega'

export interface PaqueteViajePDFProps {
  agencia: string
  colorPrimario: string | null
  viajero: string
  titulo: string
  fechas: string | null
  itinerario: DiaDelItinerario[]
  vouchers: Array<{ nombre: string; detalle: string | null; adjunto: boolean }>
  antesDeViajar: string[]
  contactosEmergencia: string | null
  nota: string | null
  comercial: string | null
}

const t = (v: string | null | undefined): string => Array.from(aLetraLatina(v ?? '')).filter(esWinAnsi).join('')

const GRIS = '#6B7280'
const TINTA = '#1A1A1A'

function Seccion({ titulo, color, children }: { titulo: string; color: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: 16 }} wrap={false}>
      <Text style={{ fontSize: 11, fontFamily: 'Helvetica-Bold', color }}>{t(titulo)}</Text>
      <View style={{ marginTop: 6 }}>{children}</View>
    </View>
  )
}

export default function PaqueteViajePDF(p: PaqueteViajePDFProps) {
  const color = /^#[0-9a-f]{6}$/i.test(p.colorPrimario ?? '') ? (p.colorPrimario as string) : '#10B981'
  return (
    <Document title={t(`Paquete de viaje · ${p.titulo}`)} author={t(p.agencia)}>
      <Page size="A4" style={{ padding: 40, fontFamily: 'Helvetica', fontSize: 9.5, color: TINTA }}>
        <View style={{ height: 4, backgroundColor: color, marginBottom: 14 }} />
        <Text style={{ fontSize: 8, color: GRIS, letterSpacing: 1 }}>{t(p.agencia.toUpperCase())} · PAQUETE DE VIAJE</Text>
        <Text style={{ fontSize: 18, fontFamily: 'Helvetica-Bold', marginTop: 4 }}>{t(p.titulo)}</Text>
        <Text style={{ fontSize: 10, color: GRIS, marginTop: 2 }}>
          {t([p.viajero, p.fechas].filter(Boolean).join(' · '))}
        </Text>
        {p.nota && <Text style={{ marginTop: 10 }}>{t(p.nota)}</Text>}

        <Seccion titulo="Itinerario día a día" color={color}>
          {p.itinerario.length === 0 ? (
            <Text style={{ color: GRIS }}>{t('El itinerario se arma con los servicios del viaje.')}</Text>
          ) : p.itinerario.map((d, i) => (
            <View key={`dia-${i}`} style={{ marginBottom: 6 }} wrap={false}>
              <Text style={{ fontFamily: 'Helvetica-Bold' }}>{t(d.titulo)}</Text>
              {d.lineas.map((l, j) => (
                <Text key={`l-${i}-${j}`} style={{ marginLeft: 8 }}>{t(`· ${l}`)}</Text>
              ))}
            </View>
          ))}
        </Seccion>

        <Seccion titulo="Vouchers" color={color}>
          {p.vouchers.map((v, i) => (
            <Text key={`v-${i}`}>
              {t(`· ${v.nombre}${v.detalle ? ` · ${v.detalle}` : ''}${v.adjunto ? ' (adjunto al final)' : ''}`)}
            </Text>
          ))}
        </Seccion>

        {p.antesDeViajar.length > 0 && (
          <Seccion titulo="Antes de viajar" color={color}>
            {p.antesDeViajar.map((a, i) => (
              <Text key={`a-${i}`}>{t(`· ${a}`)}</Text>
            ))}
          </Seccion>
        )}

        {p.contactosEmergencia && (
          <Seccion titulo="Contactos de emergencia" color={color}>
            <Text>{t(p.contactosEmergencia)}</Text>
          </Seccion>
        )}

        <Text style={{ marginTop: 18, color: GRIS }}>
          {t(`Cualquier cosa, escríbenos. ${[p.comercial, p.agencia].filter(Boolean).join(' · ')}`)}
        </Text>
      </Page>
    </Document>
  )
}
