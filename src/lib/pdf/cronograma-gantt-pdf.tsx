/**
 * Cronograma de ejecución para el CLIENTE: el Gantt de la versión publicada.
 *
 * Es el documento que más se mira durante una obra, así que el diseño responde a una
 * sola pregunta del cliente, «¿vamos a tiempo?», y la contesta tres veces con distinto
 * nivel de detalle: los KPIs de arriba (avance, entrega, desfase), la barra de cada
 * paso contra su plan y, al final, qué cambió frente a la versión que ya recibió.
 *
 * Tres decisiones que no se tocan sin pensarlo:
 *
 *  · El plan va en gris y el real en el color del workspace. Lo comprometido es el
 *    fondo; lo que pasó es la figura. Al revés, el ojo lee el plan como si fuera avance.
 *  · El tramo que se sale del plan va en ámbar, SOBRE la barra real. Un atraso tiene
 *    que verse sin leer números, y verse exactamente dónde empezó.
 *  · Las filas se paginan a mano, no con `fixed`. Un encabezado `fixed` de react-pdf se
 *    repite en la posición que tenía en la página 1, y en la 2 caería encima de la
 *    primera fila: cada página arma su propio eje de semanas.
 *
 * Todo lo que se dibuja sale de `construirGantt`. Esta plantilla no calcula desfases:
 * si lo hiciera, el PDF y la vista en pantalla podrían decirle cosas distintas al cliente.
 */

import { Document, Page, Text, View, Image as PdfImage } from '@react-pdf/renderer'

import { PALETA } from '@/lib/marca/paleta'
import {
  ETIQUETA_ESTADO,
  diasEntre,
  fechaCorta,
  fechaCortaAno,
  textoDesfase,
  type EstadoPaso,
  type FilaGantt,
  type ModeloGantt,
  type Tramo,
} from '@/lib/cronograma/gantt'
import type { EncabezadoGantt, VersionGantt } from '@/lib/cronograma/datos-gantt'

export interface CronogramaGanttPDFProps {
  encabezado: EncabezadoGantt
  version: VersionGantt | null
  modelo: ModeloGantt
}

// ── Geometría (LETTER horizontal: 792 × 612) ─────────────────────────────────
const MARGEN_X = 32
const ANCHO_UTIL = 792 - MARGEN_X * 2
const COL_NUM = 20
const COL_ACTIVIDAD = 190
const COL_ESTADO = 62
const ANCHO_EJE = ANCHO_UTIL - COL_NUM - COL_ACTIVIDAD - COL_ESTADO
const ALTO_FILA = 26
const FILAS_PRIMERA_PAGINA = 12
const FILAS_POR_PAGINA = 17
/** Lo que cabe en COL_ACTIVIDAD a 8 pt en negrita, medido sobre un render real. */
const MAX_CARACTERES_ACTIVIDAD = 40

const recortar = (texto: string, max: number) =>
  texto.length > max ? `${texto.slice(0, max - 1).trimEnd()}…` : texto

// ── Color ────────────────────────────────────────────────────────────────────
const TINTA = PALETA.tinta
const TINTA_SUAVE = PALETA.tintaSuave
const BORDE = '#E4E2DC'
const RAYA_SEMANA = '#EFEDE8'
const FONDO_SUAVE = '#F8F7F4'
const PLAN = '#C8CBD0'
const FUERA_DE_PLAN = PALETA.advertencia
const HOY = PALETA.alerta

const COLOR_ESTADO: Record<EstadoPaso, string> = {
  completado: '#2F7D4F',
  en_curso: '#2563A8',
  atrasado: PALETA.alerta,
  pendiente: TINTA_SUAVE,
  sin_fecha: '#A8A49C',
}

const HEX = /^#[0-9a-f]{6}$/i
const colorDe = (c: string | null) => (c && HEX.test(c) ? c : PALETA.acento)

/** `#0075ca` al `pct`% sobre blanco: tintes de marca sin depender de opacidades. */
function tinte(hex: string, pct: number): string {
  const p = pct / 100
  const canal = (i: number) =>
    Math.round(parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) * p + 255 * (1 - p))
  return '#' + [0, 1, 2].map(i => canal(i).toString(16).padStart(2, '0')).join('')
}

