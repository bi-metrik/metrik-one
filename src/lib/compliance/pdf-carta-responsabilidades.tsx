import React from 'react';
import { Document, Page, Text, View, StyleSheet, renderToBuffer, Svg, Line } from '@react-pdf/renderer';
import { formatFecha } from '@/lib/dates/bogota';

/**
 * Carta de asignación de responsabilidades (R2).
 *
 * ES LA PIEZA QUE HACE INNECESARIA LA CUENTA. El responsable de un control no
 * necesita entrar a ONE para reconocer que responde: firma este papel. Dar
 * cuentas masivamente CREA riesgo — el módulo expone quién quedó reportado en
 * listas restrictivas, y eso es dato sensible que un tesorero no necesita.
 *
 * Documento DISTINTO de la autorización de contratación
 * (`pdf-autorizacion-contratacion.tsx`): aquel dice que el oficial decidió sobre
 * una contraparte con hallazgo; este dice qué se espera de un cargo y con qué
 * evidencia lo tiene que sustentar.
 *
 * Se genera 100% desde datos guardados: no golpea Informa ni Valida, así que
 * emitirlo no cuesta una consulta facturable.
 *
 * Lleva la firma en PAPEL a propósito. La firma dentro de la aplicación está
 * construida pero apagada (`FIRMA_ONE_HABILITADA`) hasta que el CLO se pronuncie
 * sobre su valor probatorio frente a un documento firmado.
 */

// Branding tokens — cerebro/conceptos/identidad-visual-metrik.md
const C = {
  negro: '#1A1A1A',
  gris: '#6B7280',
  verde: '#10B981',
  blanco: '#FFFFFF',
  grisLinea: '#E5E7EB',
  crema: '#F5F4F2',
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

  para: { fontSize: 8.5, color: C.gris, marginBottom: 6, lineHeight: 1.5, textAlign: 'justify' },

  control: { borderWidth: 0.5, borderColor: C.grisLinea, borderRadius: 3, marginBottom: 7, overflow: 'hidden' },
  controlHead: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.crema, paddingVertical: 5, paddingHorizontal: 7, gap: 7 },
  controlRef: { fontSize: 8, fontFamily: 'Helvetica-Bold', color: C.blanco, backgroundColor: C.negro, paddingVertical: 2, paddingHorizontal: 5, borderRadius: 2 },
  controlNombre: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.negro, flex: 1 },
  controlBody: { paddingVertical: 6, paddingHorizontal: 7 },
  campo: { flexDirection: 'row', marginBottom: 3 },
  campoLabel: { fontSize: 7.5, color: C.gris, textTransform: 'uppercase', letterSpacing: 0.3, width: 92 },
  campoValor: { fontSize: 8.5, color: C.negro, flex: 1, lineHeight: 1.45, textAlign: 'justify' },

  firma: { marginTop: 16, paddingTop: 10, borderTop: `0.5pt solid ${C.grisLinea}`, flexDirection: 'row', justifyContent: 'space-between' },
  firmaCol: { flexDirection: 'column', width: '48%' },
  firmaLinea: { borderTop: `0.5pt solid ${C.negro}`, marginTop: 34, paddingTop: 4 },
  firmaNombre: { fontSize: 9.5, fontFamily: 'Helvetica-Bold', color: C.negro },
  firmaRol: { fontSize: 7.5, color: C.gris },

  disclaimer: { marginTop: 10, padding: 8, backgroundColor: C.crema, borderLeft: `2pt solid ${C.gris}`, borderRadius: 2 },
  disclaimerTitle: { fontSize: 7, fontFamily: 'Helvetica-Bold', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  disclaimerText: { fontSize: 7, color: C.gris, lineHeight: 1.4, textAlign: 'justify' },

  footer: { position: 'absolute', bottom: 22, left: 38, right: 38, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 6, borderTop: `0.5pt solid ${C.grisLinea}` },
  footerText: { fontSize: 6.5, color: C.gris },
});

/** Un control tal como se le presenta al responsable en la carta. */
export type ControlEnCarta = {
  referencia: string | null;
  nombre_control: string | null;
  /** Qué se espera que haga. */
  actividad_control: string | null;
  /** Cada cuánto. */
  periodicidad: string | null;
  tipo_control: string | null;
  /** Qué evidencia tiene que conservar. */
  evidencia: string | null;
};

