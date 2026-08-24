'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, CalendarClock, Info, Minus, RotateCcw } from 'lucide-react'
import type { ProcesoSeccionalData, ProcesoSeccionalEtapa, ProcesoSeccionalCelda, EtapaStage } from '../types'
import { STAGE_COLORS, STAGE_LABELS } from '@/components/workflow/types'
import { ChartCard } from './chart-card'
import { CasosDrawer, type CeldaSeleccionada } from './casos-drawer'

// Paleta MeTRIK (tokens del manual de marca, no Tailwind generico).
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const ROJO = '#B91C1C'
const OCRE = '#92400E'

/**
 * El verde, el naranja y el azul de esta tabla NO son decoracion: son el token canonico
 * de fase (`STAGE_COLORS`), el mismo que usan /flujo, los listados y el detalle del
 * negocio. Aqui dicen de que area es la pelota, porque el `stage` de una etapa es
 * tambien su area duena (`STAGE_TO_AREA`).
 *
 * Por eso el ambar dejo de significar "seccional con cita previa": naranja ya significa
 * ejecucion en toda la app y no puede querer decir dos cosas en la misma pantalla. La
 * cita previa pasa a ser un icono en el encabezado.
 *
 * Una etapa sin `stage` declarado va en gris. Sin dato no se le inventa una fase.
 */
const TONO_SIN_FASE = { bg: '#F3F4F6', text: GRIS, border: BORDE }
const tono = (s: EtapaStage) => (s ? STAGE_COLORS[s] : TONO_SIN_FASE)

/** Que area atiende cada fase. Espeja `STAGE_TO_AREA` de `lib/permissions/can-edit`. */
const AREA_DE_FASE: Record<'venta' | 'ejecucion' | 'cobro', string> = {
  venta: 'comercial',
  ejecucion: 'operaciones',
  cobro: 'financiera',
}
const FASES = ['venta', 'ejecucion', 'cobro'] as const

/**
 * Foto del proceso: UNA sola tabla con dos niveles de detalle.
 *
 * Contraída muestra el total por etapa; expandida abre las columnas por seccional. Antes
 * eran dos tablas separadas (totales arriba, seccionales abajo) y había que cruzarlas a
 * ojo. El total de cada etapa se calcula sumando sus seccionales, así que las dos vistas
 * no pueden contar distinto por construcción.
 *
 * El segundo selector cambia la métrica: cuántos casos hay, o cuántos van atrasados.
 *
 * La columna de reprocesos son los dos indicadores de calidad del comité directivo:
 * certificados UPME que salieron mal y devoluciones que la DIAN rechazó.
 *
 * Las filas van en orden de proceso (01 → 19) y el color dice a qué fase pertenece cada
 * etapa. NO se agrupan por fase: el proceso rebota entre las tres áreas (Precobro es
 * comercial, Cita es operaciones, Facturación es financiera) y agruparlas pondría
 * Precobro al lado de Documentación, rompiendo la lectura del flujo, que es justo lo que
 * se viene a leer aquí.
 */
