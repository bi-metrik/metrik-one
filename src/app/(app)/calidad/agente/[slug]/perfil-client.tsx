'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { C, MONO } from '../../components/tokens'
import {
  COMO_SUBIR,
  leerTendencia,
  type DiaPerfil,
  type LecturaTendencia,
  type PerfilAgente,
  type Semaforo,
} from '../../types'
import { formatBogotaFechaCorta, formatFecha } from '@/lib/dates/bogota'

/**
 * Perfil de agente. Responde dos preguntas y nada mas:
 *
 *   ¿este agente esta mejorando o empeorando?  → score por dia + lectura
 *   ¿que tiene que hacer para subir?           → recomendaciones
 *
 * ES UNA PANTALLA DE TRABAJO, no un muro. Se mira de cerca, en un escritorio,
 * mientras se prepara una sesion de entrenamiento: aqui la densidad ayuda y el
 * criterio de los tres metros no aplica.
 *
 * SIRVE PARA ENTRENAR, NO PARA CASTIGAR. El encuadre no es cosmetico: cambia
 * para que se usa la pantalla. Por eso las recomendaciones hablan de conductas
 * ("haz una pregunta cada dos minutos"), no de la persona ("no sabe escuchar"),
 * y el bloque fuerte se nombra igual que el debil.
 *
 * LA UNIDAD ES EL DIA, NO LA LLAMADA. Antes se graficaba una dispersion de
 * llamada por llamada y no se entendia: una llamada suelta no dice nada de la
 * persona, pudo tocarle un mal cliente. La pregunta que la pantalla contesta es
 * "como viene", y esa se responde con el dia.
 *
 * EN EL DIA SI SE JUNTAN LOS DOS EJES: `score = tecnica - penalizacion por
 * criticas`. Es lo contrario de lo que hacia la version por llamada, y el
 * cambio es deliberado. "Una llamada de 84 con una bandera critica no es una de
 * 70" sigue siendo cierto, porque una llamada es un hecho suelto; pero "como
 * opero hoy" SI es una sola pregunta, y ejecutar bien exponiendo a la empresa
 * en cada llamada no es un buen dia.
 *
 * Y no repite el semaforo unico que se revirtio en la v4: aquel era de tres
 * estados y al agregarlo por dia dejaba a todos en rojo. Este es continuo y la
 * penalizacion esta capada en 10 sobre 100.
 *
 * EL VOLUMEN SE VE. El punto crece con las llamadas del dia y la linea es la
 * media movil ponderada, no los puntos unidos: sin eso, un dia de una sola
 * llamada dibuja un derrumbe que no ocurrio.
 */

/**
 * Una fila del grafico. Los puntos y la recta comparten serie (Recharts la
 * quiere unica), asi que todo es opcional salvo la posicion en el eje temporal:
 * una fila de la recta no tiene semaforo y una llamada no tiene `recta`.
 */
type Fila = DiaPerfil & { x: number }

const COLOR_SEMAFORO: Record<Semaforo, string> = {
  verde: C.ok,
  amarillo: C.high,
  rojo: C.crit,
}

/**
 * El punto de un dia. El radio codifica CUANTAS llamadas lo sostienen.
 *
 * Radio por raiz del volumen, no lineal: lo que el ojo compara en un circulo es
 * el area, y con radio lineal un dia de 12 llamadas se ve cuatro veces mas
 * pesado que uno de 3, no cuatro veces mas grande en area. Con la raiz, area y
 * volumen van a la par.
 *
 * Sin esto la pantalla miente por omision: dos puntos identicos donde uno vale
 * 12 llamadas y el otro una sola.
 */
