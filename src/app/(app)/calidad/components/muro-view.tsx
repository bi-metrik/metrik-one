'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Maximize2 } from 'lucide-react'
import {
  PERIODO_BANDA,
  PERIODO_LABEL,
  PERIODO_TITULO,
  type MuroData,
  type Periodo,
  type Semaforo,
  type UmbralesRanking,
} from '../types'

/**
 * Muro proyectable, v5.
 *
 * Vive en un televisor que ve todo el piso e incluso visitas. Criterio de
 * aceptacion, y es el que manda sobre cualquier otro: TODO se lee a tres
 * metros. Si algo obliga a acercarse, o sobra o tiene que crecer. Por eso la
 * pantalla prefiere pocas cosas grandes antes que muchas comodas.
 *
 * Cuatro zonas:
 *
 *   1. ENCABEZADO — "HOY · martes 28 de julio". La ambigüedad temporal se
 *      resuelve de una vez: nadie deberia tener que adivinar si lo que ve es
 *      de hoy o el acumulado del mes. La cobertura viaja aqui como sello
 *      discreto, no como heroe: una vez instalado el producto marca 100% todos
 *      los dias, informa una vez y despues es constante.
 *   2. HEROE — cierres de hoy con su denominador (llamadas y % de cierre) y
 *      partidos por forma de pago. Cobrado completo es caja que entro; a seis
 *      cuotas es una promesa que puede caerse (y si se cae, el servicio se
 *      suspende). Contar los dos como "una venta" es el error del Excel que
 *      este muro viene a reemplazar.
 *   3. DOS COLUMNAS —
 *      · RANKING: el acumulado, TODOS los agentes sin recortar, y ROTANDO solo
 *        entre dia, semana y mes. Con llamadas y % de cierre al lado de los
 *        cierres aparece el dato que el conteo simple esconde: quien cierra al
 *        mismo ritmo con la mitad de llamadas. Y los dos ejes de la rubrica van
 *        en columnas SEPARADAS — tecnica (como ejecuta) y banderas (a que
 *        expone) — porque son independientes: hay quien tiene la tecnica mas
 *        baja del piso y casi ningun error critico, y al reves.
 *      · ULTIMAS LLAMADAS: el FLUJO, lo que esta pasando ahora. Es lo que
 *        mantiene la pantalla viva durante el dia; la tabla casi no se mueve.
 *        Aqui el cumplimiento SI es un semaforo con palabra: es UNA llamada, que
 *        es para lo que el semaforo esta diseñado.
 *   4. BANDA — la bandera que mas se repite hoy. Es lo unico realmente
 *      accionable para el piso, asi que va en grande y no en letra chica.
 *
 * Que NO lleva, y no es negociable: `cliente_ref`. El muro nunca identifica al
 * cliente final, y la RPC que lo alimenta tampoco lo devuelve. Los agentes
 * salen por NOMBRE DE PILA porque el enlace es publico: en el piso todos se
 * conocen, en internet un nombre de pila no identifica a nadie.
 *
 * Que SI lleva desde v2: montos en dolares. Decision explicita de Mauricio.
 *
 * Los debitos rebotados salieron de aqui en v4: son cobranza, no operacion de
 * piso. Viven en la vista de dueno, junto al recaudo a seis cuotas.
 */

const M = {
  bg: '#1A1A1A',
  panel: '#232321',
  line: '#32322F',
  ink: '#EDECEA',
  muted: '#9A9C9F',
  brand: '#34D399',
  crit: '#F87171',
  high: '#FBBF24',
  ok: '#34D399',
} as const

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'

/**
 * Cumplimiento en palabra, no en punto de color. Un circulo sin etiqueta no
 * dice nada a tres metros, y quien no distingue rojo de verde se queda sin la
 * columna entera. El color acompaña; la palabra es la que informa.
 */
const CUMPLIMIENTO: Record<Semaforo, { texto: string; color: string }> = {
  verde: { texto: 'Sin banderas', color: M.ok },
  amarillo: { texto: 'Revisar', color: M.high },
  rojo: { texto: 'Crítico', color: M.crit },
}

