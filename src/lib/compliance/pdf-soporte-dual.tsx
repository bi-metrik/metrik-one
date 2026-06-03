import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Svg, Line } from '@react-pdf/renderer';
import type { InformaMatch, DualSeveridad, DualTipo } from '@/lib/actions/compliance-dual';

// Branding tokens — cerebro/conceptos/identidad-visual-metrik.md
const C = {
  negro: '#1A1A1A',
  gris: '#6B7280',
  verde: '#10B981',
  verdeDark: '#059669',
  rojo: '#EF4444',
  rojoClaro: '#FEF2F2',
  verdeClaro: '#ECFDF5',
  blanco: '#FFFFFF',
  grisLinea: '#E5E7EB',
  crema: '#F5F4F2',
};

const SEVERIDAD_PDF: Record<DualSeveridad, { label: string; bg: string; fg: string }> = {
  alto: { label: 'Con novedades', bg: C.rojo, fg: C.blanco },
  sin_hallazgo: { label: 'Sin novedades', bg: C.verde, fg: C.blanco },
  error: { label: 'Error en la consulta', bg: C.negro, fg: C.blanco },
};

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 50, paddingHorizontal: 38, fontFamily: 'Helvetica', fontSize: 9, color: C.negro, backgroundColor: C.blanco, lineHeight: 1.5 },

  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14, paddingBottom: 10, borderBottom: `0.5pt solid ${C.grisLinea}` },
  brand: { flexDirection: 'column' },
  brandWordmark: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.negro },
  brandLine: { marginTop: 1 },
  brandProduct: { fontSize: 9, color: C.gris, marginTop: 4, fontFamily: 'Helvetica' },
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

  resultadoBox: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, borderRadius: 3, marginBottom: 4 },
  resultadoChip: { paddingVertical: 4, paddingHorizontal: 10, borderRadius: 10, fontSize: 9, fontFamily: 'Helvetica-Bold' },
  resultadoTexto: { fontSize: 9.5, color: C.negro, flex: 1 },

  table: { borderWidth: 0.5, borderColor: C.grisLinea, borderRadius: 3, marginBottom: 4, overflow: 'hidden' },
  tableHeader: { flexDirection: 'row', backgroundColor: C.negro },
  th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: C.blanco, paddingVertical: 5, paddingHorizontal: 6, textTransform: 'uppercase', letterSpacing: 0.3 },
  tableRow: { flexDirection: 'row', borderTop: `0.5pt solid ${C.grisLinea}` },
  td: { fontSize: 8.5, color: C.negro, paddingVertical: 5, paddingHorizontal: 6 },
  cLista: { width: 90 },
  cNombre: { flex: 1 },
  cDoc: { width: 75 },
  cFund: { flex: 1.4 },

  sinHallazgo: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 10, backgroundColor: C.verdeClaro, borderRadius: 3, borderLeftWidth: 1.5, borderLeftColor: C.verde },
  sinHallazgoText: { fontSize: 9, color: C.verdeDark, fontFamily: 'Helvetica-Bold' },

  para: { fontSize: 8.5, color: C.gris, marginBottom: 6, lineHeight: 1.5, textAlign: 'justify' },

  disclaimer: { marginTop: 10, padding: 8, backgroundColor: C.crema, borderLeft: `2pt solid ${C.gris}`, borderRadius: 2 },
  disclaimerTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  disclaimerText: { fontSize: 7, color: C.gris, lineHeight: 1.4, textAlign: 'justify' },

  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: `0.5pt solid ${C.grisLinea}` },
  footerText: { fontSize: 6.5, color: C.gris },
});

export type SoporteDualData = {
  workspace_nombre: string;
  consulta_local_id: string;
  dual_id: string | null;
  tipo: 'puntual' | 'masiva_item';
  titulo_lote: string | null;
  nombre_consultado: string | null;
  documento_tipo: string | null;
  documento_numero: string | null;
  tipo_persona: DualTipo;
  severidad: DualSeveridad;
  total_matches: number;
  matches: InformaMatch[];
  error_mensaje: string | null;
  created_at: string;
};

function fechaLarga(iso: string): string {
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function MetrikWordmark() {
  return (
    <View style={s.brand}>
      <Text style={s.brandWordmark}>M{'é'}TRIK</Text>
      <Svg width={80} height={3} style={s.brandLine}>
        <Line x1={0} y1={1.5} x2={80} y2={1.5} strokeWidth={2.5} stroke={C.verde} />
      </Svg>
      <Text style={s.brandProduct}>Compliance</Text>
      <Text style={s.brandTagline}>Soporte de consulta · Listas restrictivas</Text>
    </View>
  );
}

function Novedades({ matches }: { matches: InformaMatch[] }) {
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
          <Text style={[s.td, s.cDoc, { fontFamily: 'Helvetica' }]}>{m.documento ?? '—'}</Text>
          <Text style={[s.td, s.cFund]}>{m.fundamento ?? '—'}</Text>
        </View>
      ))}
    </View>
  );
}

