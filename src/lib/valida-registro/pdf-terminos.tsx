import 'server-only'
import React from 'react'
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer'
import { bloquesDeTexto, type Tramo } from '@/lib/valida-api/texto-documento'
import { PALETA } from '@/lib/marca/paleta'

/**
 * El PDF de los Términos del plan de UNA empresa, desde su `texto_md`. Es la evidencia que se guarda
 * en el bucket `aceptaciones-documentos` y cuya huella ata la aceptación (`documento_sha256`). El
 * texto es exactamente el de la fila: el PDF no agrega ni quita una palabra de lo que se acepta,
 * solo le da forma (mismo lector de bloques que la pantalla, `texto-documento.ts`).
 */

const s = StyleSheet.create({
  page: { paddingTop: 48, paddingBottom: 56, paddingHorizontal: 52, fontFamily: 'Helvetica', fontSize: 9.5, color: PALETA.tinta, lineHeight: 1.5 },
  h1: { fontSize: 15, fontFamily: 'Helvetica-Bold', marginBottom: 10 },
  h2: { fontSize: 11.5, fontFamily: 'Helvetica-Bold', marginTop: 10, marginBottom: 5 },
  h3: { fontSize: 10, fontFamily: 'Helvetica-Bold', marginTop: 8, marginBottom: 4 },
  p: { marginBottom: 6, textAlign: 'justify' },
  item: { flexDirection: 'row', marginBottom: 3 },
  guion: { width: 10 },
  negrita: { fontFamily: 'Helvetica-Bold' },
  pie: { position: 'absolute', bottom: 24, left: 52, right: 52, fontSize: 7, color: PALETA.tintaSuave, textAlign: 'center' },
})

function Tramos({ tramos }: { tramos: Tramo[] }) {
  return (
    <>
      {tramos.map((t, i) => (
        <Text key={i} style={t.negrita ? s.negrita : undefined}>
          {t.texto}
        </Text>
      ))}
    </>
  )
}

function DocumentoTerminos({ textoMd, pie }: { textoMd: string; pie: string }) {
  return (
    <Document>
      <Page size="LETTER" style={s.page} wrap>
        {bloquesDeTexto(textoMd).map((b, i) => {
          if (b.tipo === 'titulo') {
            return (
              <Text key={i} style={b.nivel === 1 ? s.h1 : b.nivel === 2 ? s.h2 : s.h3}>
                <Tramos tramos={b.tramos} />
              </Text>
            )
          }
          if (b.tipo === 'lista') {
            return (
              <View key={i}>
                {b.items.map((it, j) => (
                  <View key={j} style={s.item}>
                    <Text style={s.guion}>-</Text>
                    <Text style={{ flex: 1 }}>
                      <Tramos tramos={it} />
                    </Text>
                  </View>
                ))}
              </View>
            )
          }
          return (
            <Text key={i} style={s.p}>
              <Tramos tramos={b.tramos} />
            </Text>
          )
        })}
        <Text style={s.pie} render={({ pageNumber, totalPages }) => `${pie} · Página ${pageNumber} de ${totalPages}`} fixed />
      </Page>
    </Document>
  )
}

export async function pdfTerminos(textoMd: string, pie: string): Promise<Buffer> {
  return renderToBuffer(<DocumentoTerminos textoMd={textoMd} pie={pie} />)
}