export function TabProceso({ data }: { data: ProcesoSeccionalData }) {
  const {
    etapas,
    conCita,
    sinCita,
    sinRegistrar,
    total,
    fechaFotoPrevia,
    reprocesosTotal,
    etapasConSla,
    etapasTotales,
  } = data

  const [detalle, setDetalle] = useState<'totales' | 'seccional'>('totales')
  const [metrica, setMetrica] = useState<'abiertos' | 'vencidos'>('abiertos')
  // Celda en la que se hizo clic: abre el panel con los casos concretos detrás del numero.
  const [seleccion, setSeleccion] = useState<CeldaSeleccionada | null>(null)

  const abrir = (
    e: ProcesoSeccionalEtapa,
    seccional?: string | string[] | null,
    soloReproceso = false,
    seccionalLabel?: string,
  ) =>
    setSeleccion({
      etapaIds: [e.etapaId],
      titulo: e.nombre,
      etapaNumero: e.numero,
      seccional,
      seccionalLabel,
      // Al abrir los reprocesos se muestran todos, no solo los atrasados: son dos
      // preguntas distintas y cruzarlas escondería casos.
      soloVencidos: soloReproceso ? false : metrica === 'vencidos',
      soloReproceso,
    })

  const valorDe = (c?: ProcesoSeccionalCelda) =>
    c ? (metrica === 'abiertos' ? c.abiertos : c.vencidos) : 0
  const antesDe = (c?: ProcesoSeccionalCelda) =>
    c ? (metrica === 'abiertos' ? c.abiertosAntes : c.vencidosAntes) : null

  const celda = (e: ProcesoSeccionalEtapa, nombre: string | null) =>
    e.celdas.find(c => c.seccional === nombre)

  const sumaGrupo = (e: ProcesoSeccionalEtapa, nombres: string[]) => {
    let hoy = 0
    let antes: number | null = null
    for (const n of nombres) {
      const c = celda(e, n)
      hoy += valorDe(c)
      const a = antesDe(c)
      if (a !== null) antes = (antes ?? 0) + a
    }
    return { hoy, antes }
  }

  const totalColumna = (
    getter: (e: ProcesoSeccionalEtapa) => { hoy: number; antes: number | null },
  ) => {
    let hoy = 0
    let antes: number | null = null
    for (const e of etapas) {
      const v = getter(e)
      hoy += v.hoy
      if (v.antes !== null) antes = (antes ?? 0) + v.antes
    }
    return { hoy, antes }
  }

  if (etapas.length === 0) {
    return (
      <ChartCard title="Foto del proceso" accentColor={CARBON}>
        <p className="py-4 text-center text-sm" style={{ color: GRIS }}>
          No hay negocios abiertos.
        </p>
      </ChartCard>
    )
  }

  // La leyenda de fases solo aparece si hay al menos una etapa que declare la suya:
  // una leyenda de tres colores sobre una tabla toda gris promete un codigo que no existe.
  const hayFases = etapas.some(e => e.stage !== null)
  const totalGeneral = totalColumna(e => ({ hoy: valorDe(e.total), antes: antesDe(e.total) }))
  const totalReprocesos = reprocesosTotal.certificacionUpme + reprocesosTotal.devolucionDian
  const cuello = etapas.reduce<ProcesoSeccionalEtapa>(
    (m, e) => (valorDe(e.total) > valorDe(m.total) ? e : m),
    etapas[0],
  )

  return (
    <div className="space-y-4">
      <ChartCard title="Foto del proceso" accentColor={CARBON}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 text-xs" style={{ color: GRIS }}>
            <span>
              <strong className="text-base" style={{ color: CARBON }}>{totalGeneral.hoy}</strong>{' '}
              {metrica === 'abiertos' ? 'casos abiertos' : 'casos atrasados'}
            </span>
            {valorDe(cuello.total) > 0 && (
              <span>
                Mayor acumulado: <strong style={{ color: CARBON }}>{cuello.nombre}</strong> (
                {valorDe(cuello.total)})
              </span>
            )}
            {totalReprocesos > 0 && (
              <span style={{ color: ROJO }}>
                <RotateCcw className="mr-0.5 inline h-3 w-3" />
                <strong>{totalReprocesos}</strong> en reproceso
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Selector
              valor={detalle}
              onChange={setDetalle}
              opciones={[
                { key: 'totales' as const, label: 'Totales' },
                { key: 'seccional' as const, label: 'Por seccional' },
              ]}
            />
            <Selector
              valor={metrica}
              onChange={setMetrica}
              opciones={[
                { key: 'abiertos' as const, label: 'Casos' },
                { key: 'vencidos' as const, label: 'Solo atrasados' },
              ]}
            />
          </div>
        </div>

        {/* La leyenda va antes que todo lo que pinta color: la barra y la tabla usan el
            MISMO codigo, asi que se enuncia una sola vez y arriba. */}
        {hayFases && (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: GRIS }}>
            <span>Color por fase:</span>
            {FASES.map(f => (
              <span
                key={f}
                className="inline-flex items-center gap-1"
                title={`Etapas de ${STAGE_LABELS[f].toLowerCase()} — las atiende el área ${AREA_DE_FASE[f]}`}
              >
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: STAGE_COLORS[f].text }}
                />
                {STAGE_LABELS[f]}
              </span>
            ))}
          </div>
        )}

        {/* El cuello de botella por seccional, de un vistazo (punto #42). Solo en la
            vista por seccional: en Totales no hay nada que apilar por ciudad. La
            barra sale de las MISMAS celdas que la tabla de abajo. */}
        {detalle === 'seccional' && (
          <BarrasPorSeccional
            etapas={etapas}
            conCita={conCita}
            /* El grafico cuenta SIEMPRE casos abiertos, no sigue al selector de metrica.
               Si abriera "solo atrasados" entregaria una lista mas corta que la barra
               en la que se acaba de hacer clic. */
            onAbrir={sel => setSeleccion({ ...sel, soloVencidos: false })}
          />
        )}

        <p className="mb-2 text-xs" style={{ color: GRIS }}>
          {fechaFotoPrevia
            ? `Cada celda es la foto de hoy; la flecha compara contra ${fechaFotoPrevia}.`
            : 'La comparación con la semana anterior aparece cuando se tome la siguiente foto.'}
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ minWidth: detalle === 'seccional' ? 680 : 420 }}>
            <thead>
              <tr className="border-b" style={{ borderColor: BORDE }}>
                <Th align="left" pegada>Etapa</Th>
                {detalle === 'seccional' && (
                  <>
                    {conCita.map(c => (
                      <Th key={c} title="Seccional que exige cita previa en la DIAN">
                        <CalendarClock className="mr-0.5 inline h-3 w-3 align-[-2px]" />
                        {c}
                      </Th>
                    ))}
                    <Th title={sinCita.join(', ') || 'Sin casos'}>Sin cita</Th>
                    <Th title="Casos a los que todavía no se les registró la seccional">
                      Sin registrar
                    </Th>
                  </>
                )}
                <Th>Total</Th>
                <Th color={ROJO} title="Certificados UPME rehechos y devoluciones rechazadas por la DIAN">
                  Reproceso
                </Th>
              </tr>
            </thead>
            <tbody>
              {etapas.map(e => (
                <tr key={e.etapaId} className="border-b last:border-0" style={{ borderColor: BORDE }}>
                  <td
                    className="sticky left-0 z-10 bg-white py-2 pl-2 pr-3 text-xs"
                    style={{ color: CARBON, boxShadow: `inset 3px 0 0 ${tono(e.stage).text}` }}
                    title={
                      e.stage
                        ? `${STAGE_LABELS[e.stage]} — la atiende el área ${AREA_DE_FASE[e.stage]}`
                        : 'Esta etapa no tiene fase declarada'
                    }
                  >
                    <span
                      className="mr-1.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold tabular-nums"
                      style={{ backgroundColor: tono(e.stage).bg, color: tono(e.stage).text }}
                    >
                      {String(e.numero).padStart(2, '0')}
                    </span>
                    {e.nombre}
                    {metrica === 'vencidos' && !e.slaHoras && (
                      <span
                        className="ml-1 text-[11px]"
                        style={{ color: GRIS }}
                        title="Esta etapa no tiene tiempo máximo configurado"
                      >
                        sin SLA
                      </span>
                    )}
                  </td>
                  {detalle === 'seccional' && (
                    <>
                      {conCita.map(c => {
                        const cel = celda(e, c)
                        return (
                          <Celda
                            key={c}
                            hoy={valorDe(cel)}
                            antes={antesDe(cel)}
                            onClick={() => abrir(e, c)}
                          />
                        )
                      })}
                      <Celda
                        {...sumaGrupo(e, sinCita)}
                        onClick={() => abrir(e, sinCita, false, 'sin cita previa')}
                      />
                      {/* "Sin registrar" va en gris a proposito: es ausencia de dato, no una
                          fase ni una alerta. Pintarla de calido la ascendia a categoria. */}
                      <Celda
                        hoy={valorDe(celda(e, null))}
                        antes={antesDe(celda(e, null))}
                        color={GRIS}
                        onClick={() => abrir(e, null)}
                      />
                    </>
                  )}
                  <Celda hoy={valorDe(e.total)} antes={antesDe(e.total)} negrita onClick={() => abrir(e)} />
                  <ReprocesoCelda r={e.reprocesos} onClick={() => abrir(e, undefined, true)} />
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2" style={{ borderColor: BORDE }}>
                <td
                  className="sticky left-0 z-10 bg-white pl-2 pt-2 text-[11px] font-bold uppercase tracking-wide"
                  style={{ color: GRIS }}
                >
                  Total ({total})
                </td>
                {detalle === 'seccional' && (
                  <>
                    {conCita.map(c => {
                      const t = totalColumna(e => ({
                        hoy: valorDe(celda(e, c)),
                        antes: antesDe(celda(e, c)),
                      }))
                      return <Celda key={c} hoy={t.hoy} antes={t.antes} negrita />
                    })}
                    <Celda {...totalColumna(e => sumaGrupo(e, sinCita))} negrita />
                    <Celda
                      {...totalColumna(e => ({
                        hoy: valorDe(celda(e, null)),
                        antes: antesDe(celda(e, null)),
                      }))}
                      color={GRIS}
                      negrita
                    />
                  </>
                )}
                <Celda hoy={totalGeneral.hoy} antes={totalGeneral.antes} negrita />
                <ReprocesoCelda r={reprocesosTotal} negrita />
              </tr>
            </tfoot>
          </table>
        </div>

        {metrica === 'vencidos' && etapasConSla < etapasTotales && (
          <Aviso>
            Solo <strong>{etapasConSla} de {etapasTotales}</strong> etapas tienen tiempo máximo
            configurado. Una etapa sin configurar nunca aparece como atrasada, aunque tenga casos
            represados.
          </Aviso>
        )}
        {detalle === 'seccional' && sinRegistrar > 0 && metrica === 'abiertos' && (
          <Aviso>
            <strong>{sinRegistrar} de {total}</strong> casos no tienen seccional registrada, así que
            no se sabe todavía si necesitan cita. Se toma del RUT (casilla 12) y el cargue de los
            casos antiguos está pendiente.
          </Aviso>
        )}
      </ChartCard>

      {/* Calidad: los dos cuadros del comité. Se muestran aunque estén en cero, porque su
          ausencia también es información: nadie ha tenido que rehacer trabajo. */}
      <ChartCard title="Calidad" accentColor={totalReprocesos > 0 ? ROJO : CARBON}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Indicador
            label="Certificados UPME rehechos"
            valor={reprocesosTotal.certificacionUpme}
            ayuda="El certificado salió mal y el caso volvió a Cargue"
          />
          <Indicador
            label="Devoluciones rechazadas por la DIAN"
            valor={reprocesosTotal.devolucionDian}
            ayuda="La DIAN rechazó la devolución y el caso volvió a Cita"
          />
        </div>
        {totalReprocesos === 0 && (
          <p className="mt-3 text-xs" style={{ color: GRIS }}>
            Ningún caso en reproceso. Solo cuenta el error propio: si la DIAN devuelve por criterio
            del funcionario, no penaliza el indicador.
          </p>
        )}
      </ChartCard>

      {seleccion && (
        <CasosDrawer
          key={[
            seleccion.etapaIds.join('+'),
            Array.isArray(seleccion.seccional)
              ? seleccion.seccional.join('+')
              : seleccion.seccional ?? 'todas',
            seleccion.soloVencidos,
            seleccion.soloReproceso,
          ].join('|')}
          celda={seleccion}
          onClose={() => setSeleccion(null)}
        />
      )}
    </div>
  )
}

// ── Piezas ────────────────────────────────────────────────────────────────

function Selector<T extends string>({
  valor,
  onChange,
  opciones,
}: {
  valor: T
  onChange: (v: T) => void
  opciones: Array<{ key: T; label: string }>
}) {
  return (
    <div className="flex gap-1 rounded-lg bg-gray-100 p-0.5">
      {opciones.map(o => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={`rounded-md px-2.5 py-1.5 text-xs font-medium transition-all ${
            valor === o.key ? 'bg-white shadow-sm' : ''
          }`}
          style={{ color: valor === o.key ? CARBON : GRIS }}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Th({
  children,
  align = 'right',
  color = GRIS,
  title,
  pegada,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  color?: string
  title?: string
  /** La columna de etapa se queda fija al hacer scroll lateral en movil. */
  pegada?: boolean
}) {
  return (
    <th
      className={`pb-2 ${align === 'left' ? 'pl-2 text-left' : 'text-right'} text-[11px] font-bold uppercase tracking-wide${
        pegada ? ' sticky left-0 z-10 bg-white' : ''
      }`}
      style={{ color }}
      title={title}
    >
      {children}
    </th>
  )
}

/**
 * Celda de la foto de hoy con flecha de cambio.
 *
 * El valor de la foto anterior ya NO se imprime al lado del de hoy. En la vista por
 * seccional eso ponia una barra, un numero y una flecha en cada celda con dato — decenas
 * de glifos compitiendo con el unico numero que se viene a leer. Queda la flecha, y el
 * valor anterior vive en el tooltip de la celda.
 *
 * La flecha no usa verde ni ambar: esos dos ya son fases en esta tabla. Sube en rojo
 * (mas represado pide atencion, igual que un reproceso), baja y sin cambio en gris.
 *
 * Tres estados que NO se pueden ver iguales: sin casos (·), medido en cero (0) y sin
 * foto previa con que comparar (ninguna flecha, ni siquiera el guion de "no cambio").
 */
function Celda({
  hoy,
  antes,
  color = CARBON,
  negrita,
  onClick,
}: {
  hoy: number
  antes: number | null
  color?: string
  negrita?: boolean
  /** Solo se ofrece el clic cuando hay casos que mostrar. */
  onClick?: () => void
}) {
  const delta = antes === null ? null : hoy - antes
  const clicable = Boolean(onClick) && hoy > 0
  const comparacion =
    delta === null
      ? null
      : delta === 0
        ? `Igual que la foto anterior (${antes})`
        : `${delta > 0 ? '+' : ''}${delta} contra la foto anterior (${antes})`
  const titulo = [clicable ? 'Ver los casos' : null, comparacion].filter(Boolean).join(' · ')

  return (
    <td className="py-2 text-right tabular-nums" title={titulo || undefined}>
      {/* min-h-11 = 44px de area tactil en movil, el minimo para acertarle a un digito
          con el pulgar. En escritorio no hace falta y estiraria la fila. */}
      <span
        onClick={clicable ? onClick : undefined}
        role={clicable ? 'button' : undefined}
        tabIndex={clicable ? 0 : undefined}
        onKeyDown={clicable ? (ev => { if (ev.key === 'Enter') onClick!() }) : undefined}
        className={`inline-flex min-h-11 items-center justify-end gap-0.5 px-1 sm:min-h-0${
          clicable ? ' cursor-pointer underline-offset-2 hover:underline' : ''
        }`}
        style={{ color: hoy > 0 ? color : BORDE, fontWeight: negrita || hoy > 0 ? 600 : 400 }}
      >
        {hoy || '·'}
        {delta !== null && (
          delta > 0 ? (
            <ArrowUp className="h-3 w-3 shrink-0" style={{ color: ROJO }} />
          ) : delta < 0 ? (
            <ArrowDown className="h-3 w-3 shrink-0" style={{ color: GRIS }} />
          ) : (
            <Minus className="h-3 w-3 shrink-0" style={{ color: GRIS }} />
          )
        )}
      </span>
    </td>
  )
}

function ReprocesoCelda({
  r,
  negrita,
  onClick,
}: {
  r: { certificacionUpme: number; devolucionDian: number }
  negrita?: boolean
  onClick?: () => void
}) {
  const n = r.certificacionUpme + r.devolucionDian
  const clicable = Boolean(onClick) && n > 0
  return (
    <td className="py-2 text-right tabular-nums">
      {n > 0 ? (
        <span
          onClick={clicable ? onClick : undefined}
          role={clicable ? 'button' : undefined}
          tabIndex={clicable ? 0 : undefined}
          onKeyDown={clicable ? (ev => { if (ev.key === 'Enter') onClick!() }) : undefined}
          className={`inline-flex min-h-11 items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-semibold sm:min-h-0${clicable ? ' cursor-pointer hover:brightness-95' : ''}`}
          style={{ backgroundColor: '#FEE2E2', color: ROJO }}
          title={clicable ? 'Ver los casos en reproceso' : `${r.certificacionUpme} por certificado UPME · ${r.devolucionDian} por devolución DIAN`}
        >
          <RotateCcw className="h-3 w-3" />
          {n}
        </span>
      ) : (
        <span style={{ color: BORDE, fontWeight: negrita ? 600 : 400 }}>·</span>
      )}
    </td>
  )
}

function Indicador({ label, valor, ayuda }: { label: string; valor: number; ayuda: string }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: BORDE }}>
      <p className="text-[11px] font-medium uppercase tracking-wide" style={{ color: GRIS }}>
        {label}
      </p>
      <p className="mt-1 text-2xl font-bold tabular-nums" style={{ color: valor > 0 ? ROJO : CARBON }}>
        {valor}
      </p>
      <p className="mt-0.5 text-[11px]" style={{ color: GRIS }}>
        {ayuda}
      </p>
    </div>
  )
}

function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3 flex items-start gap-1.5 text-xs" style={{ color: OCRE }}>
      <Info className="mt-0.5 h-3 w-3 shrink-0" />
      <span>{children}</span>
    </p>
  )
}