function enPuntos(t: Tramo, modelo: ModeloGantt): { left: number; width: number } {
  if (!modelo.desde || modelo.totalDias <= 0) return { left: 0, width: 0 }
  const porDia = ANCHO_EJE / modelo.totalDias
  return {
    left: diasEntre(modelo.desde, t.inicio) * porDia,
    width: Math.max((diasEntre(t.inicio, t.fin) + 1) * porDia, 2),
  }
}

function paginar(filas: FilaGantt[]): FilaGantt[][] {
  const paginas: FilaGantt[][] = [filas.slice(0, FILAS_PRIMERA_PAGINA)]
  for (let i = FILAS_PRIMERA_PAGINA; i < filas.length; i += FILAS_POR_PAGINA) {
    paginas.push(filas.slice(i, i + FILAS_POR_PAGINA))
  }
  return paginas
}

// ── Piezas ───────────────────────────────────────────────────────────────────

function Kpi({ etiqueta, valor, detalle, color = TINTA, children }: {
  etiqueta: string
  valor: string
  detalle?: string
  color?: string
  children?: React.ReactNode
}) {
  return (
    <View style={{ flex: 1, borderWidth: 0.75, borderColor: BORDE, borderRadius: 6, paddingVertical: 8, paddingHorizontal: 10, backgroundColor: '#FFFFFF' }}>
      <Text style={{ fontSize: 6.5, color: TINTA_SUAVE, letterSpacing: 0.8 }}>{etiqueta.toUpperCase()}</Text>
      <Text style={{ fontSize: 16, fontFamily: 'Helvetica-Bold', color, marginTop: 3 }}>{valor}</Text>
      {children}
      {detalle && <Text style={{ fontSize: 7, color: TINTA_SUAVE, marginTop: 3 }}>{detalle}</Text>}
    </View>
  )
}

function Leyenda({ primario }: { primario: string }) {
  const muestra = (color: string, alto: number) => (
    <View style={{ width: 16, height: alto, borderRadius: 2, backgroundColor: color, marginRight: 4 }} />
  )
  const item = (nodo: React.ReactNode, texto: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', marginRight: 14 }}>
      {nodo}
      <Text style={{ fontSize: 7, color: TINTA_SUAVE }}>{texto}</Text>
    </View>
  )
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      {item(muestra(PLAN, 5), 'Planeado')}
      {item(muestra(primario, 7), 'Real')}
      {item(muestra(FUERA_DE_PLAN, 7), 'Fuera de plan')}
      {item(<View style={{ width: 1.5, height: 10, backgroundColor: HOY, marginRight: 4 }} />, 'Hoy')}
    </View>
  )
}