function PuntoDia({
  cx,
  cy,
  llamadas,
  maxLlamadas,
  seleccionado,
  onClick,
}: {
  cx?: number
  cy?: number
  llamadas: number
  maxLlamadas: number
  seleccionado: boolean
  onClick: () => void
}) {
  if (cx == null || cy == null) return null
  const r = 3 + 6 * Math.sqrt(llamadas / Math.max(1, maxLlamadas))
  return (
    <g style={{ cursor: 'pointer' }} onClick={onClick}>
      {/* Area de clic generosa: el punto chico es de 3 px y nadie acierta a eso. */}
      <circle cx={cx} cy={cy} r={Math.max(11, r + 5)} fill="transparent" />
      {seleccionado && (
        <circle cx={cx} cy={cy} r={r + 4} fill="none" stroke={C.ink} strokeWidth={1.5} />
      )}
      <circle cx={cx} cy={cy} r={r} fill={C.brand} fillOpacity={0.75} stroke={C.surface} strokeWidth={1.5} />
    </g>
  )
}

/** US$ sin decimales: la cifra importa, los centavos no. */
const usd = (n: number) =>
  `US$${Math.round(n).toLocaleString('es-CO')}`

const LECTURA: Record<LecturaTendencia, { titulo: string; tono: string }> = {
  alza: { titulo: 'Viene subiendo', tono: C.ok },
  baja: { titulo: 'Viene bajando', tono: C.crit },
  estable: { titulo: 'Se mantiene estable', tono: C.inkMuted },
  sin_datos: { titulo: 'Todavía sin suficientes llamadas', tono: C.inkMuted },
}