/**
 * Dónde está atascado el trabajo, de un vistazo (punto #42).
 *
 * Una barra por SECCIONAL, con la seccional a la izquierda y cada color una etapa. Es
 * la transposición de la tabla de abajo, no una consulta nueva: sale de las MISMAS
 * `data.etapas`, así que la barra y la tabla no pueden contar distinto.
 *
 * Por qué la barra y no otra tabla: la pregunta de JD es "en qué ciudad se está
 * represando", y eso en una tabla de 19 filas por 15 columnas hay que reconstruirlo
 * leyendo. En la barra el tramo más ancho ES el cuello de botella.
 *
 * ⚠️ Las barras están a la MISMA escala (el ancho es proporcional a los casos, no al
 * 100% de cada fila). Normalizar cada barra a su propio total haría que una seccional
 * con 3 casos se viera igual de grande que Bogotá con 118, y la lectura sería falsa
 * justo en la dimensión que importa: el volumen.
 */
/**
 * "Donde esta represado, por seccional": una barra apilada por ciudad.
 *
 * SEIS filas, no una por ciudad. De 15 ciudades con casos abiertos, 8 tienen exactamente
 * uno: el 3% del volumen ocupando la mitad del alto del grafico. Ninguna de esas ocho es
 * un cuello de botella. La seccional importa operativamente por una sola razon — cuatro
 * de ellas exigen cita previa en la DIAN y ahi esta el 62% de los casos — asi que ese es
 * el corte: las que exigen cita por nombre, el resto agrupado, y sin registrar al final.
 * Es el mismo eje que ya usan las columnas de la tabla de abajo, para que el grafico y la
 * tabla digan lo mismo en la misma forma.
 *
 * Los tramos se agrupan por FASE, no por etapa. Antes cada etapa recibia su propio color
 * de una rueda de tono girada 47 grados por indice — con 16 etapas eso eran 16 colores
 * arbitrarios, una leyenda de 16 items y ninguna relacion con el verde/naranja/azul que
 * significan venta/ejecucion/cobro en el resto de la app. Tres colores con significado
 * responden la pregunta que se hace frente a esta barra ("de quien es la pelota en
 * Bogota") mejor que dieciseis sin el. El desglose fino no se pierde: vive en el tooltip
 * y en la tabla de abajo, etapa por etapa y ciudad por ciudad.
 *
 * La barra tampoco tenia escala. El relleno llevaba `flex-1`, y en un contenedor flex el
 * `flex-basis: 0%` gana sobre el `width` en porcentaje, asi que Bogota (118 casos) y
 * Monteria (1) se dibujaban del mismo largo, bajo un encabezado que prometia "misma
 * escala en todas las barras". Ahora el riel es el que crece y el relleno es un bloque
 * con ancho proporcional adentro.
 */
