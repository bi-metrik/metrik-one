import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Svg, Line } from '@react-pdf/renderer';
import type { InformaMatch } from '@/lib/actions/compliance-dual';
import type { LiberacionDecision } from './liberaciones';
import { formatFecha } from '@/lib/dates/bogota';

/**
 * Autorización de contratación (R4).
 *
 * Documento DISTINTO del soporte de consulta (`pdf-soporte-dual.tsx`). Aquel es
 * la constancia de que se consultó; este es la constancia de que el oficial de
 * cumplimiento DECIDIÓ, y es lo que compras exige para contratar a una
 * contraparte que salió reportada.
 *
 * Se genera 100% desde datos guardados: no golpea a Informa ni a Valida, así que
 * emitirlo no cuesta una consulta facturable.
 *
 * Lleva SIEMPRE su estado a la vista. Un PDF sobrevive a su propia vigencia: sin
 * el estado impreso, una autorización vencida o revocada se ve idéntica a una
 * viva, y quien la reciba por correo tres meses después no tiene cómo saberlo.
 */

// Branding tokens — cerebro/conceptos/identidad-visual-metrik.md
const C = {
  negro: '#1A1A1A',
  gris: '#6B7280',
  verde: '#10B981',
  verdeDark: '#059669',
  rojo: '#EF4444',
  rojoClaro: '#FEF2F2',
  ambar: '#B45309',
  ambarClaro: '#FFFBEB',
  verdeClaro: '#ECFDF5',
  blanco: '#FFFFFF',
  grisLinea: '#E5E7EB',
  crema: '#F5F4F2',
};

/** Estado de la autorización AL MOMENTO DE IMPRIMIRLA. */
export type EstadoAutorizacion =
  /** Es la decisión más reciente sobre la contraparte y su vigencia corre. */
  | 'vigente'
  /** Fue la decisión más reciente, pero `vigente_hasta` ya pasó. */
  | 'vencida'
  /** Hay una decisión POSTERIOR sobre la misma contraparte: esta ya no manda. */
  | 'superada';

const ESTADO_PDF: Record<EstadoAutorizacion, { label: string; bg: string; fg: string; nota: string }> = {
  vigente: {
    label: 'Vigente',
    bg: C.verde,
    fg: C.blanco,
    nota: 'Esta autorización está vigente a la fecha de generación de este documento.',
  },
  vencida: {
    label: 'Vencida',
    bg: C.rojo,
    fg: C.blanco,
    nota:
      'La vigencia de esta autorización ya venció. NO habilita una contratación nueva: el oficial de cumplimiento debe volver a decidir sobre esta contraparte.',
  },
  superada: {
    label: 'Sin efecto',
    bg: C.negro,
    fg: C.blanco,
    nota:
      'Existe una decisión POSTERIOR del oficial de cumplimiento sobre esta contraparte. Este documento queda como constancia histórica y NO habilita una contratación.',
  },
};

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 50, paddingHorizontal: 38, fontFamily: 'Helvetica', fontSize: 9, color: C.negro, backgroundColor: C.blanco, lineHeight: 1.5 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14, paddingBottom: 10, borderBottom: `0.5pt solid ${C.grisLinea}` },
  brand: { flexDirection: 'column' },
  brandWordmark: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.negro },
  brandLine: { marginTop: 1 },
  brandProduct: { fontSize: 9, color: C.gris, marginTop: 4 },
  brandTagline: { fontSize: 7, color: C.gris, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  meta: { flexDirection: 'column', alignItems: 'flex-end' },
  metaLine: { fontSize: 7, color: C.gris },
  metaLineBold: { fontSize: 8, color: C.negro, fontFamily: 'Helvetica-Bold', marginBottom: 2 },

  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.negro, marginTop: 6, marginBottom: 4 },
  docSubtitle: { fontSize: 9, color: C.gris, marginBottom: 12 },

  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.negro, marginTop: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionDivider: { height: 0.5, backgroundColor: C.grisLinea, marginBottom: 6 },

  idGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.crema, padding: 8, borderRadius: 3, borderLeftWidth: 1.5, borderLeftColor: C.verde, marginBottom: 10 },
  idCell: { width: '50%', paddingVertical: 3, paddingRight: 8 },
  idLabel: { fontSize: 7, color: C.gris, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 1 },
  idValue: { fontSize: 9.5, color: C.negro, fontFamily: 'Helvetica-Bold' },

  estadoBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 3, marginBottom: 4 },
  estadoChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  estadoTexto: { fontSize: 9.5, color: C.negro, flex: 1 },

  justificacion: { padding: 9, backgroundColor: C.crema, borderRadius: 3, borderLeftWidth: 1.5, borderLeftColor: C.gris, marginBottom: 4 },
  justificacionTexto: { fontSize: 9, color: C.negro, lineHeight: 1.6, textAlign: 'justify' },

  table: { borderWidth: 0.5, borderColor: C.grisLinea, borderRadius: 3, marginBottom: 4, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: C.negro },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.blanco, paddingVertical: 5, paddingHorizontal: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  tableRow: { flexDirection: 'row', borderTop: `0.5pt solid ${C.grisLinea}` },
  td: { fontSize: 8.5, color: C.negro, paddingVertical: 5, paddingHorizontal: 6 },
  cLista: { width: 90 },
  cNombre: { flex: 1 },
  cDoc: { width: 75 },
  cFund: { flex: 1.4 },

  para: { fontSize: 8.5, color: C.gris, marginBottom: 6, lineHeight: 1.5, textAlign: 'justify' },

  firma: { marginTop: 14, paddingTop: 10, borderTop: `0.5pt solid ${C.grisLinea}`, flexDirection: 'row', justifyContent: 'space-between' },
  firmaCol: { flexDirection: 'column', width: '48%' },
  firmaLinea: { borderTop: `0.5pt solid ${C.negro}`, marginTop: 26, paddingTop: 4 },
  firmaNombre: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.negro },
  firmaRol: { fontSize: 7.5, color: C.gris },

  disclaimer: { marginTop: 10, padding: 8, backgroundColor: C.crema, borderLeft: `2pt solid ${C.gris}`, borderRadius: 2 },
  disclaimerTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  disclaimerText: { fontSize: 7, color: C.gris, lineHeight: 1.4, textAlign: 'justify' },

  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: `0.5pt solid ${C.grisLinea}` },
  footerText: { fontSize: 6.5, color: C.gris },
});

