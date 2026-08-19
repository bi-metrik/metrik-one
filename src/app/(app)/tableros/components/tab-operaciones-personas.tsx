'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { AlertTriangle, ChevronRight, Info } from 'lucide-react'
import type { OperacionesBonoData, PersonaOperaciones } from '../operaciones-types'
import { getOperacionesBono } from '../operaciones-actions'

// Paleta MeTRIK (tokens del manual de marca, no Tailwind generico).
const VERDE = '#10B981'
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const AMBAR = '#F59E0B'
const ROJO = '#B91C1C'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-CO')
const pct = (n: number | null) => (n === null ? null : `${(n * 100).toFixed(1)}%`)
const pts = (n: number | null) => (n === null ? null : `${(n * 100).toFixed(0)}`)

/**
 * Tablero de bono de operaciones: la vista "Personas" de la pestana Operaciones
 * (y la pestana de operaciones de /equipo, que la reusa tal cual).
 *
 * Trae su propio navegador de mes porque el bono es mensual y se consulta mes a
 * mes. Ese reloj es suyo: la vista "Casos" es una foto de hoy y no lo comparte.
 *
 * La decision de diseño que manda sobre todas las demas: **una celda sin dato se
 * ve distinta de una celda en cero**. "Sin medir" se pinta gris y con raya; un 0
 * real se pinta rojo. Sin esa distincion, un mes en el que nadie registro nada se
 * leeria como un mes impecable, que es justo el error que este tablero existe
 * para no cometer.
 */