function EncabezadoTabla({ modelo }: { modelo: ModeloGantt }) {
  // Con muchas semanas no caben todas las etiquetas: se rotula una de cada `paso`.
  const paso = Math.max(1, Math.ceil(modelo.semanas.length / 14))
  const anchoSemana = modelo.totalDias > 0 ? (ANCHO_EJE * 7) / modelo.totalDias : 0
  return (
    <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: TINTA, paddingBottom: 4, alignItems: 'flex-end' }}>
      <Text style={{ width: COL_NUM, fontSize: 6.5, color: TINTA_SUAVE }}>#</Text>
      <Text style={{ width: COL_ACTIVIDAD, fontSize: 6.5, color: TINTA_SUAVE, letterSpacing: 0.6 }}>ACTIVIDAD</Text>
      <Text style={{ width: COL_ESTADO, fontSize: 6.5, color: TINTA_SUAVE, letterSpacing: 0.6 }}>ESTADO</Text>
      <View style={{ width: ANCHO_EJE, height: 10, position: 'relative' }}>
        {modelo.semanas.map((s, i) =>
          // La última etiqueta se omite si se sale del eje: cortada por el borde se lee mal.
          i % paso === 0 && i * anchoSemana + 30 <= ANCHO_EJE ? (
            <Text
              key={s.inicio}
              style={{ position: 'absolute', left: i * anchoSemana + 2, top: 1, fontSize: 6.5, color: TINTA_SUAVE }}
            >
              {s.etiqueta}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  )
}

function FilaPdf({ fila, numero, modelo, primario, cebra }: {
  fila: FilaGantt
  numero: number
  modelo: ModeloGantt
  primario: string
  cebra: boolean
}) {
  const anchoSemana = modelo.totalDias > 0 ? (ANCHO_EJE * 7) / modelo.totalDias : 0
  const hoyVisible = modelo.desde && modelo.hasta && modelo.hoy >= modelo.desde && modelo.hoy <= modelo.hasta
  const xHoy = hoyVisible ? ((diasEntre(modelo.desde!, modelo.hoy) + 0.5) * ANCHO_EJE) / modelo.totalDias : null
  const plan = fila.plan ? enPuntos(fila.plan, modelo) : null
  const real = fila.real ? enPuntos(fila.real, modelo) : null
  const fuera = fila.fueraDePlan ? enPuntos(fila.fueraDePlan, modelo) : null
  const desfase = fila.desfaseDias !== null && fila.desfaseDias > 0 && fila.estado !== 'pendiente'

  return (
    <View
      wrap={false}
      style={{
        flexDirection: 'row',
        height: ALTO_FILA,
        alignItems: 'center',
        borderBottomWidth: 0.5,
        borderBottomColor: BORDE,
        backgroundColor: cebra ? FONDO_SUAVE : '#FFFFFF',
      }}
    >
      <Text style={{ width: COL_NUM, fontSize: 7, color: TINTA_SUAVE, paddingLeft: 2 }}>{String(numero).padStart(2, '0')}</Text>
      <View style={{ width: COL_ACTIVIDAD, paddingRight: 8 }}>
        {/* Una sola línea: la fila tiene alto fijo para que las barras caigan alineadas, y
            un nombre en dos líneas se monta sobre la fecha de abajo. */}
        <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: TINTA }} hyphenationCallback={w => [w]}>
          {recortar(fila.label, MAX_CARACTERES_ACTIVIDAD)}
        </Text>
        <Text style={{ fontSize: 6.5, color: TINTA_SUAVE, marginTop: 1.5 }}>
          {fila.plan ? `${fechaCorta(fila.plan.inicio)} a ${fechaCorta(fila.plan.fin)}` : 'Sin fechas planeadas'}
          {fila.responsable ? `  ·  ${fila.responsable}` : ''}
        </Text>
      </View>
      <View style={{ width: COL_ESTADO, paddingRight: 6 }}>
        <Text style={{ fontSize: 7, fontFamily: 'Helvetica-Bold', color: COLOR_ESTADO[fila.estado] }}>
          {ETIQUETA_ESTADO[fila.estado]}
        </Text>
        {desfase && (
          <Text style={{ fontSize: 6.5, color: PALETA.alerta, marginTop: 1 }}>+{fila.desfaseDias} d</Text>
        )}
      </View>

      <View style={{ width: ANCHO_EJE, height: ALTO_FILA, position: 'relative' }}>
        {modelo.semanas.map((s, i) => (
          <View
            key={s.inicio}
            style={{ position: 'absolute', left: i * anchoSemana, top: 0, bottom: 0, width: 0.5, backgroundColor: RAYA_SEMANA }}
          />
        ))}
        {plan && (
          <View style={{ position: 'absolute', left: plan.left, width: plan.width, top: 6, height: 5, borderRadius: 2.5, backgroundColor: PLAN }} />
        )}
        {real && (
          <View style={{ position: 'absolute', left: real.left, width: real.width, top: 13, height: 7, borderRadius: 3.5, backgroundColor: primario }} />
        )}
        {fuera && (
          <View style={{ position: 'absolute', left: fuera.left, width: fuera.width, top: 13, height: 7, borderRadius: 3.5, backgroundColor: FUERA_DE_PLAN }} />
        )}
        {xHoy !== null && (
          <View style={{ position: 'absolute', left: xHoy, top: 0, bottom: 0, width: 1, backgroundColor: HOY }} />
        )}
      </View>
    </View>
  )
}