export type CartaResponsabilidadesData = {
  workspace_nombre: string;
  cargo_id: string;
  cargo_nombre: string;
  controles: ControlEnCarta[];
  /** Nombre del oficial que emite. Sin nombre resuelto se imprime el rol, nunca un uuid. */
  emitida_por_nombre: string | null;
  emitida_en: string;
  /**
   * Si el cargo YA aceptó, se imprime a quién y cuándo. La carta sigue siendo
   * la misma; lo que cambia es que deja de ser una solicitud y pasa a ser la
   * constancia de lo que se firmó.
   */
  aceptacion_previa: { persona_nombre: string; fecha_aceptacion: string } | null;
};

function fechaLarga(iso: string): string {
  return formatFecha(iso, { day: '2-digit', month: 'long', year: 'numeric' }) ?? iso;
}

function fechaHora(iso: string): string {
  return (
    formatFecha(iso, { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' }) ?? iso
  );
}

/**
 * La periodicidad se guarda como clave (`continuo`, `trimestral`). Al
 * responsable se le imprime en su idioma; una clave técnica en un documento que
 * alguien firma es una forma barata de perder credibilidad.
 */
const PERIODICIDAD_LABEL: Record<string, string> = {
  continuo: 'Permanente (cada vez que ocurre el evento)',
  diario: 'Diaria',
  semanal: 'Semanal',
  mensual: 'Mensual',
  bimestral: 'Bimestral',
  trimestral: 'Trimestral',
  semestral: 'Semestral',
  anual: 'Anual',
  eventual: 'Eventual',
};

const TIPO_LABEL: Record<string, string> = {
  preventivo: 'Preventivo',
  detectivo: 'Detectivo',
  correctivo: 'Correctivo',
};

function etiqueta(mapa: Record<string, string>, valor: string | null): string {
  if (!valor) return 'Sin definir';
  return mapa[valor.toLowerCase()] ?? valor;
}

function MetrikWordmark() {
  return (
    <View style={s.brand}>
      <Text style={s.brandWordmark}>M{'é'}TRIK</Text>
      <Svg width={80} height={3} style={s.brandLine}>
        <Line x1={0} y1={1.5} x2={80} y2={1.5} strokeWidth={2.5} stroke={C.verde} />
      </Svg>
      <Text style={s.brandProduct}>Compliance</Text>
      <Text style={s.brandTagline}>Asignación de responsabilidades</Text>
    </View>
  );
}

function ControlCard({ control }: { control: ControlEnCarta }) {
  return (
    <View style={s.control} wrap={false}>
      <View style={s.controlHead}>
        {control.referencia ? <Text style={s.controlRef}>{control.referencia}</Text> : null}
        <Text style={s.controlNombre}>{control.nombre_control ?? 'Control sin nombre'}</Text>
      </View>
      <View style={s.controlBody}>
        <View style={s.campo}>
          <Text style={s.campoLabel}>Actividad</Text>
          <Text style={s.campoValor}>
            {control.actividad_control?.trim() ||
              'La matriz de riesgo no describe la actividad de este control. Solicítala al oficial de cumplimiento antes de firmar.'}
          </Text>
        </View>
        <View style={s.campo}>
          <Text style={s.campoLabel}>Periodicidad</Text>
          <Text style={s.campoValor}>{etiqueta(PERIODICIDAD_LABEL, control.periodicidad)}</Text>
        </View>
        <View style={s.campo}>
          <Text style={s.campoLabel}>Tipo de control</Text>
          <Text style={s.campoValor}>{etiqueta(TIPO_LABEL, control.tipo_control)}</Text>
        </View>
        <View style={s.campo}>
          <Text style={s.campoLabel}>Evidencia</Text>
          <Text style={s.campoValor}>
            {control.evidencia?.trim() ||
              'Conserve el soporte que demuestre la ejecución del control (registro, formato, correo o expediente), con fecha y responsable identificables.'}
          </Text>
        </View>
      </View>
    </View>
  );
}

function DocumentoCarta({
  data,
  fechaGen,
}: {
  data: CartaResponsabilidadesData;
  fechaGen: string;
}) {
  return (
    <Document
      title={`Carta de asignación de responsabilidades — ${data.cargo_nombre}`}
      author="MéTRIK"
      subject="Asignación de responsabilidades sobre controles"
    >
      <Page size="A4" style={s.page}>
        <View style={s.header}>
          <MetrikWordmark />
          <View style={s.meta}>
            <Text style={s.metaLineBold}>{data.workspace_nombre}</Text>
            <Text style={s.metaLine}>Emitido: {fechaGen}</Text>
            <Text style={s.metaLine}>Ref. {data.cargo_id.slice(0, 8).toUpperCase()}</Text>
          </View>
        </View>

        <Text style={s.docTitle}>Carta de asignación de responsabilidades</Text>
        <Text style={s.docSubtitle}>
          Sistema de administración del riesgo de LA/FT/FPADM y programa de transparencia y ética
          empresarial
        </Text>

        <View style={s.idGrid}>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Cargo responsable</Text>
            <Text style={s.idValue}>{data.cargo_nombre}</Text>
          </View>
          <View style={s.idCell}>
            <Text style={s.idLabel}>Controles asignados</Text>
            <Text style={s.idValue}>{data.controles.length}</Text>
          </View>
          {data.aceptacion_previa ? (
            <>
              <View style={s.idCell}>
                <Text style={s.idLabel}>Aceptada por</Text>
                <Text style={s.idValue}>{data.aceptacion_previa.persona_nombre}</Text>
              </View>
              <View style={s.idCell}>
                <Text style={s.idLabel}>Fecha de aceptación</Text>
                <Text style={s.idValue}>{fechaLarga(data.aceptacion_previa.fecha_aceptacion)}</Text>
              </View>
            </>
          ) : null}
        </View>

        <Text style={s.para}>
          {data.workspace_nombre} ha designado al cargo de <Text style={{ color: C.negro, fontFamily: 'Helvetica-Bold' }}>{data.cargo_nombre}</Text>{' '}
          como responsable de los controles que se relacionan a continuación. Para cada uno se indica
          la actividad esperada, con qué periodicidad debe ejecutarse y qué evidencia debe
          conservarse.
        </Text>
        <Text style={s.para}>
          La responsabilidad recae sobre el CARGO, no sobre la persona: quien lo ocupe en cada momento
          asume estos controles. Al firmar, quien ocupa el cargo declara que conoce las actividades
          descritas, que dispone de los medios para ejecutarlas y que conservará la evidencia
          correspondiente a disposición del oficial de cumplimiento y de los entes de control.
        </Text>

        <Text style={s.sectionTitle}>Controles a cargo ({data.controles.length})</Text>
        <View style={s.sectionDivider} />
        {data.controles.map((c, i) => (
          <ControlCard key={c.referencia ?? String(i)} control={c} />
        ))}

        <View style={s.firma} wrap={false}>
          <View style={s.firmaCol}>
            <View style={s.firmaLinea}>
              <Text style={s.firmaNombre}>
                {data.aceptacion_previa?.persona_nombre ?? 'Nombre y documento de identidad'}
              </Text>
              <Text style={s.firmaRol}>{data.cargo_nombre} · Acepta la responsabilidad</Text>
            </View>
          </View>
          <View style={s.firmaCol}>
            <View style={s.firmaLinea}>
              <Text style={s.firmaNombre}>{data.emitida_por_nombre || 'Oficial de cumplimiento'}</Text>
              <Text style={s.firmaRol}>Oficial de cumplimiento · {data.workspace_nombre}</Text>
            </View>
          </View>
        </View>

        <View style={s.disclaimer} wrap={false}>
          <Text style={s.disclaimerTitle}>Alcance de este documento</Text>
          <Text style={s.disclaimerText}>
            Esta carta relaciona los controles que la matriz de riesgo del sujeto obligado tenía
            asignados a este cargo al {fechaHora(data.emitida_en)}. Si un control se modifica o se
            asigna a otro cargo con posterioridad, la aceptación registrada sobre esta carta deja de
            estar vigente y debe emitirse una nueva. La firma de este documento no traslada al
            firmante las responsabilidades indelegables del oficial de cumplimiento ni las del órgano
            de administración. MéTRIK provee la herramienta que registra la asignación y su
            aceptación; el diseño de los controles y la valoración del riesgo son responsabilidad del
            sujeto obligado.
          </Text>
        </View>

        <View style={s.footer} fixed>
          <Text style={s.footerText}>Powered by M{'é'}TRIK · metrik.com.co</Text>
          <Text style={s.footerText}>Ref. {data.cargo_id.slice(0, 8).toUpperCase()}</Text>
          <Text style={s.footerText} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function generarPDFCartaResponsabilidades(
  data: CartaResponsabilidadesData,
): Promise<Buffer> {
  const fechaGen = formatFecha(new Date(), { day: '2-digit', month: 'short', year: 'numeric' })!;
  return renderToBuffer(<DocumentoCarta data={data} fechaGen={fechaGen} />);
}