export function TabOperacionesPersonas({ data: inicial }: { data: OperacionesBonoData }) {
  const [data, setData] = useState(inicial)
  const [isPending, startTransition] = useTransition()
  const [verParametros, setVerParametros] = useState(false)

  const { periodo, parametros: P } = data

  function cambiarMes(delta: number) {
    const d = new Date(periodo.anio, periodo.mes - 1 + delta, 1)
    startTransition(async () => {
      const nuevo = await getOperacionesBono(d.getFullYear(), d.getMonth() + 1)
      if (nuevo) setData(nuevo)
    })
  }

  const hayAlguienIncompleto = data.personas.some(p => !p.completo)
  const sinSalarios = data.personas.every(p => !p.salario_registrado)

  return (
    <div className={isPending ? 'opacity-50' : ''}>
      {/* Selector de mes */}
      <div className="flex items-center gap-3 mb-5">
        <button onClick={() => cambiarMes(-1)}
          className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50"
          style={{ borderColor: BORDE, color: GRIS }}>←</button>
        <span className="text-sm font-semibold" style={{ color: CARBON }}>
          {MESES[periodo.mes - 1]} {periodo.anio}
        </span>
        <button onClick={() => cambiarMes(1)}
          className="px-3 py-1.5 text-sm rounded-lg border hover:bg-gray-50"
          style={{ borderColor: BORDE, color: GRIS }}>→</button>
      </div>

      {/* Avisos de cobertura. Van ARRIBA de los numeros a proposito: quien mira
          tiene que saber que le falta al dato ANTES de leer el resultado. */}
      {!data.calidad_medida && (
        <Aviso tono="alerta"
          titulo="La calidad no se esta midiendo"
          cuerpo={`No se registro ningun reproceso en ${MESES[periodo.mes - 1]}. El indicador de calidad pesa el ${(P.calidad_base + P.calidad_tramo) * 100}% del bono y sale de los reprocesos marcados en el sistema. Sin ellos, "cero certificados malos" no quiere decir trabajo impecable: quiere decir que nadie midio, y por eso aqui aparece en blanco y no en 40 puntos.`} />
      )}
      {!data.correcciones_medida && (
        <Aviso tono="alerta"
          titulo="Las correcciones de la DIAN no se estan midiendo"
          cuerpo={`${data.devoluciones_mes === 0
            ? `No se registro ninguna devolucion de la DIAN en ${MESES[periodo.mes - 1]}.`
            : 'Falta la evidencia que exige la configuracion del indicador.'} Las radicaciones si se cuentan solas, pero las correcciones salen de los reprocesos marcados en el sistema: sin ellos, "ninguna correccion" no quiere decir trabajo impecable. El indicador pesa el ${P.peso_correcciones * 100}% del bono y por eso aqui aparece en blanco y no en ${P.peso_correcciones * 100} puntos.`} />
      )}
      {sinSalarios && (
        <Aviso tono="info"
          titulo="Sin salarios registrados"
          cuerpo={`El bono es el ${P.bono_max_pct * 100}% del salario y ninguna persona del equipo lo tiene cargado en el sistema. Los puntajes de abajo son reales; el valor en pesos no se puede calcular todavia.`} />
      )}
      {hayAlguienIncompleto && data.calidad_medida && (
        <Aviso tono="info"
          titulo="Puntajes incompletos"
          cuerpo="Hay indicadores sin casos que medir en el periodo. Un indicador sin datos no suma ni resta: se deja fuera del puntaje y la fila queda marcada como incompleta." />
      )}

      {/* Tabla del equipo */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: BORDE }}>
        <div className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: BORDE }}>
          <h3 className="text-sm font-semibold" style={{ color: CARBON }}>Equipo de operaciones</h3>
          <span className="text-xs" style={{ color: GRIS }}>
            {data.personas.length} {data.personas.length === 1 ? 'persona' : 'personas'}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left" style={{ backgroundColor: '#F9FAFB', color: GRIS }}>
                <th className="px-4 py-2 font-medium">Persona</th>
                <th className="px-3 py-2 font-medium text-center">
                  Calidad<br /><span className="text-[10px]">{(P.calidad_base + P.calidad_tramo) * 100} pts</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">
                  Radicación<br /><span className="text-[10px]">{P.peso_radicacion * 100} pts</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">
                  Envío<br /><span className="text-[10px]">{P.peso_envio * 100} pts</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">
                  Correcciones<br /><span className="text-[10px]">{P.peso_correcciones * 100} pts</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">Puntaje</th>
                <th className="px-4 py-2 font-medium text-right">Bono</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.personas.map(p => <FilaPersona key={p.staff_id} p={p} periodo={periodo} />)}
              {data.personas.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-8 text-center" style={{ color: GRIS }}>
                  No hay personas asignadas al área de operaciones.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Supervisor */}
      {data.supervisor && (
        <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: BORDE }}>
          <div className="px-4 py-3 border-b" style={{ borderColor: BORDE }}>
            <h3 className="text-sm font-semibold" style={{ color: CARBON }}>
              Supervisión — {data.supervisor.nombre}
            </h3>
            <p className="text-xs mt-0.5" style={{ color: GRIS }}>
              {P.bono_max_pct_director * 100}% del salario. Sale del promedio del equipo en cada
              indicador por separado, con un piso de {P.piso_director * 100}% en cada uno.
            </p>
          </div>
          <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
            <Celda etiqueta="Calidad" valor={pts(data.supervisor.aportes.calidad)} sufijo=" pts" />
            <Celda etiqueta="Radicación" valor={pts(data.supervisor.aportes.radicacion)} sufijo=" pts" />
            <Celda etiqueta="Envío" valor={pts(data.supervisor.aportes.envio)} sufijo=" pts" />
            <Celda etiqueta="Correcciones" valor={pts(data.supervisor.aportes.correcciones)} sufijo=" pts" />
            <Celda etiqueta="Puntaje"
              valor={`${(data.supervisor.puntaje * 100).toFixed(0)}%`}
              destacado
              nota={data.supervisor.completo ? undefined : 'incompleto'} />
          </div>
          {data.supervisor.bono !== undefined && data.supervisor.salario_registrado && (
            <div className="px-4 py-2 border-t text-right text-sm font-semibold"
              style={{ borderColor: BORDE, color: CARBON }}>
              {pesos(data.supervisor.bono ?? 0)}
            </div>
          )}
        </div>
      )}

      {/* Parametros vigentes: la conversacion con la supervisora se hace sobre la
          pantalla, no sobre un archivo aparte. Por eso la politica se muestra. */}
      <button onClick={() => setVerParametros(v => !v)}
        className="text-xs underline" style={{ color: GRIS }}>
        {verParametros ? 'Ocultar' : 'Ver'} la política con la que se calcula
      </button>
      {verParametros && (
        <div className="mt-3 rounded-xl border p-4 text-xs leading-relaxed"
          style={{ borderColor: BORDE, color: GRIS }}>
          <p className="mb-2" style={{ color: CARBON }}><strong>Cómo se reparte el bono</strong></p>
          <ul className="space-y-1 mb-3">
            <li>· <strong>Calidad ({(P.calidad_base + P.calidad_tramo) * 100} pts):</strong> sin
              certificados malos se gana completo. Con 1 malo baja a {P.calidad_tramo * 100} pts.
              Con {P.calidad_malos_pierde_todo} o más se pierde <strong>todo</strong> el bono del mes,
              incluidos los otros tres indicadores.</li>
            <li>· <strong>Radicación ({P.peso_radicacion * 100} pts):</strong> radicar dentro
              de {P.horas_radicacion} horas.</li>
            <li>· <strong>Envío ({P.peso_envio * 100} pts):</strong> dentro
              de {P.horas_desde_certificado} h del certificado bancario y al
              menos {P.horas_antes_cita} h antes de la cita.</li>
            <li>· <strong>Correcciones ({P.peso_correcciones * 100} pts):</strong> radicaciones ante
              la DIAN contra correcciones que pide la DIAN.</li>
          </ul>
          <p className="mb-1" style={{ color: CARBON }}><strong>Supuestos que hay que confirmar</strong></p>
          <ul className="space-y-1">
            <li>· El piso de <strong>{P.piso_operativo * 100}%</strong> no es proporcional: por debajo
              de ese porcentaje el indicador vale <strong>0</strong>. Con pocos casos al mes, un solo
              fallo puede costar el indicador completo.</li>
            <li>· Las <strong>{P.horas_radicacion} horas</strong> se cuentan desde que el caso entra a
              la etapa de Cargue, en horas corridas. El momento en que la supervisora asigna el caso
              no se registra hoy en el sistema.</li>
            <li>· Las <strong>{P.horas_antes_cita} h</strong> antes de la cita y
              las <strong>{P.horas_desde_certificado} h</strong> desde el certificado bancario vienen
              del archivo de cálculo, no de un acuerdo.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

function FilaPersona({ p, periodo }: { p: PersonaOperaciones; periodo: { anio: number; mes: number } }) {
  return (
    <tr className="border-t" style={{ borderColor: BORDE }}>
      <td className="px-4 py-3">
        <div className="font-medium" style={{ color: CARBON }}>{p.nombre}</div>
        <div className="text-xs" style={{ color: GRIS }}>{p.cargo}</div>
      </td>
      <ScoreCelda score={p.score_calidad}
        detalle={p.calidad_medida ? `${p.malos} ${p.malos === 1 ? 'malo' : 'malos'}` : 'sin medir'} />
      <ScoreCelda score={p.score_radicacion}
        detalle={p.radicacion.pct === null
          ? 'sin casos'
          : `${pct(p.radicacion.pct)} · ${p.radicacion.a_tiempo}/${p.radicacion.medibles}`} />
      <ScoreCelda score={p.score_envio}
        detalle={p.envio.pct === null
          ? (p.envio.eventos > 0 ? 'sin fecha de cita' : 'sin casos')
          : `${pct(p.envio.pct)} · ${p.envio.a_tiempo}/${p.envio.medibles}`} />
      <ScoreCelda score={p.score_correcciones}
        detalle={!p.correcciones.medida
          ? 'sin medir'
          : p.correcciones.pct === null
            ? 'sin radicaciones'
            : `${p.correcciones.correcciones}/${p.correcciones.radicaciones}`} />
      <td className="px-3 py-3 text-center">
        <div className="font-semibold" style={{ color: CARBON }}>
          {(p.puntaje * 100).toFixed(0)}%
        </div>
        {!p.completo && <div className="text-[10px]" style={{ color: AMBAR }}>incompleto</div>}
      </td>
      <td className="px-4 py-3 text-right">
        {p.bono === undefined ? (
          <span className="text-xs" style={{ color: GRIS }}>—</span>
        ) : !p.salario_registrado ? (
          <span className="text-xs" style={{ color: GRIS }}>sin salario</span>
        ) : (
          <span className="font-semibold" style={{ color: CARBON }}>{pesos(p.bono ?? 0)}</span>
        )}
      </td>
      <td className="px-2 py-3">
        <Link href={`/equipo/operaciones/${p.staff_id}?mes=${periodo.anio}-${String(periodo.mes).padStart(2, '0')}`}
          className="inline-flex items-center hover:opacity-70" style={{ color: GRIS }}>
          <ChevronRight className="h-4 w-4" />
        </Link>
      </td>
    </tr>
  )
}

/**
 * Un score sin dato se pinta con raya y en gris; un score en cero se pinta rojo.
 * Son dos cosas distintas y la pantalla no las puede confundir.
 */
function ScoreCelda({ score, detalle }: { score: number | null; detalle: string }) {
  const sinDato = score === null
  const enCero = score === 0
  return (
    <td className="px-3 py-3 text-center">
      <div className="font-semibold"
        style={{ color: sinDato ? '#D1D5DB' : enCero ? ROJO : VERDE }}>
        {sinDato ? '—' : `${(score * 100).toFixed(0)}`}
      </div>
      <div className="text-[10px]" style={{ color: GRIS }}>{detalle}</div>
    </td>
  )
}

function Celda({ etiqueta, valor, sufijo = '', destacado = false, nota }: {
  etiqueta: string; valor: string | null; sufijo?: string; destacado?: boolean; nota?: string
}) {
  return (
    <div>
      <div className="text-[11px]" style={{ color: GRIS }}>{etiqueta}</div>
      <div className={destacado ? 'text-lg font-bold' : 'text-sm font-semibold'}
        style={{ color: valor === null ? '#D1D5DB' : CARBON }}>
        {valor === null ? '—' : valor + sufijo}
      </div>
      {nota && <div className="text-[10px]" style={{ color: AMBAR }}>{nota}</div>}
    </div>
  )
}

function Aviso({ tono, titulo, cuerpo }: { tono: 'alerta' | 'info'; titulo: string; cuerpo: string }) {
  const esAlerta = tono === 'alerta'
  const Icono = esAlerta ? AlertTriangle : Info
  return (
    <div className="rounded-xl border p-4 mb-4 flex gap-3"
      style={{
        borderColor: esAlerta ? '#FDE68A' : BORDE,
        backgroundColor: esAlerta ? '#FFFBEB' : '#F9FAFB',
      }}>
      <Icono className="h-4 w-4 shrink-0 mt-0.5" style={{ color: esAlerta ? AMBAR : GRIS }} />
      <div>
        <p className="text-sm font-semibold" style={{ color: CARBON }}>{titulo}</p>
        <p className="text-xs mt-1 leading-relaxed" style={{ color: GRIS }}>{cuerpo}</p>
      </div>
    </div>
  )
}
