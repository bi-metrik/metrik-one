import React from 'react';
import crypto from 'node:crypto';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Svg, Line } from '@react-pdf/renderer';
import type { ConfigPersistida } from './segmentacion-presets';
import {
  PRESET_LABEL,
  VARIABLE_CONTRAPARTE_LABEL,
  VARIABLE_EMPLEADO_LABEL,
} from './segmentacion-presets';

// Branding tokens — cerebro/conceptos/identidad-visual-metrik.md
const C = {
  negro: '#1A1A1A',
  gris: '#6B7280',
  verde: '#10B981',
  verdeDark: '#059669',
  rojo: '#EF4444',
  amarillo: '#F59E0B',
  amarilloClaro: '#FBBF24',
  blanco: '#FFFFFF',
  grisLinea: '#E5E7EB',
  crema: '#F5F4F2',
};

const s = StyleSheet.create({
  page: { paddingTop: 38, paddingBottom: 50, paddingHorizontal: 38, fontFamily: 'Helvetica', fontSize: 9, color: C.negro, backgroundColor: C.blanco, lineHeight: 1.5 },

  // Header
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 14, paddingBottom: 10, borderBottom: `0.5pt solid ${C.grisLinea}` },
  brand: { flexDirection: 'column' },
  brandWordmark: { fontSize: 20, fontFamily: 'Helvetica-Bold', color: C.negro },
  brandLine: { marginTop: 1 },
  brandProduct: { fontSize: 9, color: C.gris, marginTop: 4, fontFamily: 'Helvetica' },
  brandTagline: { fontSize: 7, color: C.gris, marginTop: 1, textTransform: 'uppercase', letterSpacing: 0.5 },
  meta: { flexDirection: 'column', alignItems: 'flex-end' },
  metaLine: { fontSize: 7, color: C.gris },
  metaLineBold: { fontSize: 8, color: C.negro, fontFamily: 'Helvetica-Bold', marginBottom: 2 },

  // Title
  docTitle: { fontSize: 16, fontFamily: 'Helvetica-Bold', color: C.negro, marginTop: 6, marginBottom: 4 },
  docSubtitle: { fontSize: 9, color: C.gris, marginBottom: 12 },

  // Sections
  sectionTitle: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.negro, marginTop: 10, marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  sectionDivider: { height: 0.5, backgroundColor: C.grisLinea, marginBottom: 6 },
  para: { fontSize: 9, marginBottom: 6, lineHeight: 1.5 },
  paraGris: { fontSize: 8.5, color: C.gris, marginBottom: 6, lineHeight: 1.5 },

  // Identificacion
  idGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: C.crema, padding: 8, borderRadius: 3, borderLeftWidth: 1.5, borderLeftColor: C.verde, marginBottom: 10 },
  idCell: { width: '50%', marginBottom: 4 },
  idLabel: { fontSize: 6.5, color: C.gris, textTransform: 'uppercase', letterSpacing: 0.4, fontFamily: 'Helvetica-Bold' },
  idValue: { fontSize: 9, color: C.negro, fontFamily: 'Helvetica-Bold', marginTop: 1 },

  // Tables
  table: { borderTop: `0.5pt solid ${C.grisLinea}` },
  tableHeader: { flexDirection: 'row', backgroundColor: C.crema, paddingVertical: 3, paddingHorizontal: 4 },
  tableRow: { flexDirection: 'row', paddingVertical: 3, paddingHorizontal: 4, borderBottom: `0.3pt solid ${C.grisLinea}` },
  th: { fontSize: 7, fontFamily: 'Helvetica-Bold', color: C.gris, textTransform: 'uppercase', letterSpacing: 0.3 },
  td: { fontSize: 8, color: C.negro },
  cVar: { flex: 2 },
  cPeso: { width: 50, textAlign: 'right' },

  // Umbrales row
  umbralesRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  umbralBox: { flex: 1, padding: 5, borderRadius: 3, borderLeftWidth: 1.5 },
  umbralLabel: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4 },
  umbralValor: { fontSize: 11, fontFamily: 'Helvetica-Bold', color: C.negro, marginTop: 2 },
  umbralFrec: { fontSize: 7, color: C.gris, marginTop: 1 },

  // Mapeo Valida
  mapeoRow: { flexDirection: 'row', paddingVertical: 2.5, paddingHorizontal: 4, borderBottom: `0.3pt solid ${C.grisLinea}` },
  sevChip: { width: 75, paddingHorizontal: 4, paddingVertical: 1.5, borderRadius: 2, fontSize: 7, fontFamily: 'Helvetica-Bold', textAlign: 'center' },
  mapDesc: { flex: 1, fontSize: 8, color: C.negro, paddingHorizontal: 6 },
  mapBandera: { width: 110, fontSize: 7, color: C.gris, fontFamily: 'Helvetica-Oblique', paddingHorizontal: 4 },

  // Firma
  firmaBox: { marginTop: 16, padding: 10, backgroundColor: C.crema, borderRadius: 3 },
  firmaTitulo: { fontSize: 9, fontFamily: 'Helvetica-Bold', color: C.negro, marginBottom: 8 },
  firmaText: { fontSize: 8, color: C.negro, marginBottom: 14, textAlign: 'justify' },
  firmaLineas: { flexDirection: 'row', gap: 16, marginTop: 16 },
  firmaCol: { flex: 1 },
  firmaLinea: { borderTop: `1pt solid ${C.negro}`, marginBottom: 4 },
  firmaLabel: { fontSize: 7, color: C.gris, textTransform: 'uppercase', letterSpacing: 0.4 },

  // Disclaimer
  disclaimer: { marginTop: 10, padding: 8, backgroundColor: C.crema, borderLeft: `2pt solid ${C.gris}`, borderRadius: 2 },
  disclaimerTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  disclaimerText: { fontSize: 7, color: C.gris, lineHeight: 1.4, textAlign: 'justify' },

  // Footer
  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: `0.5pt solid ${C.grisLinea}` },
  footerText: { fontSize: 6.5, color: C.gris },
  footerHash: { fontSize: 6.5, fontFamily: 'Helvetica-Bold', color: C.negro },
});