const usd = (n: number) => `US$${Math.round(n).toLocaleString('es-CO')}`
/** Separador de miles: a tres metros "2817" se lee peor que "2.817". */
const num = (n: number) => n.toLocaleString('es-CO')

const COLS_AGENTES = '1fr 130px 120px 124px 130px 144px'
const COLS_ULTIMAS = '98px 1fr 94px 178px'

const PERIODOS: Periodo[] = ['dia', 'semana', 'mes']

/**
 * Cada cuanto gira la tabla. Nadie toca un televisor, asi que la temporalidad
 * tiene que cambiar sola.
 *
 * 20 s es lo que toma recorrer siete filas por seis columnas a tres metros sin
 * apurarse, con margen para el que levanta la vista a mitad de camino. Mas
 * corto obliga a leer contrarreloj; mas largo hace que quien pasa por el piso
 * vea siempre la misma pantalla y las otras dos no existan.
 */
const ROTACION_MS = 20_000

/** Cada cuanto se vuelven a pedir los datos al servidor. */
const REFRESCO_MS = 30_000

/** Duracion del fundido al girar. Corto: ordena el cambio sin hacerlo esperar. */
const FUNDIDO_MS = 220

/**
 * "martes 28 de julio". `toLocaleDateString` devuelve "martes, 28 de julio" y
 * `text-transform: capitalize` convertiria cada palabra ("Martes, 28 De
 * Julio"), que no es como se escribe una fecha en español. Se arma a mano:
 * fuera la coma, mayuscula solo en la primera letra.
 */
function fechaLegible(iso: string): string {
  const t = new Date(`${iso}T12:00:00`)
    .toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' })
    .replace(',', '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

/** "29 de junio" — para los extremos del rango de semana y mes. */
function fechaCorta(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
  })
}

