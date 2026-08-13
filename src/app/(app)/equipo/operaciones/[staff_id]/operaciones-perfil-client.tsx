'use client'

import Link from 'next/link'
import { AlertTriangle, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react'
import type {
  OperacionesDetalleData,
  ParametrosBono,
  PersonaOperaciones,
  SupervisorOperaciones,
} from '../../../tableros/operaciones-types'
import { formatFecha } from '@/lib/dates/bogota'

const VERDE = '#10B981'
const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const AMBAR = '#F59E0B'
const ROJO = '#B91C1C'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-CO')
const fecha = (s: string | null) =>
  formatFecha(s, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) ?? '—'

interface Props {
  persona: PersonaOperaciones | null
  supervisor: SupervisorOperaciones | null
  equipo: PersonaOperaciones[]
  parametros: ParametrosBono
  calidadMedida: boolean
  detalle: OperacionesDetalleData
  anio: number
  mes: number
  esPropia: boolean
}

/**
 * Hoja individual del mes.
 *
 * El porcentaje no sirve para conversar: cuando alguien pregunta "por que perdi
 * el indicador", la respuesta util es la lista de casos con sus horas. Por eso
 * la tabla de abajo es el cuerpo de la pantalla y el puntaje es solo el titular.
 */
export default function OperacionesPerfilClient({
  persona, supervisor, equipo, parametros: P, calidadMedida, detalle, anio, mes, esPropia,
}: Props) {
  const nombre = persona?.nombre ?? supervisor?.nombre ?? detalle.nombre
  const puntaje = persona?.puntaje ?? supervisor?.puntaje ?? 0
  const completo = persona?.completo ?? supervisor?.completo ?? false
  const bono = persona?.bono ?? supervisor?.bono
  const salarioOk = persona?.salario_registrado ?? supervisor?.salario_registrado ?? false

  return (
    <div>
      <Link href="/tableros" className="inline-flex items-center gap-1 text-sm mb-4 hover:opacity-70"
        style={{ color: GRIS }}>
        <ArrowLeft className="h-4 w-4" /> Volver a tableros
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold" style={{ color: CARBON }}>{nombre}</h1>
        <p className="text-sm" style={{ color: GRIS }}>
          {MESES[mes - 1]} {anio}
          {persona?.cargo ? ` · ${persona.cargo}` : supervisor?.cargo ? ` · ${supervisor.cargo}` : ''}
        </p>
      </div>

      {/* Titular */}
      <div className="rounded-xl border p-5 mb-6 flex flex-wrap items-end gap-8" style={{ borderColor: BORDE }}>
        <div>
          <div className="text-xs" style={{ color: GRIS }}>Puntaje del mes</div>
          <div className="text-3xl font-bold" style={{ color: CARBON }}>
            {(puntaje * 100).toFixed(0)}%
          </div>
          {!completo && (
            <div className="text-[11px] mt-1" style={{ color: AMBAR }}>
              incompleto — hay indicadores sin datos
            </div>
          )}
        </div>
        <div>
          <div className="text-xs" style={{ color: GRIS }}>Bono</div>
          <div className="text-3xl font-bold" style={{ color: salarioOk ? VERDE : '#D1D5DB' }}>
            {bono === undefined ? '—' : !salarioOk ? '—' : pesos(bono ?? 0)}
          </div>
          <div className="text-[11px] mt-1" style={{ color: GRIS }}>
            {bono === undefined
              ? 'solo lo ve quien lo gana'
              : !salarioOk
                ? 'falta registrar el salario'
                : esPropia ? 'tu bono' : `${(persona ? P.bono_max_pct : P.bono_max_pct_director) * 100}% del salario`}
          </div>
        </div>
      </div>

      {/* Indicadores */}
      {persona && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
          <TarjetaIndicador
            titulo="Calidad del certificado"
            peso={(P.calidad_base + P.calidad_tramo) * 100}
            score={persona.score_calidad}
            cuerpo={calidadMedida
              ? `${persona.malos} ${persona.malos === 1 ? 'certificado malo' : 'certificados malos'} en el mes`
              : 'No se registró ningún reproceso este mes, así que no hay con qué medir la calidad. No es lo mismo que no tener errores.'}
            regla={`Sin malos se gana completo · 1 malo baja a ${P.calidad_tramo * 100} pts · ${P.calidad_malos_pierde_todo} o más pierde todo el bono`}
          />
          <TarjetaIndicador
            titulo="Radicación a tiempo"
            peso={P.peso_radicacion * 100}
            score={persona.score_radicacion}
            cuerpo={persona.radicacion.pct === null
              ? 'No hubo radicaciones que medir en el mes.'
              : `${persona.radicacion.a_tiempo} de ${persona.radicacion.medibles} dentro de ${P.horas_radicacion} horas`}
            regla={`Por debajo de ${P.piso_operativo * 100}% el indicador vale 0`}
          />
          <TarjetaIndicador
            titulo="Envío de documentación"
            peso={P.peso_envio * 100}
            score={persona.score_envio}
            cuerpo={persona.envio.pct === null
              ? (persona.envio.eventos > 0
                ? `Hubo ${persona.envio.eventos} envío(s), pero ninguno tiene registrada la fecha de la cita DIAN contra la cual medirlo.`
                : 'No hubo envíos que medir en el mes.')
              : `${persona.envio.a_tiempo} de ${persona.envio.medibles} a tiempo`}
            regla={`Dentro de ${P.horas_desde_certificado} h del certificado bancario y ${P.horas_antes_cita} h antes de la cita`}
          />
          <TarjetaIndicador
            titulo="Correcciones de la DIAN"
            peso={P.peso_correcciones * 100}
            score={persona.score_correcciones}
            cuerpo={persona.correcciones.pct === null
              ? 'No hubo radicaciones ante la DIAN en el mes.'
              : `${persona.correcciones.correcciones} correcciones sobre ${persona.correcciones.radicaciones} radicaciones`}
            regla={`Por debajo de ${P.piso_operativo * 100}% el indicador vale 0`}
          />
        </div>
      )}

      {/* Supervisor: de donde sale su numero */}
      {supervisor && (
        <div className="rounded-xl border p-4 mb-6" style={{ borderColor: BORDE }}>
          <h3 className="text-sm font-semibold mb-2" style={{ color: CARBON }}>
            De dónde sale este puntaje
          </h3>
          <p className="text-xs mb-3 leading-relaxed" style={{ color: GRIS }}>
            Es el promedio del equipo en <strong>cada indicador por separado</strong>, evaluado
            contra un piso de {P.piso_director * 100}%. Un indicador cuyo promedio quede por debajo
            de ese piso aporta 0, aunque los otros estén perfectos.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([['Calidad', supervisor.aportes.calidad], ['Radicación', supervisor.aportes.radicacion],
               ['Envío', supervisor.aportes.envio], ['Correcciones', supervisor.aportes.correcciones]] as const)
              .map(([et, v]) => (
                <div key={et}>
                  <div className="text-[11px]" style={{ color: GRIS }}>{et}</div>
                  <div className="text-sm font-semibold"
                    style={{ color: v === null ? '#D1D5DB' : v === 0 ? ROJO : CARBON }}>
                    {v === null ? '—' : `${(v * 100).toFixed(0)} pts`}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Casos: el detalle que hace la conversacion posible */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: BORDE }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: BORDE }}>
          <h3 className="text-sm font-semibold" style={{ color: CARBON }}>
            Radicaciones del mes ({detalle.radicaciones.length})
          </h3>
          <p className="text-xs mt-0.5" style={{ color: GRIS }}>
            El reloj arranca cuando el caso entra a la etapa de Cargue. Son horas corridas.
          </p>
        </div>
        {detalle.radicaciones.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: GRIS }}>
            Sin radicaciones en este mes.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left" style={{ backgroundColor: '#F9FAFB', color: GRIS }}>
                  <th className="px-4 py-2 font-medium">Caso</th>
                  <th className="px-3 py-2 font-medium">Entró a Cargue</th>
                  <th className="px-3 py-2 font-medium">Radicó</th>
                  <th className="px-3 py-2 font-medium text-right">Horas</th>
                  <th className="px-4 py-2 font-medium text-center">A tiempo</th>
                </tr>
              </thead>
              <tbody>
                {detalle.radicaciones.map((r, i) => (
                  <tr key={`${r.negocio_id}-${i}`} className="border-t" style={{ borderColor: BORDE }}>
                    <td className="px-4 py-2">
                      <Link href={`/negocios/${r.negocio_id}`} className="hover:underline"
                        style={{ color: CARBON }}>
                        {r.codigo ?? r.nombre ?? 'Caso'}
                      </Link>
                    </td>
                    <td className="px-3 py-2" style={{ color: r.inicio ? GRIS : '#D1D5DB' }}>
                      {r.inicio ? fecha(r.inicio) : 'sin registro'}
                    </td>
                    <td className="px-3 py-2" style={{ color: GRIS }}>{fecha(r.fin)}</td>
                    <td className="px-3 py-2 text-right font-medium"
                      style={{ color: r.horas === null ? '#D1D5DB' : CARBON }}>
                      {r.horas === null ? '—' : `${r.horas} h`}
                    </td>
                    <td className="px-4 py-2 text-center">
                      {r.a_tiempo === null ? (
                        <span className="text-xs" style={{ color: '#D1D5DB' }}>no medible</span>
                      ) : r.a_tiempo ? (
                        <CheckCircle2 className="h-4 w-4 inline" style={{ color: VERDE }} />
                      ) : (
                        <XCircle className="h-4 w-4 inline" style={{ color: ROJO }} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Reprocesos atribuidos */}
      <div className="rounded-xl border overflow-hidden mb-6" style={{ borderColor: BORDE }}>
        <div className="px-4 py-3 border-b" style={{ borderColor: BORDE }}>
          <h3 className="text-sm font-semibold" style={{ color: CARBON }}>
            Reprocesos atribuidos ({detalle.reprocesos.length})
          </h3>
          <p className="text-xs mt-0.5" style={{ color: GRIS }}>
            Solo los de <strong>error propio</strong> penalizan. Los que la DIAN devuelve por
            criterio del funcionario no cuentan como falla de calidad.
          </p>
        </div>
        {detalle.reprocesos.length === 0 ? (
          <p className="px-4 py-6 text-sm text-center" style={{ color: GRIS }}>
            {calidadMedida
              ? 'Ningún reproceso atribuido en este mes.'
              : 'No se registró ningún reproceso en el sistema este mes, ni de esta persona ni de nadie.'}
          </p>
        ) : (
          <ul className="divide-y" style={{ borderColor: BORDE }}>
            {detalle.reprocesos.map((r, i) => (
              <li key={`${r.negocio_id}-${r.ciclo}-${i}`} className="px-4 py-3 flex gap-3">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5"
                  style={{ color: r.causa === 'error_propio' ? ROJO : GRIS }} />
                <div>
                  <div className="text-sm" style={{ color: CARBON }}>
                    <Link href={`/negocios/${r.negocio_id}`} className="hover:underline font-medium">
                      {r.codigo ?? r.nombre ?? 'Caso'}
                    </Link>
                    {' — '}
                    {r.tipo === 'certificacion_upme' ? 'Certificación UPME' : 'Devolución DIAN'}
                    {' · ciclo '}{r.ciclo}
                  </div>
                  <div className="text-xs mt-0.5" style={{ color: GRIS }}>
                    {r.causa === 'error_propio' ? 'Error propio (penaliza)' : 'Criterio del tercero (no penaliza)'}
                    {' · '}{fecha(r.abierto_at)}
                    {r.detalle ? ` · ${r.detalle}` : ''}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Comparacion con el equipo: acordada a proposito con la supervisora. */}
      {equipo.length > 1 && (
        <div className="rounded-xl border p-4" style={{ borderColor: BORDE }}>
          <h3 className="text-sm font-semibold mb-3" style={{ color: CARBON }}>El equipo este mes</h3>
          <ul className="space-y-2">
            {equipo.map(p => (
              <li key={p.staff_id} className="flex items-center justify-between text-sm">
                <Link href={`/equipo/operaciones/${p.staff_id}?mes=${anio}-${String(mes).padStart(2, '0')}`}
                  className="hover:underline"
                  style={{ color: p.staff_id === detalle.staff_id ? CARBON : GRIS,
                           fontWeight: p.staff_id === detalle.staff_id ? 600 : 400 }}>
                  {p.nombre}
                </Link>
                <span className="font-medium" style={{ color: CARBON }}>
                  {(p.puntaje * 100).toFixed(0)}%
                  {!p.completo && <span className="text-[10px] ml-1" style={{ color: AMBAR }}>·</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function TarjetaIndicador({ titulo, peso, score, cuerpo, regla }: {
  titulo: string; peso: number; score: number | null; cuerpo: string; regla: string
}) {
  const sinDato = score === null
  return (
    <div className="rounded-xl border p-4" style={{ borderColor: BORDE }}>
      <div className="flex items-start justify-between mb-1">
        <h4 className="text-sm font-semibold" style={{ color: CARBON }}>{titulo}</h4>
        <div className="text-right">
          <span className="text-lg font-bold"
            style={{ color: sinDato ? '#D1D5DB' : score === 0 ? ROJO : VERDE }}>
            {sinDato ? '—' : (score * 100).toFixed(0)}
          </span>
          <span className="text-xs" style={{ color: GRIS }}> / {peso}</span>
        </div>
      </div>
      <p className="text-xs leading-relaxed" style={{ color: sinDato ? AMBAR : GRIS }}>{cuerpo}</p>
      <p className="text-[10px] mt-2 leading-relaxed" style={{ color: '#9CA3AF' }}>{regla}</p>
    </div>
  )
}