export type AutorizacionData = {
  workspace_nombre: string;
  liberacion_id: string;
  decision: LiberacionDecision;
  estado: EstadoAutorizacion;

  /** Contraparte sobre la que se decidió. */
  nombre: string | null;
  documento_tipo: string;
  documento_numero: string;

  justificacion: string;
  vigente_desde: string;
  vigente_hasta: string | null;
  created_at: string;

  /** Quién firmó. Sin nombre resuelto se imprime el rol, nunca un uuid. */
  liberada_por_nombre: string | null;

  control_referencia: string | null;
  control_nombre: string | null;

  /** La evidencia: los hallazgos que el oficial tuvo a la vista al decidir. */
  consulta_id: string;
  consulta_fecha: string;
  total_matches: number;
  matches: InformaMatch[];
};

function fechaLarga(iso: string): string {
  return formatFecha(iso, { day: '2-digit', month: 'long', year: 'numeric' }) ?? iso;
}

function fechaHora(iso: string): string {
  return (
    formatFecha(iso, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? iso
  );
}

function MetrikWordmark() {
  return (
    <View style={s.brand}>
      <Text style={s.brandWordmark}>M{'é'}TRIK</Text>
      <Svg width={80} height={3} style={s.brandLine}>
        <Line x1={0} y1={1.5} x2={80} y2={1.5} strokeWidth={2.5} stroke={C.verde} />
      </Svg>
      <Text style={s.brandProduct}>Compliance</Text>
      <Text style={s.brandTagline}>Autorización de contratación · SARLAFT</Text>
    </View>
  );
}

function Hallazgos({ matches }: { matches: InformaMatch[] }) {
  return (
    <View style={s.table}>
      <View style={s.tableHeader}>
        <Text style={[s.th, s.cLista]}>Lista</Text>
        <Text style={[s.th, s.cNombre]}>Nombre coincidente</Text>
        <Text style={[s.th, s.cDoc]}>Documento</Text>
        <Text style={[s.th, s.cFund]}>Fundamento</Text>
      </View>
      {matches.map((m, i) => (
        <View key={i} style={s.tableRow} wrap={false}>
          <Text style={[s.td, s.cLista, { fontFamily: 'Helvetica-Bold' }]}>{m.lista}</Text>
          <Text style={[s.td, s.cNombre]}>{m.nombre}</Text>
          <Text style={[s.td, s.cDoc]}>{m.documento ?? '—'}</Text>
          <Text style={[s.td, s.cFund]}>{m.fundamento ?? '—'}</Text>
        </View>
      ))}
    </View>
  );
}

function DocumentoAutorizacion({ data, fechaGen }: { data: AutorizacionData; fechaGen: string }) {
  const estado = ESTADO_PDF[data.estado];
  const fondoEstado =
    data.estado === 'vigente' ? C.verdeClaro : data.estado === 'vencida' ? C.rojoClaro : C.crema;

  return (
    <Document title="Autorización de contratación — Compliance SARLAFT" author="MeTRIK SAS">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <MetrikWordmark />
          <View style={s.meta}>
            <Text style={s.metaLine}>Autorización No.</Text>
            <Text style={s.metaLineBold}>{data.liberacion_id.slice(0, 8).toUpperCase()}</Text>
            <Text style={s.metaLine}>Generado</Text>
            <Text style={s.metaLineBold}>{fechaGen}</Text>
          </View>
        </View>

        <Text style={s.docTitle}>Autorización de contratación</Text>
        <Text style={s.docSubtitle}>
          Decisión del oficial de cumplimiento de {data.workspace_nombre} sobre las coincidencias
          encontradas en listas restrictivas para la contraparte identificada.
        </Text>

        <View style={s.idGrid}>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Contraparte</Text>
            <Text style={s.idValue}>{data.nombre || '—'}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Documento</Text>
            <Text style={s.idValue}>{`${data.documento_tipo} ${data.documento_numero}`}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Vigencia desde</Text>
            <Text style={s.idValue}>{fechaLarga(data.vigente_desde)}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Vigencia hasta</Text>
            <Text style={s.idValue}>
              {data.vigente_hasta ? fechaLarga(data.vigente_hasta) : '—'}
            </Text>
          </View>
          {(data.control_referencia || data.control_nombre) && (
            <View style={[s.idCell, { width: '100%' }]}>
              <Text style={s.idLabel}>Control asociado (matriz de riesgo)</Text>
              <Text style={s.idValue}>
                {[data.control_referencia, data.control_nombre].filter(Boolean).join(' · ')}
              </Text>
            </View>
          )}
        </View>

        <Text style={s.sectionTitle}>Estado de la autorización</Text>
        <View style={s.sectionDivider} />
        <View style={[s.estadoBox, { backgroundColor: fondoEstado }]}>
          <Text style={[s.estadoChip, { backgroundColor: estado.bg, color: estado.fg }]}>{estado.label}</Text>
          <Text style={s.estadoTexto}>{estado.nota}</Text>
        </View>

        <Text style={s.sectionTitle}>Justificación del oficial de cumplimiento</Text>
        <View style={s.sectionDivider} />
        <View style={s.justificacion}>
          <Text style={s.justificacionTexto}>{data.justificacion}</Text>
        </View>

        <Text style={s.sectionTitle}>Hallazgos que se tuvieron a la vista ({data.total_matches})</Text>
        <View style={s.sectionDivider} />
        <Text style={s.para}>
          Consulta de listas restrictivas del {fechaHora(data.consulta_fecha)} (referencia{' '}
          {data.consulta_id.slice(0, 8).toUpperCase()}). Es la evidencia sobre la cual se tomó esta
          decisión; una consulta posterior puede arrojar un resultado distinto.
        </Text>
        {data.matches.length > 0 && <Hallazgos matches={data.matches} />}

        <View style={s.firma} wrap={false}>
          <View style={s.firmaCol}>
            <View style={s.firmaLinea}>
              <Text style={s.firmaNombre}>{data.liberada_por_nombre || 'Oficial de cumplimiento'}</Text>
              <Text style={s.firmaRol}>Oficial de cumplimiento · {data.workspace_nombre}</Text>
            </View>
          </View>
          <View style={s.firmaCol}>
            <View style={s.firmaLinea}>
              <Text style={s.firmaNombre}>{fechaHora(data.created_at)}</Text>
              <Text style={s.firmaRol}>Fecha y hora de la decisión</Text>
            </View>
          </View>
        </View>

        <View style={s.disclaimer} wrap={false}>
          <Text style={s.disclaimerTitle}>Alcance de este documento</Text>
          <Text style={s.disclaimerText}>
            Esta autorización acredita que el oficial de cumplimiento del sujeto obligado analizó las
            coincidencias listadas y decidió sobre ellas, dejando constancia de su justificación y de la
            vigencia otorgada. No sustituye el procedimiento de contratación del sujeto obligado ni las
            demás verificaciones que este exija, y pierde efecto al vencer la vigencia o si el oficial
            registra una decisión posterior sobre la misma contraparte. MéTRIK provee la herramienta que
            registra la decisión; la valoración del riesgo y el eventual reporte a la UIAF son
            responsabilidades indelegables del sujeto obligado.
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Powered by M{'é'}TRIK · metrik.com.co</Text>
          <Text style={s.footerText}>
            Ref. {data.liberacion_id.slice(0, 8).toUpperCase()} · {data.consulta_id.slice(0, 8).toUpperCase()}
          </Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generarPDFAutorizacion(data: AutorizacionData): Promise<Buffer> {
  const fechaGen = formatFecha(new Date(), { day: '2-digit', month: 'short', year: 'numeric' })!;
  return renderToBuffer(<DocumentoAutorizacion data={data} fechaGen={fechaGen} />);
}