function Pie({ encabezado, version }: { encabezado: EncabezadoGantt; version: VersionGantt | null }) {
  return (
    <View
      fixed
      style={{
        position: 'absolute',
        bottom: 18,
        left: MARGEN_X,
        right: MARGEN_X,
        borderTopWidth: 0.5,
        borderTopColor: BORDE,
        paddingTop: 5,
        flexDirection: 'row',
        justifyContent: 'space-between',
      }}
    >
      <Text style={{ fontSize: 6.5, color: TINTA_SUAVE }}>
        {encabezado.empresaEmisora}{encabezado.nitEmisor ? `  ·  NIT ${encabezado.nitEmisor}` : ''}
      </Text>
      <Text style={{ fontSize: 6.5, color: TINTA_SUAVE }}>
        {[encabezado.negocioCodigo, version ? `Versión ${version.numero}` : 'Borrador'].filter(Boolean).join('  ·  ')}
      </Text>
      <Text
        style={{ fontSize: 6.5, color: TINTA_SUAVE }}
        render={({ pageNumber, totalPages }) => `Página ${pageNumber} de ${totalPages}`}
      />
    </View>
  )
}

// ── Documento ────────────────────────────────────────────────────────────────

export default function CronogramaGanttPDF({ encabezado, version, modelo }: CronogramaGanttPDFProps) {
  const primario = colorDe(encabezado.colorPrimario)
  const { kpis } = modelo
  const paginas = paginar(modelo.filas)
  const atrasado = (kpis.desfaseDias ?? 0) > 0
  const corrida = kpis.entregaPlan && kpis.entregaProyectada && kpis.entregaProyectada > kpis.entregaPlan

  const estiloPagina = {
    paddingTop: 28,
    paddingBottom: 44,
    paddingHorizontal: MARGEN_X,
    fontFamily: 'Helvetica',
    color: TINTA,
    backgroundColor: '#FFFFFF',
  } as const

  return (
    <Document title={`Cronograma ${encabezado.negocioCodigo ?? encabezado.negocioNombre}`} author={encabezado.empresaEmisora}>
      {paginas.map((filas, indice) => {
        const primera = indice === 0
        const ultima = indice === paginas.length - 1
        const desplazamiento = primera ? 0 : FILAS_PRIMERA_PAGINA + (indice - 1) * FILAS_POR_PAGINA
        return (
          <Page key={indice} size="LETTER" orientation="landscape" style={estiloPagina}>
            {/* Franja de marca: el color del workspace en el borde, no en el fondo. */}
            <View fixed style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 5, backgroundColor: primario }} />

            {primera ? (
              <>
                {/* ── Encabezado ── */}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ width: '55%' }}>
                    {encabezado.logoUrl ? (
                      <PdfImage src={encabezado.logoUrl} style={{ width: 120, height: 38, objectFit: 'contain', objectPosition: 'left' }} />
                    ) : (
                      <Text style={{ fontSize: 12, fontFamily: 'Helvetica-Bold', color: primario }}>{encabezado.empresaEmisora}</Text>
                    )}
                    <Text style={{ fontSize: 7, color: TINTA_SUAVE, letterSpacing: 1.2, marginTop: 12 }}>
                      CRONOGRAMA DE EJECUCIÓN{encabezado.negocioCodigo ? `  ·  ${encabezado.negocioCodigo}` : ''}
                    </Text>
                    <Text style={{ fontSize: 19, fontFamily: 'Helvetica-Bold', color: TINTA, marginTop: 3 }}>
                      {encabezado.negocioNombre}
                    </Text>
                    {encabezado.cliente && (
                      <Text style={{ fontSize: 9, color: TINTA_SUAVE, marginTop: 3 }}>Cliente: {encabezado.cliente}</Text>
                    )}
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <View style={{ backgroundColor: version ? tinte(primario, 12) : FONDO_SUAVE, borderRadius: 10, paddingVertical: 4, paddingHorizontal: 10 }}>
                      <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: version ? primario : TINTA_SUAVE }}>
                        {version ? `Versión ${version.numero}  ·  publicada` : 'Borrador  ·  sin versión publicada'}
                      </Text>
                    </View>
                    {version && (
                      <Text style={{ fontSize: 7, color: TINTA_SUAVE, marginTop: 5 }}>
                        Publicada el {fechaCortaAno(version.publicada.slice(0, 10))}
                      </Text>
                    )}
                    <Text style={{ fontSize: 7, color: TINTA_SUAVE, marginTop: 2 }}>
                      Corte de avance: {fechaCortaAno(modelo.hoy)}
                    </Text>
                  </View>
                </View>

                {/* ── KPIs ── */}
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
                  <Kpi etiqueta="Avance" valor={`${kpis.avancePct}%`} detalle={`${kpis.completados} de ${kpis.total} actividades terminadas`} color={primario}>
                    <View style={{ height: 4, borderRadius: 2, backgroundColor: RAYA_SEMANA, marginTop: 4 }}>
                      <View style={{ height: 4, borderRadius: 2, width: `${kpis.avancePct}%`, backgroundColor: primario }} />
                    </View>
                  </Kpi>
                  <Kpi etiqueta="Entrega planeada" valor={kpis.entregaPlan ? fechaCortaAno(kpis.entregaPlan) : 'Sin fecha'} detalle="Según esta versión del plan" />
                  <Kpi
                    etiqueta="Entrega proyectada"
                    valor={kpis.entregaProyectada ? fechaCortaAno(kpis.entregaProyectada) : 'Sin fecha'}
                    detalle={corrida ? 'Corrida por el avance real' : 'En línea con el plan'}
                    color={corrida ? FUERA_DE_PLAN : TINTA}
                  />
                  <Kpi
                    etiqueta="Desfase"
                    valor={textoDesfase(kpis.desfaseDias)}
                    detalle={atrasado ? 'De la actividad más atrasada' : 'Ninguna actividad atrasada'}
                    color={atrasado ? PALETA.alerta : '#2F7D4F'}
                  />
                </View>

                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 14, marginBottom: 6 }}>
                  <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: TINTA }}>Plan contra real</Text>
                  <Leyenda primario={primario} />
                </View>
              </>
            ) : (
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <Text style={{ fontSize: 9, fontFamily: 'Helvetica-Bold', color: TINTA }}>
                  {encabezado.negocioNombre}  <Text style={{ fontFamily: 'Helvetica', color: TINTA_SUAVE }}>· continuación</Text>
                </Text>
                <Leyenda primario={primario} />
              </View>
            )}

            {modelo.filas.length === 0 ? (
              <Text style={{ fontSize: 9, color: TINTA_SUAVE, marginTop: 20 }}>Este cronograma todavía no tiene actividades.</Text>
            ) : (
              <>
                <EncabezadoTabla modelo={modelo} />
                {filas.map((fila, i) => (
                  <FilaPdf
                    key={fila.id}
                    fila={fila}
                    numero={desplazamiento + i + 1}
                    modelo={modelo}
                    primario={primario}
                    cebra={(desplazamiento + i) % 2 === 1}
                  />
                ))}
              </>
            )}

            {ultima && version && version.numero > 1 && version.cambios.length > 0 && (
              <View wrap={false} style={{ marginTop: 14, borderLeftWidth: 2, borderLeftColor: primario, paddingLeft: 10 }}>
                <Text style={{ fontSize: 8, fontFamily: 'Helvetica-Bold', color: TINTA }}>
                  Qué cambió frente a la versión {version.numero - 1}
                </Text>
                {version.cambios.slice(0, 8).map((c, i) => (
                  <Text key={i} style={{ fontSize: 7.5, color: TINTA_SUAVE, marginTop: 2.5 }}>·  {c}</Text>
                ))}
                {version.cambios.length > 8 && (
                  <Text style={{ fontSize: 7, color: TINTA_SUAVE, marginTop: 2.5 }}>y {version.cambios.length - 8} cambios más</Text>
                )}
              </View>
            )}

            <Pie encabezado={encabezado} version={version} />
          </Page>
        )
      })}
    </Document>
  )
}