function DocumentoSoporte({ data, fechaGen }: { data: SoporteDualData; fechaGen: string }) {
  const sev = SEVERIDAD_PDF[data.severidad];
  const docCompleto = data.documento_tipo && data.documento_numero
    ? `${data.documento_tipo} ${data.documento_numero}`
    : '—';
  const resultadoTexto =
    data.severidad === 'error'
      ? 'La consulta no pudo completarse. No constituye constancia de revisión.'
      : data.total_matches > 0
        ? `Se encontraron ${data.total_matches} novedad(es) en las listas restrictivas evaluadas. Requiere análisis del oficial de cumplimiento.`
        : 'No se encontraron novedades en las listas restrictivas evaluadas a la fecha de la consulta.';

  return (
    <Document title="Soporte de consulta — Listas restrictivas SARLAFT" author="MeTRIK SAS">
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <MetrikWordmark />
          <View style={s.meta}>
            <Text style={s.metaLine}>Consulta No.</Text>
            <Text style={s.metaLineBold}>{data.consulta_local_id.slice(0, 8).toUpperCase()}</Text>
            <Text style={s.metaLine}>Generado</Text>
            <Text style={s.metaLineBold}>{fechaGen}</Text>
          </View>
        </View>

        <Text style={s.docTitle}>Soporte de consulta de listas restrictivas</Text>
        <Text style={s.docSubtitle}>
          Constancia de la consulta SARLAFT realizada por {data.workspace_nombre} sobre el sujeto identificado.
        </Text>

        <View style={s.idGrid}>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Sujeto consultado</Text>
            <Text style={s.idValue}>{data.nombre_consultado || '—'}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Documento</Text>
            <Text style={s.idValue}>{docCompleto}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Tipo de persona</Text>
            <Text style={s.idValue}>{data.tipo_persona === 'juridica' ? 'Jurídica' : 'Natural'}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Fecha de la consulta</Text>
            <Text style={s.idValue}>{fechaLarga(data.created_at)}</Text>
          </View>
          {data.tipo === 'masiva_item' && (
            <View style={s.idCell}>
              <Text style={s.idLabel}>Cargue</Text>
              <Text style={s.idValue}>{data.titulo_lote || 'Carga masiva'}</Text>
            </View>
          )}
        </View>

        <Text style={s.sectionTitle}>Resultado</Text>
        <View style={s.sectionDivider} />
        <View style={[s.resultadoBox, { backgroundColor: data.severidad === 'sin_hallazgo' ? C.verdeClaro : data.severidad === 'error' ? C.crema : C.rojoClaro }]}>
          <Text style={[s.resultadoChip, { backgroundColor: sev.bg, color: sev.fg }]}>{sev.label}</Text>
          <Text style={s.resultadoTexto}>{resultadoTexto}</Text>
        </View>

        <Text style={s.sectionTitle}>Novedades ({data.total_matches})</Text>
        <View style={s.sectionDivider} />
        {data.severidad === 'error' ? (
          <Text style={s.para}>Error: {data.error_mensaje ?? 'No se obtuvo respuesta del proveedor.'}</Text>
        ) : data.matches.length === 0 ? (
          <View style={s.sinHallazgo}>
            <Text style={s.sinHallazgoText}>✓ Sin coincidencias en las listas restrictivas evaluadas.</Text>
          </View>
        ) : (
          <Novedades matches={data.matches} />
        )}

        <Text style={s.sectionTitle}>Alcance de la consulta</Text>
        <View style={s.sectionDivider} />
        <Text style={s.para}>
          Esta consulta se realizó contra el universo de listas restrictivas vinculantes y de referencia
          disponibles a través del proveedor de información Informa Colombia. El resultado refleja el estado
          de dichas fuentes en la fecha y hora indicadas. Las novedades listadas, cuando existen, identifican
          coincidencias que deben ser analizadas y resueltas por el oficial de cumplimiento del sujeto obligado.
        </Text>

        <View style={s.disclaimer} wrap={false}>
          <Text style={s.disclaimerTitle}>Naturaleza y responsabilidad</Text>
          <Text style={s.disclaimerText}>
            Este documento es una constancia operativa de la consulta efectuada con la herramienta MéTRIK. No
            constituye por sí mismo una decisión de debida diligencia ni un dictamen de riesgo. La valoración de
            las coincidencias, la debida diligencia ampliada y el eventual reporte de operación sospechosa (ROS)
            a la UIAF son responsabilidades indelegables del sujeto obligado. MéTRIK provee la herramienta de
            consulta; la información de las listas proviene del proveedor Informa Colombia.
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Powered by M{'é'}TRIK · metrik.com.co</Text>
          <Text style={s.footerText}>Ref. {data.consulta_local_id.slice(0, 8).toUpperCase()}{data.dual_id ? ` · ${data.dual_id.slice(0, 8).toUpperCase()}` : ''}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generarPDFSoporteDual(data: SoporteDualData): Promise<Buffer> {
  const fechaGen = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  return renderToBuffer(<DocumentoSoporte data={data} fechaGen={fechaGen} />);
}
