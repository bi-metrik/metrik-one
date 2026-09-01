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
  // Radicaciones que el reloj no pudo medir porque su unica asignacion tiene el rol
  // sin declarar. Se declara aparte de "sin casos": una es una deuda de datos que se
  // puede pagar, la otra es un mes sin trabajo que medir.
  const radicacionesSinRol = data.personas.reduce((s, p) => s + (p.radicacion.sin_rol ?? 0), 0)
  const asignacionesSinRol = data.responsables_sin_rol ?? 0
  // El calendario de festivos esta sembrado hasta cierto año. Pasado ese año los
  // festivos cuentan como habiles, en contra del operativo. Se avisa en vez de
  // dejar que el indicador mienta en silencio.
  const festivosHasta = data.festivos_hasta_anio ?? null
  const festivosVencidos = festivosHasta !== null && periodo.anio > festivosHasta
  const relojHabil = (P.radicacion_reloj ?? 'habil') === 'habil'
  // Un indicador con peso 0 esta SUSPENDIDO: no se juzga este mes. Se dibuja gris
  // y con la palabra, nunca como un 0 rojo, que significa lo contrario ("se midio
  // y no cumplio"). Es la misma regla que ya separa "sin medir" de "en cero".
  const suspendidos = [
    P.peso_radicacion === 0 ? 'Radicación' : null,
    P.peso_envio === 0 ? 'Envío' : null,
    P.peso_correcciones === 0 ? 'Correcciones' : null,
  ].filter(Boolean) as string[]
  // Suspender NO reparte el peso entre los demas indicadores: el techo baja.
  const maximo = data.puntaje_maximo
    ?? (P.calidad_base + P.calidad_tramo + P.peso_radicacion + P.peso_envio + P.peso_correcciones)
  const techoReducido = maximo > 0 && maximo < 1

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
      {suspendidos.length > 0 && (
        <Aviso tono="info"
          titulo={`${suspendidos.join(' y ')} ${suspendidos.length === 1 ? 'está suspendido' : 'están suspendidos'} este mes`}
          cuerpo={`${suspendidos.length === 1 ? 'Ese indicador no se juzga' : 'Esos indicadores no se juzgan'}: no suma${suspendidos.length === 1 ? '' : 'n'} ni resta${suspendidos.length === 1 ? '' : 'n'}, y por eso aparece${suspendidos.length === 1 ? '' : 'n'} en gris y no en cero. Suspender no reparte los puntos entre los demás indicadores: el máximo del mes baja a ${(maximo * 100).toFixed(0)} puntos, así que el bono más alto posible deja de ser el ${P.bono_max_pct * 100}% del salario y pasa al ${(P.bono_max_pct * maximo * 100).toFixed(0)}%. Repartir esos puntos es una decisión aparte y se hace moviendo los pesos.`} />
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
      {radicacionesSinRol > 0 && (
        <Aviso tono="alerta"
          titulo={`${radicacionesSinRol} ${radicacionesSinRol === 1 ? 'radicación quedó' : 'radicaciones quedaron'} sin medir`}
          cuerpo={`${radicacionesSinRol === 1 ? 'Ese caso tiene' : 'Esos casos tienen'} un responsable asignado, pero la asignación quedó guardada sin decir de qué área es, y el sistema no puede saber desde cuándo corre el plazo de operaciones. No cuentan como cumplidas ni como incumplidas: quedan fuera del indicador. Hoy hay ${asignacionesSinRol} ${asignacionesSinRol === 1 ? 'asignación así' : 'asignaciones así'} en todo el espacio de trabajo.`} />
      )}
      {festivosVencidos && relojHabil && (
        <Aviso tono="alerta"
          titulo="El calendario de festivos no cubre este periodo"
          cuerpo={`El plazo de radicación descuenta festivos, y el calendario está cargado hasta ${festivosHasta}. En ${periodo.anio} los festivos se están contando como días hábiles, así que el indicador es más estricto de lo acordado. Hay que cargar los festivos del año antes de liquidar este bono.`} />
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
                  Radicación<br /><span className="text-[10px]">
                    {P.peso_radicacion === 0 ? 'suspendido' : `${P.peso_radicacion * 100} pts`}</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">
                  Envío<br /><span className="text-[10px]">
                    {P.peso_envio === 0 ? 'suspendido' : `${P.peso_envio * 100} pts`}</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">
                  Correcciones<br /><span className="text-[10px]">
                    {P.peso_correcciones === 0 ? 'suspendido' : `${P.peso_correcciones * 100} pts`}</span>
                </th>
                <th className="px-3 py-2 font-medium text-center">Puntaje</th>
                <th className="px-4 py-2 font-medium text-right">Bono</th>
                <th className="px-2 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {data.personas.map(p => (
                <FilaPersona key={p.staff_id} p={p} periodo={periodo} P={P} maximo={maximo} />
              ))}
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
            <Celda etiqueta="Radicación" valor={pts(data.supervisor.aportes.radicacion)} sufijo=" pts"
              nota={P.peso_radicacion === 0 ? 'suspendido' : undefined} />
            <Celda etiqueta="Envío" valor={pts(data.supervisor.aportes.envio)} sufijo=" pts"
              nota={P.peso_envio === 0 ? 'suspendido' : undefined} />
            <Celda etiqueta="Correcciones" valor={pts(data.supervisor.aportes.correcciones)} sufijo=" pts"
              nota={P.peso_correcciones === 0 ? 'suspendido' : undefined} />
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
              de {P.horas_radicacion} horas {relojHabil ? 'hábiles' : 'corridas'} desde que se
              asigna el caso.</li>
            <li>· <strong>Envío ({P.peso_envio === 0 ? 'suspendido' : `${P.peso_envio * 100} pts`}):</strong> dentro
              de {P.horas_desde_certificado} h del certificado bancario y al
              menos {P.horas_antes_cita} h antes de la cita.
              {P.peso_envio === 0 && ' Hoy no se está juzgando: no suma ni resta.'}</li>
            <li>· <strong>Correcciones ({P.peso_correcciones === 0 ? 'suspendido' : `${P.peso_correcciones * 100} pts`}):</strong> cada
              caso que <strong>pasa la etapa de envío</strong> cuenta como una radicación
              ante la DIAN, porque ahí se asegura que la información está completa para
              que el cliente radique. Contra eso se miden las devoluciones que la DIAN
              pide por <strong>error propio</strong>. Las marcadas como criterio de un
              tercero se ven, pero no bajan el indicador: es el mismo criterio que usa
              calidad.</li>
          </ul>
          {techoReducido && (
            <p className="mb-3">Con {suspendidos.length === 1 ? 'ese indicador suspendido' : 'esos indicadores suspendidos'} el
              puntaje máximo del mes es <strong>{(maximo * 100).toFixed(0)} puntos</strong>, no 100:
              los puntos suspendidos <strong>no</strong> se reparten entre los demás. El bono más alto
              posible queda en el <strong>{(P.bono_max_pct * maximo * 100).toFixed(0)}%</strong> del
              salario, no en el {P.bono_max_pct * 100}%.</p>
          )}
          <p className="mb-1" style={{ color: CARBON }}><strong>Supuestos que hay que confirmar</strong></p>
          <ul className="space-y-1">
            <li>· El piso de <strong>{P.piso_operativo * 100}%</strong> no es proporcional: por debajo
              de ese porcentaje el indicador vale <strong>0</strong>. Con pocos casos al mes, un solo
              fallo puede costar el indicador completo.</li>
            {relojHabil ? (
              <li>· Qué cuenta como <strong>hora hábil</strong> no está acordado. Hoy un día hábil
                vale <strong>{(P.jornada_fin_hora ?? 24) - (P.jornada_inicio_hora ?? 0)} horas</strong>
                {(P.jornada_inicio_hora ?? 0) === 0 && (P.jornada_fin_hora ?? 24) === 24
                  ? ' (el día completo, igual que el resto del sistema)'
                  : ` (de ${P.jornada_inicio_hora}:00 a ${P.jornada_fin_hora}:00)`},
                el sábado <strong>{P.jornada_sabado_habil ? 'sí' : 'no'}</strong> cuenta, y los festivos
                colombianos se descuentan. Cambiar la jornada mueve el resultado del indicador.</li>
            ) : (
              <li>· Las <strong>{P.horas_radicacion} horas</strong> se están contando
                <strong> corridas</strong>, aunque lo acordado con operaciones fueron horas hábiles.
                Se cambia en la configuración, sin tocar el sistema.</li>
            )}
            <li>· Las <strong>{P.horas_antes_cita} h</strong> antes de la cita y
              las <strong>{P.horas_desde_certificado} h</strong> desde el certificado bancario vienen
              del archivo de cálculo, no de un acuerdo. Esas <strong>sí</strong> son horas corridas a
              propósito: miden contra el calendario de la DIAN, no contra el de la oficina.</li>
          </ul>
        </div>
      )}
    </div>
  )
}