export default function PerfilAgenteClient({ perfil }: { perfil: PerfilAgente }) {
  const router = useRouter()
  const { kpis, tendencia, bloques, puntos, dias } = perfil
  const lectura = leerTendencia(tendencia)
  const nombreCorto = perfil.agente.split(' ')[0]

  // El dia cuyo detalle esta abierto. Null = ninguno.
  const [diaSel, setDiaSel] = useState<string | null>(null)

  // Serie del grafico: un punto por dia. `x` es el dia como numero para que el
  // eje sea temporal de verdad — si el agente no trabajo el martes, el hueco
  // tiene que verse, no cerrarse como si el miercoles siguiera al lunes.
  const t0 = Date.parse(`${perfil.desde}T00:00:00Z`)
  const serie: Fila[] = dias.map((d) => ({
    ...d,
    x: Math.round((Date.parse(`${d.dia}T00:00:00Z`) - t0) / 86_400_000),
  }))

  const maxLlamadas = Math.max(1, ...dias.map((d) => d.llamadas))

  // Las llamadas del dia abierto, para no perder el camino a la transcripcion
  // que si tenia la vista por llamada.
  const llamadasDelDia = diaSel ? puntos.filter((p) => p.dia === diaSel) : []
  const detalleDia = diaSel ? dias.find((d) => d.dia === diaSel) : undefined

  const fecha = (iso: string) => formatBogotaFechaCorta(iso) ?? iso

  // Tres, no diez: una sesion de entrenamiento no cabe mas, y una lista larga
  // se lee como un expediente. Entra solo el bloque con puntaje real en juego Y
  // margen real de mejora: quien saca 19 de 20 en Educacion tecnica no necesita
  // que le recomienden Educacion tecnica, aunque quede 1 punto sobre la mesa.
  const recomendaciones = bloques.filter((b) => b.enJuego >= 1 && b.pctLogro < 90).slice(0, 3)
  const fuerte = [...bloques].sort((a, b) => b.pctLogro - a.pctLogro)[0]

  return (
    <div style={{ padding: '26px 30px 64px', maxWidth: 1180, color: C.ink }}>
      {/* El camino de vuelta tiene que existir en las dos direcciones: si esta
          es la pantalla de entrada del ejecutor, desde aqui tiene que poder ir a
          sus llamadas sin pelear. Sin cifras: la respuesta ya esta abajo. */}
      <Link href="/calidad" style={{ fontSize: 13, color: C.inkMuted, textDecoration: 'none' }}>
        ← Ver todas las llamadas
      </Link>

      <div style={{ margin: '14px 0 20px' }}>
        <div style={eyebrow}>
          Perfil de agente · {fecha(perfil.desde)} a {fecha(perfil.hasta)}
        </div>
        <h1 style={{ fontSize: 25, fontWeight: 700, letterSpacing: '-.4px', margin: 0 }}>
          {perfil.agente}
        </h1>
        <p style={{ color: C.inkMuted, marginTop: 5, maxWidth: '70ch', fontSize: 13.5 }}>
          Cómo viene {nombreCorto}, hacia dónde va y dónde hay puntaje por ganar. La técnica da
          score; el cumplimiento levanta banderas. No se promedian.
        </p>
      </div>

      <section style={{ ...grid, gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
        <Kpi label="Llamadas" valor={String(kpis.llamadas)} nota="auditadas en el período" />
        <Kpi label="Técnica promedio" valor={String(kpis.tecnica)} nota="sobre 100 puntos" />
        {/* Un agente comercial se mide tambien por lo que cierra. Sin esta
            cifra el perfil parece un expediente de auditoria y no el panorama
            de su desempeño. Sale de las mismas llamadas que el ranking. */}
        <Kpi
          label="Ventas cerradas"
          valor={kpis.cierres.toLocaleString('es-CO')}
          nota={`${usd(kpis.vendidoUsd)} · ${kpis.pctCierre}% de ${kpis.llamadas.toLocaleString('es-CO')} llamadas`}
        />
        <Kpi
          label="Errores críticos"
          valor={String(kpis.criticas)}
          nota="eje de cumplimiento, aparte del score"
        />
      </section>

      {/* ── Score por día + trayectoria ────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Día por día</h2>
        <div style={{ ...card, padding: '18px 20px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 17, fontWeight: 700, color: LECTURA[lectura].tono }}>
              {LECTURA[lectura].titulo}
            </span>
            <span style={{ fontSize: 13, color: C.inkMuted }}>
              {lectura === 'sin_datos' ? (
                'Hacen falta al menos tres días con llamadas para leer una tendencia.'
              ) : (
                <>
                  {tendencia.porSemana !== null && (
                    <>
                      {tendencia.porSemana > 0 ? '+' : ''}
                      {tendencia.porSemana} puntos por semana
                      {' · '}
                    </>
                  )}
                  {tendencia.primeraMitad !== null && tendencia.segundaMitad !== null && (
                    <>
                      {tendencia.primeraMitad} → {tendencia.segundaMitad} entre la primera y la
                      segunda mitad
                    </>
                  )}
                </>
              )}
            </span>
          </div>
          {lectura === 'estable' && (
            <p style={{ fontSize: 12.5, color: C.inkMuted, margin: '6px 0 0' }}>
              El movimiento del período es menor que la variación normal entre sus propias
              llamadas: rinde parecido a como venía.
            </p>
          )}

          <div style={{ height: 300, marginTop: 14 }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={serie} margin={{ top: 8, right: 12, bottom: 4, left: -18 }}>
                <CartesianGrid stroke={C.line} vertical={false} />
                <XAxis
                  dataKey="x"
                  type="number"
                  domain={['dataMin', 'dataMax']}
                  tick={{ fill: C.inkMuted, fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: C.line }}
                  tickFormatter={(v: number) => {
                    const iso = new Date(t0 + v * 86_400_000).toISOString().slice(0, 10)
                    return formatFecha(iso, { day: 'numeric', month: 'short' }) ?? ''
                  }}
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fill: C.inkMuted, fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                />
                {/* El tooltip DESGLOSA la cuenta. El score anterior no se
                    entendia en parte porque era un numero sin origen visible:
                    aqui se ve de que sale, y si no cuadra, se puede discutir. */}
                <Tooltip
                  cursor={{ stroke: C.lineStrong }}
                  content={({ active, payload }) => {
                    const p = payload?.[0]?.payload as Fila | undefined
                    if (!active || !p || p.score === undefined) return null
                    return (
                      <div
                        style={{
                          background: C.surface,
                          border: `1px solid ${C.lineStrong}`,
                          borderRadius: 6,
                          padding: '8px 10px',
                          fontSize: 12.5,
                          boxShadow: '0 2px 8px rgba(0,0,0,.08)',
                        }}
                      >
                        <div style={{ fontFamily: MONO, color: C.inkMuted }}>{fecha(p.dia)}</div>
                        <div style={{ fontWeight: 700, marginTop: 2, fontSize: 15 }}>
                          Score {p.score}
                        </div>
                        <div style={{ color: C.inkMuted, marginTop: 4, lineHeight: 1.5 }}>
                          Técnica {p.tecnica}
                          {p.penalizacion > 0 && (
                            <span style={{ color: C.crit }}>
                              {' '}
                              − {p.penalizacion} por {p.criticas}{' '}
                              {p.criticas === 1 ? 'crítica' : 'críticas'}
                            </span>
                          )}
                          <br />
                          {p.llamadas} {p.llamadas === 1 ? 'llamada' : 'llamadas'}
                          {p.cierres > 0 && ` · ${p.cierres} ${p.cierres === 1 ? 'cierre' : 'cierres'}`}
                        </div>
                        {p.llamadas <= 2 && (
                          <div style={{ color: C.high, marginTop: 4 }}>
                            Pocas llamadas: dato poco firme.
                          </div>
                        )}
                        <div style={{ color: C.inkMuted, marginTop: 4, fontSize: 11.5 }}>
                          Promedio de la semana: {p.suave}
                        </div>
                      </div>
                    )
                  }}
                />
                {/* La LINEA es la media movil ponderada, no los puntos unidos.
                    Unir los crudos dibuja derrumbes que son ruido de muestra. */}
                <Line
                  dataKey="suave"
                  stroke={C.ink}
                  strokeWidth={2.5}
                  dot={false}
                  isAnimationActive={false}
                  connectNulls
                />
                {/* Los puntos van DESPUES para quedar sobre la linea. */}
                <Line
                  dataKey="score"
                  stroke="none"
                  dot={(props: { cx?: number; cy?: number; payload?: Fila; index?: number }) => {
                    const f = props.payload
                    if (f == null || f.score == null) return <g key={`v-${props.index}`} />
                    return (
                      <PuntoDia
                        key={`d-${f.dia}`}
                        cx={props.cx}
                        cy={props.cy}
                        llamadas={f.llamadas}
                        maxLlamadas={maxLlamadas}
                        seleccionado={diaSel === f.dia}
                        onClick={() => setDiaSel(diaSel === f.dia ? null : f.dia)}
                      />
                    )
                  }}
                  activeDot={false}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div
            style={{
              display: 'flex',
              gap: 18,
              flexWrap: 'wrap',
              fontSize: 12,
              color: C.inkMuted,
              padding: '2px 4px 12px',
            }}
          >
            <Leyenda color={C.brand} texto="Cada punto es un día" />
            <span>· El punto crece con las llamadas que tuvo ese día.</span>
            <span>· La línea es el promedio de los últimos siete días, no los puntos unidos.</span>
            <span>· Haz clic en un día para ver sus llamadas.</span>
          </div>

          {/* ── Las llamadas del día abierto ──────────────────────────────
              El camino a la transcripción no se pierde al pasar a día: se
              baja un nivel. Antes se hacía clic en la llamada directamente;
              ahora se elige el día y de ahí la llamada. */}
          {detalleDia && (
            <div style={{ borderTop: `1px solid ${C.line}`, padding: '14px 4px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>{fecha(detalleDia.dia)}</span>
                <span style={{ fontSize: 13, color: C.inkMuted }}>
                  Score {detalleDia.score} · técnica {detalleDia.tecnica}
                  {detalleDia.penalizacion > 0 && (
                    <span style={{ color: C.crit }}> − {detalleDia.penalizacion} por críticas</span>
                  )}
                  {' · '}
                  {detalleDia.llamadas} {detalleDia.llamadas === 1 ? 'llamada' : 'llamadas'}
                </span>
                <button
                  onClick={() => setDiaSel(null)}
                  style={{
                    marginLeft: 'auto',
                    background: 'none',
                    border: 'none',
                    color: C.inkMuted,
                    fontSize: 12.5,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  Cerrar
                </button>
              </div>

              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 2 }}>
                {llamadasDelDia.map((l) => (
                  <div
                    key={l.id}
                    onClick={l.detalle ? () => router.push(`/calidad/llamada/${l.id}`) : undefined}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '58px 1fr 62px 92px',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 8px',
                      borderRadius: 5,
                      fontSize: 13,
                      cursor: l.detalle ? 'pointer' : 'default',
                      background: l.detalle ? 'rgba(0,0,0,.02)' : 'transparent',
                    }}
                  >
                    <span style={{ fontFamily: MONO, color: C.inkMuted }}>
                      {l.fecha.slice(11)}
                    </span>
                    <span
                      style={{
                        color: C.inkMuted,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {l.ref}
                      {l.cerroVenta && <span style={{ color: C.brand }}> · cerró</span>}
                    </span>
                    <span style={{ fontFamily: MONO, textAlign: 'right' }}>{l.tecnica}</span>
                    <span
                      style={{
                        color: COLOR_SEMAFORO[l.semaforo],
                        fontSize: 12,
                        textAlign: 'right',
                      }}
                    >
                      {l.semaforo === 'verde'
                        ? 'sin banderas'
                        : l.semaforo === 'amarillo'
                          ? 'con banderas'
                          : 'críticas'}
                    </span>
                  </div>
                ))}
              </div>

              {llamadasDelDia.some((l) => l.detalle) && (
                <p style={{ fontSize: 12, color: C.inkMuted, margin: '8px 4px 0' }}>
                  Las llamadas con fondo tienen transcripción: haz clic para abrirla.
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* ── Recomendaciones ────────────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Dónde hay puntaje por ganar</h2>
        <div style={{ ...card, padding: '16px 18px' }}>
          {recomendaciones.length === 0 ? (
            <p style={{ fontSize: 13.5, color: C.inkMuted, margin: 0 }}>
              No hay un bloque con puntaje suficiente en juego: {nombreCorto} está cerca del máximo
              en todos. Aquí el entrenamiento no es de técnica.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {recomendaciones.map((b, i) => (
                <div
                  key={b.orden}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '26px 1fr 132px',
                    gap: 12,
                    alignItems: 'start',
                    paddingBottom: i < recomendaciones.length - 1 ? 14 : 0,
                    borderBottom:
                      i < recomendaciones.length - 1 ? `1px solid ${C.line}` : undefined,
                  }}
                >
                  <span
                    style={{
                      fontFamily: MONO,
                      fontSize: 13,
                      fontWeight: 700,
                      color: C.inkMuted,
                      lineHeight: '20px',
                    }}
                  >
                    {i + 1}
                  </span>
                  <div>
                    <div style={{ fontSize: 14.5, fontWeight: 600 }}>{b.nombre}</div>
                    <p style={{ fontSize: 13.5, color: C.ink, margin: '4px 0 0', lineHeight: 1.5 }}>
                      {COMO_SUBIR[b.nombre] ?? 'Revisar las llamadas del período en este bloque.'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 19,
                        fontWeight: 600,
                        color: C.ink,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      +{b.enJuego}
                    </div>
                    <div style={{ fontSize: 11.5, color: C.inkMuted }}>
                      puntos en juego
                      <br />
                      hoy {b.promedio} de {b.maximo}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {fuerte && fuerte.pctLogro >= 75 && (
            <p style={nota}>
              Lo que ya hace bien: <b>{fuerte.nombre}</b>, {fuerte.promedio} de {fuerte.maximo} en
              promedio. Es la base sobre la que se apoya el resto del entrenamiento.
            </p>
          )}
        </div>
      </section>

      {/* ── Desglose completo ──────────────────────────────────────────── */}
      <section style={{ marginTop: 26 }}>
        <h2 style={h2}>Los siete bloques, en promedio</h2>
        <div style={{ ...card, padding: '16px 18px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            {[...bloques]
              .sort((a, b) => a.orden - b.orden)
              .map((b) => {
                const pct = b.maximo > 0 ? (b.promedio / b.maximo) * 100 : 0
                const color = pct >= 75 ? C.brand : pct >= 45 ? C.high : C.crit
                return (
                  <div
                    key={b.orden}
                    style={{ display: 'grid', gridTemplateColumns: '1fr 74px', gap: 12, alignItems: 'center' }}
                  >
                    <div>
                      <div style={{ fontSize: 13.5, color: C.ink }}>{b.nombre}</div>
                      <div
                        style={{
                          height: 5,
                          background: C.line,
                          borderRadius: 3,
                          marginTop: 6,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3 }}
                        />
                      </div>
                    </div>
                    <div
                      style={{
                        fontFamily: MONO,
                        fontSize: 13,
                        textAlign: 'right',
                        fontVariantNumeric: 'tabular-nums',
                        color: C.inkMuted,
                      }}
                    >
                      {b.promedio}/{b.maximo}
                    </div>
                  </div>
                )
              })}
          </div>
          <p style={nota}>
            Promedio de {kpis.llamadas} llamadas del período. La escala de color es la misma del
            detalle de llamada, para que un bloque en rojo signifique lo mismo en las dos pantallas.
          </p>
        </div>
      </section>
    </div>
  )
}

function Leyenda({ color, texto }: { color: string; texto: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <i style={{ width: 9, height: 9, borderRadius: '50%', background: color, opacity: 0.65 }} />
      {texto}
    </span>
  )
}

const card: React.CSSProperties = {
  background: C.surface,
  border: `1px solid ${C.line}`,
  borderRadius: 6,
}

const grid: React.CSSProperties = { display: 'grid', gap: 14 }

const eyebrow: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: 10.5,
  letterSpacing: '.1em',
  textTransform: 'uppercase',
  color: C.inkMuted,
  marginBottom: 5,
}

const h2: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '.07em',
  textTransform: 'uppercase',
  margin: '0 0 12px',
  color: C.inkMuted,
}

const nota: React.CSSProperties = {
  fontSize: 12.5,
  color: C.inkMuted,
  background: C.surfaceAlt,
  border: `1px dashed ${C.lineStrong}`,
  borderRadius: 6,
  padding: '11px 13px',
  marginTop: 14,
  marginBottom: 0,
}

/**
 * Cifra de cabecera. Sin variante de alarma a proposito: en el muro el rojo
 * ordena a tres metros, pero aqui la pantalla se abre para preparar una sesion
 * de entrenamiento con la persona al lado. Un numero en rojo junto a su nombre
 * la convierte en expediente. El dato va completo; lo que no va es el senalamiento.
 */
function Kpi({
  label,
  valor,
  nota: notaTexto,
}: {
  label: string
  valor: string
  nota: string
}) {
  return (
    <div style={{ ...card, padding: '14px 16px' }}>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 10.5,
          letterSpacing: '.08em',
          textTransform: 'uppercase',
          color: C.inkMuted,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: MONO,
          fontSize: 27,
          fontWeight: 600,
          letterSpacing: '-1px',
          lineHeight: 1.15,
          marginTop: 6,
          fontVariantNumeric: 'tabular-nums',
          color: C.ink,
        }}
      >
        {valor}
      </div>
      <div style={{ fontSize: 12, color: C.inkMuted, marginTop: 3 }}>{notaTexto}</div>
    </div>
  )
}