export default function MuroView({
  data,
  nombreWorkspace,
  /** true en la version publica: activa auto-refresh y botón de pantalla completa. */
  proyectable = false,
}: {
  data: MuroData
  nombreWorkspace: string
  proyectable?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const router = useRouter()

  /*
   * Refresco de datos SIN recargar la pagina.
   *
   * Antes esto era `window.location.reload()`, que ahora seria un bug: la
   * recarga reinicia el estado del cliente, o sea el ciclo de rotacion. Cada 30
   * s el muro volveria a la vista de dia y las de semana y mes no alcanzarian a
   * mostrarse nunca. `router.refresh()` vuelve a correr el componente de
   * servidor y entrega props nuevas conservando el estado: los datos se
   * actualizan y el giro sigue su curso.
   */
  useEffect(() => {
    if (!proyectable) return
    const t = setInterval(() => router.refresh(), REFRESCO_MS)
    return () => clearInterval(t)
  }, [proyectable, router])

  /*
   * Rotacion de la temporalidad, con fundido.
   *
   * Un solo reloj hace las dos cosas: baja la opacidad, cambia el periodo con
   * la pantalla ya invisible, y vuelve a subir. Al girar cambian una docena de
   * numeros a la vez y tambien el ancho de los textos (no mide igual "HOY ·
   * Martes 28 de julio" que "ÚLTIMOS 30 DÍAS"); de golpe, a tres metros eso se
   * lee como un error de la pantalla y no como un cambio de vista.
   *
   * Es independiente del refresco de datos: son dos relojes y ninguno reinicia
   * al otro, que es lo que garantiza que el ciclo no se quede pegado en el dia.
   */
  const [iPeriodo, setIPeriodo] = useState(0)
  const [fundido, setFundido] = useState(false)
  const relojFundido = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const t = setInterval(() => {
      setFundido(true)
      relojFundido.current = setTimeout(() => {
        setIPeriodo((i) => (i + 1) % PERIODOS.length)
        setFundido(false)
      }, FUNDIDO_MS)
    }, ROTACION_MS)
    return () => {
      clearInterval(t)
      if (relojFundido.current) clearTimeout(relojFundido.current)
    }
  }, [])

  const periodo = PERIODOS[iPeriodo]
  const bloque = data.periodos?.[periodo]
  const ranking = bloque?.ranking

  /** Todo lo que rota comparte el mismo fundido: cambian juntos o no cambian. */
  const rotante = {
    opacity: fundido ? 0 : 1,
    transition: `opacity ${FUNDIDO_MS}ms ease`,
  } as const

  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  const alternarPantallaCompleta = () => {
    if (!document.fullscreenElement) {
      ref.current?.requestFullscreen?.()
      setPantallaCompleta(true)
    } else {
      document.exitFullscreen?.()
      setPantallaCompleta(false)
    }
  }

  const c = bloque?.cierres
  const cob = bloque?.cobertura
  const bandera = bloque?.banderaTop

  /*
   * Que dice el encabezado, segun el periodo.
   *
   * El dia se nombra por su fecha ("HOY · Martes 28 de julio") porque es la
   * unidad que el piso vive; semana y mes se nombran por su ventana y llevan el
   * rango explicito, porque "la semana" sin fechas no dice de cual habla.
   */
  const titulo = data.esFallback && periodo === 'dia'
    ? 'ÚLTIMO DÍA CON ACTIVIDAD'
    : PERIODO_TITULO[periodo]
  const subtitulo =
    periodo === 'dia'
      ? fechaLegible(data.fecha)
      : bloque
        ? `${fechaCorta(bloque.desde)} – ${fechaCorta(bloque.hasta)}`
        : ''

  return (
    <div
      ref={ref}
      style={{
        height: '100dvh',
        overflow: 'hidden',
        background: M.bg,
        color: M.ink,
        display: 'flex',
        flexDirection: 'column',
        padding: '22px 34px 16px',
        boxSizing: 'border-box',
      }}
    >
      {/* ── Encabezado: cuándo es "ahora", dicho sin rodeos ─────────── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 24 }}>
        {/*
          Título y sello van en DOS LÍNEAS, no en una.

          En vista de mes la línea completa ("ÚLTIMOS 30 DÍAS · 29 de junio –
          28 de julio" + "2.817 de 2.817 auditadas · antes se auditaban 143")
          se pasa del ancho y se monta sobre el nombre del workspace. Apilarlas
          hace que el encabezado quepa en cualquier período sin encoger nada.
        */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0, ...rotante }}>
          {/*
            El encabezado ROTA con la tabla. Si dijera siempre "HOY" mientras
            abajo se muestra el mes, quien mira ve dos periodos al tiempo y no
            sabe cual esta leyendo — que es exactamente lo que pasaba en v5.

            `esFallback` solo aplica al dia: si el dia pedido no tuvo actividad
            se dice en pantalla, en vez de rotular "HOY" datos de otro dia.
          */}
          <span style={{ fontSize: 40, fontWeight: 700, letterSpacing: '-.5px', whiteSpace: 'nowrap' }}>
            <span style={{ color: data.esFallback && periodo === 'dia' ? M.high : M.brand }}>
              {titulo}
            </span>
            <span style={{ color: M.muted, margin: '0 14px' }}>·</span>
            <span>{subtitulo}</span>
          </span>
          {/*
            Sello, no titular: la cobertura informa una vez y luego es constante.

            El contrafactual va PEGADO al sello y no aparte. El 100% solo
            significa algo contra lo que habia antes: sin "antes se auditaban 5"
            el numero se lee como una obviedad. Y el baseline sale del dato
            (`cobertura.baseline`, que la RPC trae de `baseline_manual`), no
            escrito a mano: si cambia, la linea lo sigue.
          */}
          {cob && (
            <span style={{ fontFamily: MONO, fontSize: 22, color: M.muted, whiteSpace: 'nowrap' }}>
              {num(cob.auditadas)} de {num(cob.recibidas)} llamadas auditadas
              {cob.baseline > 0 && (
                <>
                  <span style={{ margin: '0 10px' }}>·</span>
                  antes se auditaban {num(cob.baseline)}
                </>
              )}
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          {/* El ciclo lo marca el encabezado porque ahora rota la pantalla
              entera, no solo la tabla. */}
          <Puntos total={PERIODOS.length} activo={iPeriodo} />
          <span style={{ fontSize: 26, fontWeight: 600, color: M.muted, whiteSpace: 'nowrap' }}>
            {nombreWorkspace}
          </span>
          {proyectable && (
            <button
              type="button"
              onClick={alternarPantallaCompleta}
              aria-label="Pantalla completa"
              style={{
                background: 'transparent',
                border: `1px solid ${M.line}`,
                borderRadius: 6,
                color: M.muted,
                cursor: 'pointer',
                padding: 8,
                display: 'flex',
              }}
            >
              <Maximize2 style={{ width: 18, height: 18 }} />
            </button>
          )}
        </div>
      </div>

      {/* ── Zona 1: el héroe del PERÍODO, con denominador ──────────── */}
      <div
        style={{
          ...rotante,
          marginTop: 16,
          background: M.panel,
          border: `1px solid ${M.line}`,
          borderRadius: 10,
          padding: '16px 26px',
          display: 'grid',
          gridTemplateColumns: 'auto auto 1fr',
          gap: 44,
          alignItems: 'center',
        }}
      >
        {/* Cierres: el numero que el piso persigue */}
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16 }}>
          <span
            style={{
              fontFamily: MONO,
              fontSize: 96,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: '-3px',
              color: M.brand,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {num(c?.total ?? 0)}
          </span>
          <span style={{ lineHeight: 1.3 }}>
            <span
              style={{
                display: 'block',
                fontFamily: MONO,
                fontSize: 21,
                letterSpacing: '.1em',
                textTransform: 'uppercase',
                color: M.muted,
              }}
            >
              Cierres
            </span>
            <span style={{ display: 'block', fontSize: 26, color: M.ink }}>
              de {num(c?.llamadas ?? 0)} llamadas
            </span>
          </span>
        </div>

        {/* El denominador convertido en el numero que la operación entiende */}
        <div style={{ display: 'grid', gap: 6 }}>
          <Kpi valor={`${c?.pctCierre ?? 0}%`} etiqueta="de cierre" color={M.ink} />
          <Kpi valor={usd(c?.montoUsd ?? 0)} etiqueta="vendido" color={M.ink} />
        </div>

        {/* El desglose que hace la diferencia */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <FormaPago
            etiqueta="cobrado completo"
            nota="el dinero ya entró"
            n={c?.tarjeta.n ?? 0}
            monto={c?.tarjeta.montoUsd ?? 0}
            color={M.ok}
          />
          <FormaPago
            etiqueta="a seis cuotas"
            // Que la cifra diga lo que es: un numero que baja sin explicacion se
            // lee como error. Lo que entra ya descuenta lo que historicamente
            // rebota, no es una division entre seis.
            nota={`entra ${usd(c?.cuenta.primeraCuotaUsd ?? 0)} en la primera · descontado lo que rebota`}
            n={c?.cuenta.n ?? 0}
            monto={c?.cuenta.montoUsd ?? 0}
            color={M.high}
          />
        </div>
      </div>

      {/* ── Zona 2: acumulado y flujo, lado a lado ─────────────────── */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: '1.44fr 0.86fr',
          gap: 16,
          marginTop: 16,
        }}
      >
        {/* ── Zona 2a: el ranking (rota entre día, semana y mes) ── */}
        <Panel titulo={PERIODO_LABEL[periodo]} estilo={rotante}>
          {!ranking || ranking.filas.length === 0 ? (
            <div style={{ fontSize: 26, color: M.muted }}>Sin llamadas en este período.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <Encabezados
                columnas={COLS_AGENTES}
                gap={18}
                lateral={12}
                celdas={[
                  { texto: 'Agente' },
                  { texto: 'Llamadas', der: true },
                  { texto: 'Cierres', der: true },
                  { texto: '% cierre', der: true },
                  { texto: 'Técnica', der: true },
                  { texto: 'Banderas', der: true },
                ]}
              />

              {/* TODOS los agentes. Truncar la lista sesga: si alguien no
                  aparece, el piso no sabe si es que no cerró o que no cupo. */}
              {ranking.filas.map((a, i) => (
                <div
                  key={a.agente}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COLS_AGENTES,
                    alignItems: 'center',
                    gap: 18,
                    padding: '16px 12px',
                    // Alternancia de fondo: a tres metros es lo que impide que
                    // la vista salte de fila al recorrer la columna de la derecha.
                    background: i % 2 === 0 ? 'rgba(255,255,255,.035)' : 'transparent',
                    borderRadius: 6,
                    fontSize: 32,
                    // El interlineado por defecto (1.5) le da a cada fila 12 px
                    // que nadie ve y que se pagan cortando la ultima fila.
                    lineHeight: 1.15,
                  }}
                >
                  {/* Nombre de pila. El muro es público por enlace. */}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {a.agente}
                  </span>
                  <Num>{a.llamadas}</Num>
                  <Num destacado>{a.cierres}</Num>
                  {/* El % en tinta plena: es lo único que permite comparar
                      agentes con distinto volumen. En gris se pierde al lado
                      del conteo de cierres. */}
                  <Num color={M.ink}>{a.pctCierre}%</Num>
                  {/* Los dos ejes, separados y con color por umbral del propio
                      dato. Ejecutar bien la venta y exponer a la empresa son
                      cosas independientes: con una sola columna eso no se veía. */}
                  <Num color={colorTecnica(a.tecnica, ranking.umbrales)}>{a.tecnica}</Num>
                  <Num color={colorBanderas(a.banderas, ranking.umbrales)}>{a.banderas}</Num>
                </div>
              ))}
            </div>
          )}
        </Panel>

        {/* ── Zona 2b: el flujo (lo que está pasando ahora) ── */}
        {/* El flujo NO entra al fundido: no rota. La nota lo dice para que
            nadie lo lea como "las últimas del mes". */}
        <Panel titulo="Últimas llamadas" nota="en vivo">
          {data.ultimas.length === 0 ? (
            <div style={{ fontSize: 26, color: M.muted }}>Sin llamadas registradas hoy.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
              <Encabezados
                columnas={COLS_ULTIMAS}
                gap={16}
                lateral={10}
                celdas={[
                  { texto: 'Hora' },
                  { texto: 'Agente' },
                  { texto: 'Técnica', der: true },
                  { texto: 'Cumplimiento' },
                ]}
              />

              {data.ultimas.map((u, i) => (
                <div
                  key={`${u.hora}-${i}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: COLS_ULTIMAS,
                    alignItems: 'center',
                    gap: 16,
                    padding: '10px',
                    background: i % 2 === 0 ? 'rgba(255,255,255,.035)' : 'transparent',
                    borderRadius: 6,
                    fontSize: 27,
                    // Sin esto la decima llamada queda cortada por el borde del
                    // panel, y una lista que se corta sola miente sobre cuantas
                    // llamadas hubo.
                    lineHeight: 1.15,
                  }}
                >
                  <span style={{ fontFamily: MONO, color: M.muted, fontVariantNumeric: 'tabular-nums' }}>
                    {u.hora}
                  </span>
                  {/* Nombre de pila. El muro es público por enlace. */}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {u.agente}
                    {/* Marca discreta de que esa llamada cerró venta: conecta el
                        flujo con el número de arriba sin agregar otra columna. */}
                    {u.cerroVenta && <span style={{ color: M.brand, marginLeft: 8 }}>·cerró</span>}
                  </span>
                  <Num>{u.tecnica}</Num>
                  <Cumplimiento semaforo={u.semaforo} />
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>

      {/* ── Zona 3: la banda accionable ─────────────────────────────── */}
      <div
        style={{
          ...rotante,
          marginTop: 14,
          background: bandera ? 'rgba(248,113,113,.10)' : M.panel,
          border: `1px solid ${bandera ? 'rgba(248,113,113,.35)' : M.line}`,
          borderRadius: 10,
          padding: '14px 26px',
          display: 'flex',
          alignItems: 'baseline',
          gap: 26,
        }}
      >
        <span
          style={{
            fontFamily: MONO,
            fontSize: 20,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: M.muted,
            whiteSpace: 'nowrap',
          }}
        >
          Lo que más se repite {PERIODO_BANDA[periodo]}
        </span>
        {bandera ? (
          <span
            style={{
              fontSize: 34,
              display: 'flex',
              alignItems: 'baseline',
              gap: 16,
              minWidth: 0,
              flex: 1,
            }}
          >
            <b style={{ fontFamily: MONO, color: M.crit }}>{bandera.codigo}</b>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bandera.titulo}
            </span>
            <b
              style={{
                fontFamily: MONO,
                color: M.crit,
                marginLeft: 'auto',
                whiteSpace: 'nowrap',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {bandera.veces} veces
            </b>
          </span>
        ) : (
          <span style={{ fontSize: 34, color: M.muted }}>
            Sin banderas {PERIODO_BANDA[periodo]}
          </span>
        )}
      </div>

      {/* ── Pie mínimo: una definición, una advertencia, una firma ──── */}
      <div
        style={{
          marginTop: 10,
          fontSize: 17,
          color: M.muted,
          display: 'flex',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        {/*
          Las dos palabras que no se explican solas se definen UNA vez, aquí
          abajo. Repetir la aclaración en cada fila sería ruido, y una pantalla
          que se mira de reojo no puede pedir que se adivine.

          "Banderas" cuenta SOLO los errores críticos, no todos los hallazgos.
          Sin decirlo, el número parece el total y subestima lo que se ve: es la
          diferencia entre informar y insinuar.

          El monto de "cobrado" sale del dato, no escrito a mano: si el precio
          del programa cambia, la línea lo sigue.
        */}
        <span>
          Banderas = errores críticos.
          {'  ·  '}
          {c?.montoUnitarioUsd
            ? `Cobrado = pagó los ${usd(c.montoUnitarioUsd)} de una vez; el resto queda a seis cuotas.`
            : 'Cobrado = pagó de una vez; el resto queda a seis cuotas.'}
          {'  ·  '}
          Datos de demostración: una llamada real, el resto es muestra.
        </span>
        <span style={{ whiteSpace: 'nowrap' }}>Powered by MéTRIK</span>
      </div>

      {pantallaCompleta && <span hidden />}
    </div>
  )
}

function Kpi({ valor, etiqueta, color }: { valor: string; etiqueta: string; color: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 44,
          fontWeight: 600,
          lineHeight: 1.05,
          color,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
        }}
      >
        {valor}
      </span>
      <span style={{ fontSize: 21, color: M.muted, whiteSpace: 'nowrap' }}>{etiqueta}</span>
    </div>
  )
}

function FormaPago({
  etiqueta,
  nota,
  n,
  monto,
  color,
}: {
  etiqueta: string
  nota: string
  n: number
  monto: number
  color: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
      <span
        style={{
          fontFamily: MONO,
          fontSize: 46,
          fontWeight: 600,
          color,
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums',
          minWidth: 58,
        }}
      >
        {n}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 25, color: M.ink }}>
          {etiqueta} <span style={{ fontFamily: MONO, color: M.muted }}>{usd(monto)}</span>
        </span>
        <span style={{ display: 'block', fontSize: 19, color: M.muted, marginTop: 1 }}>{nota}</span>
      </span>
    </div>
  )
}

/**
 * `gap` y `lateral` deben ser los MISMOS que los de las filas: si no, los
 * encabezados quedan corridos respecto de la columna que titulan y a tres
 * metros la tabla deja de leerse como tabla.
 */
function Encabezados({
  columnas,
  celdas,
  gap,
  lateral,
}: {
  columnas: string
  celdas: { texto: string; der?: boolean }[]
  gap: number
  lateral: number
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: columnas,
        gap,
        padding: `0 ${lateral}px 10px`,
        borderBottom: `1px solid ${M.line}`,
        marginBottom: 4,
        fontFamily: MONO,
        fontSize: 16,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        color: M.muted,
      }}
    >
      {celdas.map((c) => (
        <span key={c.texto} style={{ textAlign: c.der ? 'right' : 'left' }}>
          {c.texto}
        </span>
      ))}
    </div>
  )
}

/** Alineación numérica a la derecha y ancho tabular: las columnas se comparan de un vistazo. */
function Num({
  children,
  color,
  destacado = false,
}: {
  children: React.ReactNode
  color?: string
  destacado?: boolean
}) {
  return (
    <span
      style={{
        fontFamily: MONO,
        textAlign: 'right',
        fontVariantNumeric: 'tabular-nums',
        fontWeight: destacado ? 600 : 400,
        color: color ?? (destacado ? M.ink : M.muted),
      }}
    >
      {children}
    </span>
  )
}

function Cumplimiento({ semaforo }: { semaforo: Semaforo }) {
  const { texto, color } = CUMPLIMIENTO[semaforo] ?? CUMPLIMIENTO.verde
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
      <span style={{ width: 14, height: 14, borderRadius: '50%', background: color, flexShrink: 0 }} />
      <span style={{ fontSize: 24, color, whiteSpace: 'nowrap' }}>{texto}</span>
    </span>
  )
}

function Panel({
  titulo,
  nota,
  estilo,
  children,
}: {
  titulo: string
  /** Aclaración corta al lado del título. */
  nota?: string
  /** Para que el panel entre (o no) en el fundido de la rotación. */
  estilo?: React.CSSProperties
  children: React.ReactNode
}) {
  return (
    <section
      style={{
        ...estilo,
        background: M.panel,
        border: `1px solid ${M.line}`,
        borderRadius: 10,
        padding: '18px 18px 14px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 16,
          margin: '0 10px 14px',
        }}
      >
        <h2
          style={{
            fontFamily: MONO,
            fontSize: 20,
            fontWeight: 600,
            letterSpacing: '.1em',
            textTransform: 'uppercase',
            color: M.ink,
            margin: 0,
          }}
        >
          {titulo}
        </h2>
        {nota && <span style={{ fontSize: 18, color: M.muted }}>{nota}</span>}
      </div>
      {children}
    </section>
  )
}

/**
 * Indicador de la rotación. Un televisor no tiene controles, así que la única
 * forma de saber que la pantalla va a cambiar sola (y que no se quedó pegada)
 * es que se vea el ciclo.
 */
function Puntos({ total, activo }: { total: number; activo: number }) {
  return (
    <span style={{ display: 'flex', gap: 9, alignItems: 'center' }}>
      {Array.from({ length: total }, (_, i) => (
        <span
          key={i}
          style={{
            width: 11,
            height: 11,
            borderRadius: '50%',
            background: i === activo ? M.brand : M.line,
          }}
        />
      ))}
    </span>
  )
}

/**
 * Color por umbral, con los umbrales que vienen del dato (terciles del equipo
 * en ese período), no escritos aquí.
 *
 * Si no hay dispersión (`alta <= baja`) no se pinta nada: cuando todos valen lo
 * mismo no hay a quién señalar, y pintar de todos modos sería inventar una
 * diferencia. Es el mismo defecto que tenía el semáforo agregado.
 */
function colorTecnica(v: number, u: UmbralesRanking): string | undefined {
  if (!u || u.tecnicaAlta <= u.tecnicaBaja) return undefined
  if (v >= u.tecnicaAlta) return M.ok
  if (v <= u.tecnicaBaja) return M.crit
  return undefined
}

function colorBanderas(v: number, u: UmbralesRanking): string | undefined {
  if (!u || u.banderasAlta <= u.banderasBaja) return v === 0 ? M.ok : undefined
  if (v >= u.banderasAlta) return M.crit
  if (v <= u.banderasBaja) return M.ok
  return undefined
}