function BarrasPorSeccional({
  etapas,
  conCita,
  onAbrir,
}: {
  etapas: ProcesoSeccionalEtapa[]
  /** Seccionales que exigen cita previa: las unicas que van con nombre propio. */
  conCita: string[]
  /**
   * Abre el panel con los casos detras de lo que se toco: un tramo (una fase de una
   * seccional) o la fila entera. El grafico no sabe de paneles — dice que se pidio.
   */
  onAbrir: (sel: {
    etapaIds: string[]
    titulo: string
    seccional?: string | string[] | null
    seccionalLabel?: string
  }) => void
}) {
  type ClaveFase = 'venta' | 'ejecucion' | 'cobro' | 'sin'
  const CLAVES: ClaveFase[] = [...FASES, 'sin']
  // Prefijo imposible en un nombre de ciudad: las dos filas sinteticas no pueden
  // colisionar con una seccional que se llame igual.
  const SIN_REGISTRAR = '\u0000sin-registrar'
  const OTRAS = '\u0000otras'

  const exigeCita = new Set(conCita)
  /** Etapas que aportan a un tramo, por id: el panel consulta por id, no por nombre. */
  type Tramo = { n: number; etapas: Map<string, { nombre: string; n: number }> }
  type Fila = {
    total: number
    tramos: Map<ClaveFase, Tramo>
    /** Ciudades que cayeron en esta fila. Solo se usa en la fila agrupada. */
    ciudades: Map<string, number>
  }
  const filasPorClave = new Map<string, Fila>()
  let hayEtapaSinFase = false

  for (const e of etapas) {
    const fase: ClaveFase = e.stage ?? 'sin'
    for (const c of e.celdas) {
      if (c.abiertos <= 0) continue
      if (fase === 'sin') hayEtapaSinFase = true
      const clave =
        c.seccional === null ? SIN_REGISTRAR : exigeCita.has(c.seccional) ? c.seccional : OTRAS
      const fila = filasPorClave.get(clave) ?? {
        total: 0,
        tramos: new Map<ClaveFase, Tramo>(),
        ciudades: new Map<string, number>(),
      }
      fila.total += c.abiertos
      const tramo = fila.tramos.get(fase) ?? { n: 0, etapas: new Map<string, { nombre: string; n: number }>() }
      tramo.n += c.abiertos
      const acumulado = tramo.etapas.get(e.etapaId)
      tramo.etapas.set(e.etapaId, { nombre: e.nombre, n: (acumulado?.n ?? 0) + c.abiertos })
      fila.tramos.set(fase, tramo)
      if (c.seccional !== null) {
        fila.ciudades.set(c.seccional, (fila.ciudades.get(c.seccional) ?? 0) + c.abiertos)
      }
      filasPorClave.set(clave, fila)
    }
  }

  // Las de cita previa por volumen; despues el agrupado; sin registrar de ultimo, porque
  // es un hueco de dato y no una plaza en el ranking.
  const rango = (k: string) => (k === SIN_REGISTRAR ? 2 : k === OTRAS ? 1 : 0)
  const filas = [...filasPorClave.entries()].sort(([ka, a], [kb, b]) =>
    rango(ka) !== rango(kb) ? rango(ka) - rango(kb) : b.total - a.total,
  )

  if (filas.length === 0) return null

  const maximo = Math.max(...filas.map(([, v]) => v.total))
  const colorFase = (f: ClaveFase) => (f === 'sin' ? '#D1D5DB' : STAGE_COLORS[f].text)
  const nombreFase = (f: ClaveFase) => (f === 'sin' ? 'Sin fase declarada' : STAGE_LABELS[f])

  const etiqueta = (k: string, v: Fila) =>
    k === SIN_REGISTRAR
      ? 'Sin registrar'
      : k === OTRAS
        ? `Otras ${v.ciudades.size} ciudad${v.ciudades.size === 1 ? '' : 'es'}`
        : k

  const ayuda = (k: string, v: Fila) =>
    k === SIN_REGISTRAR
      ? 'Casos cuya seccional no se ha registrado'
      : k === OTRAS
        ? `Sin cita previa: ${[...v.ciudades.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([c, n]) => `${c} ${n}`)
            .join(', ')}`
        : `${k} — exige cita previa en la DIAN`

  /** El tooltip conserva el detalle por etapa que el color ya no carga. */
  const detalleTramo = (k: string, v: Fila, f: ClaveFase, t: Tramo) => {
    const top = [...t.etapas.values()].sort((a, b) => b.n - a.n)
    const listado = top.slice(0, 3).map(e => `${e.nombre} ${e.n}`).join(', ')
    const resto = top.length > 3 ? `, +${top.length - 3} etapas más` : ''
    return `${etiqueta(k, v)} · ${nombreFase(f)}: ${t.n} — ${listado}${resto}`
  }

  /**
   * Como se le pide al panel "los casos de esta fila".
   *
   * La fila agrupada manda las ciudades que la sumaron, no un comodin: el panel filtra
   * por la misma lista que se dibujo, asi que la cuenta de la lista no puede diferir de
   * la que dice la barra.
   */
  const alcanceDeFila = (k: string, v: Fila): { seccional: string | string[] | null; seccionalLabel?: string } =>
    k === SIN_REGISTRAR
      ? { seccional: null }
      : k === OTRAS
        ? { seccional: [...v.ciudades.keys()], seccionalLabel: etiqueta(k, v) }
        : { seccional: k }

  const abrirTramo = (k: string, v: Fila, f: ClaveFase, t: Tramo) =>
    onAbrir({ etapaIds: [...t.etapas.keys()], titulo: nombreFase(f), ...alcanceDeFila(k, v) })

  const abrirFila = (k: string, v: Fila) => {
    const ids = new Set<string>()
    for (const t of v.tramos.values()) for (const id of t.etapas.keys()) ids.add(id)
    const unaSola = v.tramos.size === 1 ? nombreFase([...v.tramos.keys()][0]) : 'Todas las fases'
    onAbrir({ etapaIds: [...ids], titulo: unaSola, ...alcanceDeFila(k, v) })
  }

  return (
    <div className="mb-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-wide" style={{ color: GRIS }}>
          Dónde está represado, por seccional
        </h3>
        <span className="text-xs" style={{ color: GRIS }}>
          casos abiertos · misma escala · clic abre la lista
        </span>
      </div>

      <div className="space-y-1.5">
        {filas.map(([k, v]) => {
          const esCita = k !== SIN_REGISTRAR && k !== OTRAS
          return (
            <div key={k} className="flex items-center gap-2">
              {/* La etiqueta es el objetivo grande: 44px de alto en movil, y abre la fila
                  entera. Los tramos son el corte fino, pero un tramo de un caso dentro de
                  una fila de 118 mide dos pixeles y no se puede tocar con el dedo — por eso
                  la respuesta completa nunca depende de acertarle a un tramo. */}
              <button
                type="button"
                onClick={() => abrirFila(k, v)}
                className={`flex w-28 min-h-11 shrink-0 items-center justify-end gap-1 text-right text-xs hover:underline sm:min-h-0 sm:w-32 ${
                  k === SIN_REGISTRAR ? 'italic' : ''
                }`}
                style={{ color: k === SIN_REGISTRAR ? '#9CA3AF' : esCita ? CARBON : GRIS }}
                title={`${ayuda(k, v)} — clic abre los ${v.total} casos`}
              >
                {esCita && <CalendarClock className="h-3 w-3 shrink-0" />}
                <span className="truncate">{etiqueta(k, v)}</span>
              </button>
              {/* El riel es el que ocupa el ancho disponible; el relleno va adentro con el
                  ancho proporcional. Si el relleno llevara `flex-1`, todas las barras
                  saldrían del mismo largo. */}
              <div className="h-6 flex-1 overflow-hidden rounded sm:h-4" style={{ backgroundColor: '#F9FAFB' }}>
                <div
                  className="flex h-full items-stretch overflow-hidden rounded"
                  style={{ width: `${(v.total / maximo) * 100}%`, minWidth: 2 }}
                >
                  {CLAVES.map(f => {
                    const t = v.tramos.get(f)
                    if (!t || t.n === 0) return null
                    const detalle = detalleTramo(k, v, f, t)
                    return (
                      <button
                        key={f}
                        type="button"
                        onClick={() => abrirTramo(k, v, f, t)}
                        className="h-full transition-opacity hover:opacity-70"
                        style={{ width: `${(t.n / v.total) * 100}%`, backgroundColor: colorFase(f) }}
                        title={`${detalle} — clic abre estos casos`}
                        aria-label={detalle}
                      />
                    )
                  })}
                </div>
              </div>
              <span className="w-8 shrink-0 text-right text-xs tabular-nums" style={{ color: GRIS }}>
                {v.total}
              </span>
            </div>
          )
        })}
      </div>

      <p className="mt-2 text-xs" style={{ color: GRIS }}>
        <CalendarClock className="mr-0.5 inline h-3 w-3 align-[-2px]" />
        Con nombre propio van solo las seccionales que exigen cita previa en la DIAN; las
        demás se agrupan. El detalle ciudad por ciudad está en la tabla de abajo.
      </p>

      {/* Sin leyenda de color propia: la de fases, arriba, ya rige la barra y la tabla.
          Solo se agrega el gris cuando de verdad hay etapas sin fase declarada. */}
      {hayEtapaSinFase && (
        <p className="mt-1 flex items-center gap-1 text-xs" style={{ color: GRIS }}>
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: '#D1D5DB' }} />
          Gris: etapas sin fase declarada.
        </p>
      )}
    </div>
  )
}