function FilaPersona({ p, periodo, P, maximo }: {
  p: PersonaOperaciones
  periodo: { anio: number; mes: number }
  P: OperacionesBonoData['parametros']
  maximo: number
}) {
  return (
    <tr className="border-t" style={{ borderColor: BORDE }}>
      <td className="px-4 py-3">
        <div className="font-medium" style={{ color: CARBON }}>{p.nombre}</div>
        <div className="text-xs" style={{ color: GRIS }}>{p.cargo}</div>
      </td>
      <ScoreCelda score={p.score_calidad}
        detalle={p.calidad_medida ? `${p.malos} ${p.malos === 1 ? 'malo' : 'malos'}` : 'sin medir'} />
      <ScoreCelda score={p.score_radicacion}
        suspendido={P.peso_radicacion === 0}
        detalle={p.radicacion.pct === null
          ? (p.radicacion.eventos > 0 ? 'sin fecha de asignación' : 'sin casos')
          : `${pct(p.radicacion.pct)} · ${p.radicacion.a_tiempo}/${p.radicacion.medibles}`}
        nota={p.radicacion.sin_rol
          ? `${p.radicacion.sin_rol} sin área declarada`
          : undefined} />
      <ScoreCelda score={p.score_envio}
        suspendido={P.peso_envio === 0}
        detalle={p.envio.pct === null
          ? (p.envio.eventos > 0 ? 'sin fecha de cita' : 'sin casos')
          : `${pct(p.envio.pct)} · ${p.envio.a_tiempo}/${p.envio.medibles}`} />
      {/* Lo que el indicador descarto va aparte del resultado: un 100% con
          devoluciones a la vista necesita explicarse, o se lee como que no hubo. */}
      <ScoreCelda score={p.score_correcciones}
        suspendido={P.peso_correcciones === 0}
        detalle={!p.correcciones.medida
          ? 'sin medir'
          : p.correcciones.pct === null
            ? 'sin radicaciones'
            : `${p.correcciones.correcciones}/${p.correcciones.radicaciones} radicaciones`}
        nota={p.correcciones.terceros
          ? `${p.correcciones.terceros} de terceros, no cuenta${p.correcciones.terceros === 1 ? '' : 'n'}`
          : undefined} />
      <td className="px-3 py-3 text-center">
        <div className="font-semibold" style={{ color: CARBON }}>
          {(p.puntaje * 100).toFixed(0)}%
        </div>
        {/* Con un indicador suspendido el techo deja de ser 100. Mostrar el
            porcentaje a secas dejaria creer que le faltan puntos que ya no existen. */}
        {maximo < 1 && (
          <div className="text-[10px]" style={{ color: GRIS }}>de {(maximo * 100).toFixed(0)}</div>
        )}
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
 * Tres estados, no dos, y la pantalla no los puede confundir:
 *   · suspendido  -> gris, con la palabra. La politica decidio no juzgarlo.
 *   · sin dato    -> gris, con raya. No hubo con que calcularlo.
 *   · en cero     -> rojo. Se midio y no cumplio.
 * El caso que obliga a separarlos: un indicador suspendido pintado como 0 rojo se
 * lee como un incumplimiento de la persona, que es exactamente lo contrario.
 */
function ScoreCelda({ score, detalle, nota, suspendido = false }: {
  score: number | null; detalle: string; nota?: string; suspendido?: boolean
}) {
  const sinDato = score === null
  const enCero = score === 0
  if (suspendido) {
    return (
      <td className="px-3 py-3 text-center">
        <div className="font-semibold" style={{ color: '#D1D5DB' }}>—</div>
        <div className="text-[10px]" style={{ color: GRIS }}>suspendido</div>
      </td>
    )
  }
  return (
    <td className="px-3 py-3 text-center">
      <div className="font-semibold"
        style={{ color: sinDato ? '#D1D5DB' : enCero ? ROJO : VERDE }}>
        {sinDato ? '—' : `${(score * 100).toFixed(0)}`}
      </div>
      <div className="text-[10px]" style={{ color: GRIS }}>{detalle}</div>
      {/* Casos que quedaron fuera del cálculo, no incumplidos. Van aparte del
          detalle para que no se lean como parte del porcentaje. */}
      {nota && <div className="text-[10px]" style={{ color: AMBAR }}>{nota}</div>}
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