export type MetodologiaData = {
  workspace_nombre: string;
  config: ConfigPersistida;
  aplicada_por_nombre: string | null;
};

function computarHashMetodologia(data: MetodologiaData): string {
  const c = data.config;
  const payload = JSON.stringify({
    workspace: data.workspace_nombre,
    preset: c.preset,
    pesos_c: c.pesos_contrapartes,
    pesos_e: c.pesos_empleados,
    umbrales_c: c.umbrales_contrapartes,
    umbrales_e: c.umbrales_empleados,
    version: c.version,
    aplicada_at: c.aplicada_at,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function MetrikWordmark() {
  return (
    <View style={s.brand}>
      <Text style={s.brandWordmark}>M{'\u00e9'}TRIK</Text>
      <Svg width={80} height={3} style={s.brandLine}>
        <Line x1={0} y1={1.5} x2={80} y2={1.5} strokeWidth={2.5} stroke={C.verde} />
      </Svg>
      <Text style={s.brandProduct}>Valida</Text>
      <Text style={s.brandTagline}>Metodología de segmentación SARLAFT</Text>
    </View>
  );
}

function PesosTabla({ pesos, labels }: { pesos: Record<string, number>; labels: Record<string, string> }) {
  return (
    <View style={s.table}>
      <View style={s.tableHeader}>
        <Text style={[s.th, s.cVar]}>Factor</Text>
        <Text style={[s.th, s.cPeso]}>Peso</Text>
      </View>
      {Object.entries(pesos).map(([k, v]) => (
        <View key={k} style={s.tableRow}>
          <Text style={[s.td, s.cVar]}>{labels[k] ?? k}</Text>
          <Text style={[s.td, s.cPeso, { fontFamily: 'Helvetica-Bold' }]}>{Math.round(v * 100)} %</Text>
        </View>
      ))}
    </View>
  );
}

function UmbralesRow({ umbrales }: { umbrales: ConfigPersistida['umbrales_contrapartes'] }) {
  return (
    <View style={s.umbralesRow}>
      <View style={[s.umbralBox, { borderLeftColor: C.rojo, backgroundColor: '#FEF2F2' }]}>
        <Text style={[s.umbralLabel, { color: C.rojo }]}>Alto si ≥</Text>
        <Text style={s.umbralValor}>{umbrales.alto_min.toFixed(2)}</Text>
        <Text style={s.umbralFrec}>Revisión cada {umbrales.frec_alto_meses} meses</Text>
      </View>
      <View style={[s.umbralBox, { borderLeftColor: C.amarillo, backgroundColor: '#FFFBEB' }]}>
        <Text style={[s.umbralLabel, { color: '#92400E' }]}>Medio si ≥</Text>
        <Text style={s.umbralValor}>{umbrales.medio_min.toFixed(2)}</Text>
        <Text style={s.umbralFrec}>Revisión cada {umbrales.frec_medio_meses} meses</Text>
      </View>
      <View style={[s.umbralBox, { borderLeftColor: C.verde, backgroundColor: '#ECFDF5' }]}>
        <Text style={[s.umbralLabel, { color: C.verdeDark }]}>Bajo si {'<'}</Text>
        <Text style={s.umbralValor}>{umbrales.medio_min.toFixed(2)}</Text>
        <Text style={s.umbralFrec}>Revisión cada {umbrales.frec_bajo_meses} meses</Text>
      </View>
    </View>
  );
}

const MAPEO_VALIDA: Array<{ sev: string; bg: string; fg: string; desc: string; bandera: string }> = [
  { sev: 'Alto', bg: C.rojo, fg: C.blanco, desc: 'Coincidencia exacta en lista vinculante (ONU, CSN Colombia).', bandera: 'Bloqueo + ROS UIAF' },
  { sev: 'Medio · PEP', bg: C.amarillo, fg: C.negro, desc: 'Coincidencia exacta en PEP Colombia.', bandera: 'Diligencia ampliada (Decreto 830/2021)' },
  { sev: 'Medio · ref.', bg: C.amarillo, fg: C.negro, desc: 'Coincidencia exacta en lista no vinculante (OFAC, UE).', bandera: 'Política interna' },
  { sev: 'Bajo', bg: C.amarilloClaro, fg: C.negro, desc: 'Coincidencia posible (puntaje 70-95%).', bandera: '—' },
  { sev: 'Informativo', bg: C.gris, fg: C.blanco, desc: 'Solo referencia internacional sin vinculancia local.', bandera: '—' },
  { sev: 'Sin hallazgo', bg: C.verde, fg: C.blanco, desc: 'Sin coincidencias.', bandera: '—' },
  { sev: 'Error', bg: C.negro, fg: C.blanco, desc: 'Fallo técnico durante la consulta.', bandera: 'No avanzar vinculación' },
];

function MapeoValida() {
  return (
    <View style={s.table}>
      <View style={s.tableHeader}>
        <Text style={[s.th, { width: 75 }]}>Severidad</Text>
        <Text style={[s.th, { flex: 1, paddingHorizontal: 6 }]}>Cuándo aparece</Text>
        <Text style={[s.th, { width: 110, paddingHorizontal: 4 }]}>Bandera / Acción</Text>
      </View>
      {MAPEO_VALIDA.map(m => (
        <View key={m.sev} style={s.mapeoRow} wrap={false}>
          <View style={[s.sevChip, { backgroundColor: m.bg }]}>
            <Text style={{ color: m.fg }}>{m.sev}</Text>
          </View>
          <Text style={s.mapDesc}>{m.desc}</Text>
          <Text style={s.mapBandera}>{m.bandera}</Text>
        </View>
      ))}
    </View>
  );
}

function DocumentoMetodologia({ data, hash, fechaGen }: { data: MetodologiaData; hash: string; fechaGen: string }) {
  const c = data.config;
  return (
    <Document title="Metodología de segmentación SARLAFT" author="MeTRIK SAS · Valida">
      <Page size="A4" style={s.page}>
        {/* Header */}
        <View style={s.header}>
          <MetrikWordmark />
          <View style={s.meta}>
            <Text style={s.metaLine}>Versión</Text>
            <Text style={s.metaLineBold}>v{c.version}</Text>
            <Text style={s.metaLine}>Aplicada</Text>
            <Text style={s.metaLineBold}>{c.aplicada_at ? new Date(c.aplicada_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</Text>
            <Text style={s.metaLine}>Generado</Text>
            <Text style={s.metaLineBold}>{fechaGen}</Text>
          </View>
        </View>

        <Text style={s.docTitle}>Metodología de segmentación SARLAFT</Text>
        <Text style={s.docSubtitle}>
          Documento auditable de la metodología activa para clasificación de riesgo de contrapartes y empleados.
        </Text>

        {/* Identificacion */}
        <View style={s.idGrid}>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Sujeto obligado</Text>
            <Text style={s.idValue}>{data.workspace_nombre}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Preset base</Text>
            <Text style={s.idValue}>{PRESET_LABEL[c.preset]}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Aplicada por</Text>
            <Text style={s.idValue}>{data.aplicada_por_nombre ?? '—'}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Versión / disclaimer</Text>
            <Text style={s.idValue}>v{c.version} · {c.disclaimer_aceptado ? 'Aceptado' : 'Pendiente'}</Text>
          </View>
        </View>

        {/* Pesos contrapartes */}
        <Text style={s.sectionTitle}>1. Pesos por factor — Contrapartes</Text>
        <View style={s.sectionDivider} />
        <PesosTabla pesos={c.pesos_contrapartes} labels={VARIABLE_CONTRAPARTE_LABEL} />

        <Text style={s.sectionTitle}>2. Umbrales — Contrapartes</Text>
        <View style={s.sectionDivider} />
        <UmbralesRow umbrales={c.umbrales_contrapartes} />

        {/* Pesos empleados */}
        <Text style={s.sectionTitle}>3. Pesos por factor — Empleados</Text>
        <View style={s.sectionDivider} />
        <PesosTabla pesos={c.pesos_empleados} labels={VARIABLE_EMPLEADO_LABEL} />

        <Text style={s.sectionTitle}>4. Umbrales — Empleados</Text>
        <View style={s.sectionDivider} />
        <UmbralesRow umbrales={c.umbrales_empleados} />

        {/* Mapeo Valida */}
        <Text style={s.sectionTitle}>5. Mapeo severidad Valida → factor «PEP + Listas»</Text>
        <View style={s.sectionDivider} />
        <MapeoValida />

        {/* Disclaimer */}
        <View style={s.disclaimer} wrap={false}>
          <Text style={s.disclaimerTitle}>Naturaleza y responsabilidad</Text>
          <Text style={s.disclaimerText}>
            Esta metodología fue parametrizada por el sujeto obligado utilizando la herramienta MéTRIK Valida.
            Los presets sugeridos son referencia inicial — la responsabilidad de revisar, ajustar y documentar
            la metodología como propia corresponde íntegramente al sujeto obligado, conforme a la Circular Básica
            Jurídica SFC C.E. 006/25, Circular 100-000016/2020 Supersociedades y Resolución 2328/2025
            Supertransporte. MéTRIK provee la herramienta, no la metodología. Las decisiones de clasificación
            de clientes, debida diligencia ampliada y reporte ROS a la UIAF son indelegables.
          </Text>
        </View>

        {/* Firma */}
        <View style={s.firmaBox} wrap={false}>
          <Text style={s.firmaTitulo}>Constancia y firma</Text>
          <Text style={s.firmaText}>
            En constancia de lo anterior, el oficial de cumplimiento del sujeto obligado declara que conoce
            y aprueba la metodología descrita en este documento, la incorpora al Manual SARLAFT de la entidad
            y asume la responsabilidad por las decisiones derivadas de su aplicación.
          </Text>
          <View style={s.firmaLineas}>
            <View style={s.firmaCol}>
              <View style={s.firmaLinea} />
              <Text style={s.firmaLabel}>Nombre y firma</Text>
              <Text style={s.firmaLabel}>Oficial de cumplimiento</Text>
            </View>
            <View style={s.firmaCol}>
              <View style={s.firmaLinea} />
              <Text style={s.firmaLabel}>Cédula / Documento</Text>
              <Text style={s.firmaLabel}>Fecha de firma</Text>
            </View>
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footerText}>Powered by M{'\u00e9'}TRIK · metrik.com.co</Text>
          <Text style={s.footerHash}>Hash: {hash.slice(0, 24)}…</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generarPDFMetodologia(data: MetodologiaData): Promise<Buffer> {
  const hash = computarHashMetodologia(data);
  const fechaGen = new Date().toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
  return renderToBuffer(<DocumentoMetodologia data={data} hash={hash} fechaGen={fechaGen} />);
}
