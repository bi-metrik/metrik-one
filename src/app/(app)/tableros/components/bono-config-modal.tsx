'use client'

/**
 * Panel de configuracion del bono de operaciones, mes a mes.
 *
 * Existe para que el cliente ajuste su propio bono sin pasar por MeTRIK: que
 * indicadores aplican este mes, cuantos puntos vale cada uno y con que umbrales se
 * juzgan. Envio puede estar activo en agosto e inactivo en septiembre, y eso lo
 * deciden ellos.
 *
 * Tres cosas que la pantalla tiene que decir y no puede callarse:
 *
 * 1. **Lo que se guarda es de ESTE mes.** Guardar aqui no cambia septiembre ni
 *    reescribe agosto: cada mes lleva su propia politica. Mientras un mes no tenga
 *    politica propia sigue la general, y la pantalla lo dice con todas las letras.
 * 2. **Suspender no reparte los puntos.** Bajar un indicador a 0 baja el techo del
 *    mes, y con el el bono maximo posible. Repartirlos es una decision aparte y se
 *    toma a mano, escribiendo los puntos.
 * 3. **Los meses ya liquidados quedan congelados al guardar.** Es la contraparte de
 *    lo anterior: sin ese paso, cambiar la politica general moveria los bonos de
 *    meses que ya se pagaron.
 */

import { useEffect, useMemo, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, X } from 'lucide-react'
import { toast } from 'sonner'
import type { OperacionesBonoData } from '../operaciones-types'
import {
  getEtapasParaBono, guardarConfigBonoMes, type ConfigBonoMes,
} from '../operaciones-config-actions'

const CARBON = '#1A1A1A'
const GRIS = '#6B7280'
const BORDE = '#E5E7EB'
const VERDE = '#059669'
const AMBAR = '#B45309'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/**
 * El formulario trabaja en las unidades en que la gente habla: puntos (0 a 100) y
 * porcentajes (0 a 100). La base guarda fracciones. La conversion vive solo aqui, en
 * la frontera, y no se reparte por el componente: repartida es como aparecen los
 * campos que se guardan cien veces mas grandes.
 */
type Formulario = {
  calidad_puntos: string
  calidad_puntos_un_malo: string
  calidad_malos_pierde_todo: string
  puntos_radicacion: string
  puntos_envio: string
  puntos_correcciones: string
  piso_operativo: string
  techo_operativo: string
  horas_radicacion: string
  radicacion_reloj: 'habil' | 'corrido'
  horas_desde_certificado: string
  horas_antes_cita: string
  etapa_radicacion_dian_orden: string
  correcciones_cobertura: 'devolucion_dian' | 'cualquier_reproceso'
  bono_max_pct: string
  bono_max_pct_director: string
  piso_director: string
  techo_director: string
}

const p100 = (n: number) => String(Math.round(n * 1000) / 10)

function desdeParametros(P: OperacionesBonoData['parametros']): Formulario {
  return {
    // Calidad se muestra como "puntos totales" y "puntos si hay 1 malo", que es como
    // se habla del indicador. Adentro son tres campos (base, tramo, fraccion) y esa
    // forma no se le pide a nadie que la entienda.
    calidad_puntos: p100(P.calidad_base + P.calidad_tramo),
    calidad_puntos_un_malo: p100(P.calidad_tramo * P.calidad_frac_un_malo),
    calidad_malos_pierde_todo: String(P.calidad_malos_pierde_todo),
    puntos_radicacion: p100(P.peso_radicacion),
    puntos_envio: p100(P.peso_envio),
    puntos_correcciones: p100(P.peso_correcciones),
    piso_operativo: p100(P.piso_operativo),
    techo_operativo: p100(P.techo_operativo),
    horas_radicacion: String(P.horas_radicacion),
    radicacion_reloj: (P.radicacion_reloj ?? 'habil') as 'habil' | 'corrido',
    horas_desde_certificado: String(P.horas_desde_certificado),
    horas_antes_cita: String(P.horas_antes_cita),
    etapa_radicacion_dian_orden: String(P.etapa_radicacion_dian_orden ?? ''),
    correcciones_cobertura: P.correcciones_cobertura,
    bono_max_pct: p100(P.bono_max_pct),
    bono_max_pct_director: p100(P.bono_max_pct_director),
    piso_director: p100(P.piso_director),
    techo_director: p100(P.techo_director),
  }
}

const num = (s: string) => (s.trim() === '' ? NaN : Number(s))
const frac = (s: string) => num(s) / 100

export function BonoConfigModal({
  periodo, parametros: P, onClose, onGuardado,
}: {
  periodo: { anio: number; mes: number }
  parametros: OperacionesBonoData['parametros']
  onClose: () => void
  onGuardado: () => void
}) {
  const [f, setF] = useState<Formulario>(() => desdeParametros(P))
  const [etapas, setEtapas] = useState<{ orden: number; nombre: string }[]>([])
  const [pending, startTransition] = useTransition()

  const original = useMemo(() => desdeParametros(P), [P])
  const cambiado = useMemo(
    () => (Object.keys(f) as (keyof Formulario)[]).some((k) => f[k] !== original[k]),
    [f, original],
  )

  useEffect(() => {
    let vivo = true
    void getEtapasParaBono().then((e) => { if (vivo) setEtapas(e) })
    return () => { vivo = false }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !cambiado) onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, cambiado])

  const set = (k: keyof Formulario) => (v: string) => setF((prev) => ({ ...prev, [k]: v }))

  // El techo del mes es la suma de lo que vale cada indicador. No se corrige solo: la
  // decision fue que los puntos se escriben a mano, asi que la pantalla dice cuanto
  // suma y que significa, y deja la decision donde debe estar.
  const suma = num(f.calidad_puntos) + num(f.puntos_radicacion)
    + num(f.puntos_envio) + num(f.puntos_correcciones)
  const sumaValida = Number.isFinite(suma)
  const bonoTecho = (num(f.bono_max_pct) / 100) * (suma / 100)

  const suspendidos = [
    num(f.puntos_radicacion) === 0 ? 'Radicación' : null,
    num(f.puntos_envio) === 0 ? 'Envío' : null,
    num(f.puntos_correcciones) === 0 ? 'Correcciones' : null,
  ].filter(Boolean) as string[]

  // Bogota. El mes en curso todavia se puede mover sin tocar historia; uno pasado ya
  // se liquido, y cambiarlo cambia una cifra que alguien ya vio.
  const hoy = new Date()
  const mesActual = hoy.getFullYear() * 12 + hoy.getMonth()
  const mesEditado = periodo.anio * 12 + (periodo.mes - 1)
  const esPasado = mesEditado < mesActual

  function guardar() {
    if (!sumaValida) { toast.error('Hay puntos sin escribir.'); return }
    const puntosUnMalo = num(f.calidad_puntos_un_malo)
    const puntosCalidad = num(f.calidad_puntos)
    if (puntosUnMalo > puntosCalidad) {
      toast.error('Con un certificado malo no se pueden ganar más puntos que sin ninguno.')
      return
    }
    const etapa = num(f.etapa_radicacion_dian_orden)
    if (!Number.isFinite(etapa)) {
      toast.error('Falta elegir la etapa que cuenta como radicación ante la DIAN.')
      return
    }

    // Calidad vuelve a sus tres campos internos con la fraccion fijada en 1: asi
    // "puntos con 1 malo" es literalmente lo que se escribio, sin un multiplicador
    // invisible que lo mueva.
    const valores: ConfigBonoMes = {
      calidad_base: (puntosCalidad - puntosUnMalo) / 100,
      calidad_tramo: puntosUnMalo / 100,
      calidad_frac_un_malo: 1,
      calidad_malos_pierde_todo: num(f.calidad_malos_pierde_todo),
      peso_radicacion: frac(f.puntos_radicacion),
      peso_envio: frac(f.puntos_envio),
      peso_correcciones: frac(f.puntos_correcciones),
      piso_operativo: frac(f.piso_operativo),
      techo_operativo: frac(f.techo_operativo),
      horas_radicacion: num(f.horas_radicacion),
      radicacion_reloj: f.radicacion_reloj,
      horas_desde_certificado: num(f.horas_desde_certificado),
      horas_antes_cita: num(f.horas_antes_cita),
      etapa_radicacion_dian_orden: etapa,
      correcciones_cobertura: f.correcciones_cobertura,
      bono_max_pct: frac(f.bono_max_pct),
      bono_max_pct_director: frac(f.bono_max_pct_director),
      piso_director: frac(f.piso_director),
      techo_director: frac(f.techo_director),
    }

    startTransition(async () => {
      const r = await guardarConfigBonoMes(periodo.anio, periodo.mes, valores)
      if (!r.ok) { toast.error(r.error); return }
      toast.success(`Política de ${MESES[periodo.mes - 1]} guardada`)
      onGuardado()
    })
  }

  function cerrar() {
    if (cambiado && !confirm('Hay cambios sin guardar. ¿Descartar?')) return
    onClose()
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      onClick={cerrar}>
      <div className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}>

        <div className="shrink-0 border-b px-5 py-4" style={{ borderColor: BORDE }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-bold" style={{ color: CARBON }}>
                Política del bono, {MESES[periodo.mes - 1]} {periodo.anio}
              </h3>
              <p className="mt-1 text-xs" style={{ color: GRIS }}>
                {P.es_del_mes
                  ? 'Este mes ya tiene política propia. Lo que se guarde aquí solo cambia este mes.'
                  : 'Este mes todavía sigue la política general. Al guardar pasa a tener la suya, y deja de moverse cuando la general cambie.'}
              </p>
            </div>
            <button onClick={cerrar} className="rounded-lg p-1.5 hover:bg-gray-100"
              style={{ color: GRIS }} aria-label="Cerrar">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {esPasado && (
            <Nota tono="alerta"
              texto={`${MESES[periodo.mes - 1]} ya pasó. Si ese bono se liquidó, cambiar estos números cambia una cifra que alguien ya vio.`} />
          )}

          <Seccion titulo="Qué se mide y cuánto vale"
            ayuda="Un indicador en 0 puntos queda suspendido: ese mes no se juzga, no suma ni resta. Los puntos que se le quitan no se reparten entre los demás.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Calidad" sufijo="pts" valor={f.calidad_puntos} onChange={set('calidad_puntos')}
                ayuda="Certificados UPME malos por error propio." />
              <Campo etiqueta="Con 1 certificado malo" sufijo="pts"
                valor={f.calidad_puntos_un_malo} onChange={set('calidad_puntos_un_malo')}
                ayuda="Lo que queda de calidad si hubo exactamente uno." />
              <Campo etiqueta="Radicación" sufijo="pts" valor={f.puntos_radicacion} onChange={set('puntos_radicacion')}
                ayuda="0 = suspendido este mes." />
              <Campo etiqueta="Envío" sufijo="pts" valor={f.puntos_envio} onChange={set('puntos_envio')}
                ayuda="0 = suspendido este mes." />
              <Campo etiqueta="Correcciones" sufijo="pts" valor={f.puntos_correcciones} onChange={set('puntos_correcciones')}
                ayuda="0 = suspendido este mes." />
              <Campo etiqueta="Malos que hacen perder todo" valor={f.calidad_malos_pierde_todo}
                onChange={set('calidad_malos_pierde_todo')}
                ayuda="Con esta cantidad se pierde el bono completo, incluidos los otros indicadores." />
            </div>

            <div className="mt-3 rounded-lg border p-3 text-xs leading-relaxed"
              style={{ borderColor: sumaValida && suma === 100 ? BORDE : '#FDE68A',
                       backgroundColor: sumaValida && suma === 100 ? '#F9FAFB' : '#FFFBEB',
                       color: GRIS }}>
              <span style={{ color: CARBON, fontWeight: 600 }}>
                Suman {sumaValida ? suma : '—'} de 100 puntos.
              </span>{' '}
              {sumaValida && suma < 100 ? (
                <>El máximo alcanzable del mes es {suma}, no 100, así que el bono más alto posible
                  queda en el {Math.round(bonoTecho * 1000) / 10}% del salario y no en el {f.bono_max_pct}%.
                  {suspendidos.length > 0 && ` Suspendidos: ${suspendidos.join(', ')}.`}</>
              ) : sumaValida && suma > 100 ? (
                <>Por encima de 100 un mes perfecto pagaría más que el {f.bono_max_pct}% del salario.</>
              ) : (
                <>Es lo que hay que repartir entre los cuatro indicadores.</>
              )}
            </div>
          </Seccion>

          <Seccion titulo="Metas de cada indicador"
            ayuda="El piso no es proporcional: por debajo de ese porcentaje el indicador vale 0. Con pocos casos al mes un solo fallo puede costar el indicador completo.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Piso para ganar puntos" sufijo="%" valor={f.piso_operativo} onChange={set('piso_operativo')} />
              <Campo etiqueta="Con este % se gana completo" sufijo="%" valor={f.techo_operativo} onChange={set('techo_operativo')} />
              <Campo etiqueta="Plazo de radicación" sufijo="h" valor={f.horas_radicacion} onChange={set('horas_radicacion')}
                ayuda="Desde que se asigna el caso." />
              <Selector etiqueta="Ese plazo corre en" valor={f.radicacion_reloj}
                onChange={(v) => setF((p) => ({ ...p, radicacion_reloj: v as 'habil' | 'corrido' }))}
                opciones={[
                  { valor: 'habil', texto: 'Horas hábiles (descuenta festivos)' },
                  { valor: 'corrido', texto: 'Horas corridas (calendario)' },
                ]} />
              <Campo etiqueta="Envío: desde el certificado" sufijo="h"
                valor={f.horas_desde_certificado} onChange={set('horas_desde_certificado')} />
              <Campo etiqueta="Envío: antes de la cita" sufijo="h"
                valor={f.horas_antes_cita} onChange={set('horas_antes_cita')}
                ayuda="Estas horas son corridas: miden contra el calendario de la DIAN." />
            </div>
          </Seccion>

          <Seccion titulo="Qué cuenta como radicación ante la DIAN"
            ayuda="Todo caso que pasa esta etapa cuenta como una radicación. Es el denominador de correcciones: ahí se asegura que la información está completa para que el cliente radique.">
            <div className="grid gap-3 sm:grid-cols-2">
              <Selector etiqueta="Etapa" valor={f.etapa_radicacion_dian_orden}
                onChange={set('etapa_radicacion_dian_orden')}
                opciones={etapas.map((e) => ({
                  valor: String(e.orden),
                  texto: `${String(e.orden).padStart(2, '0')} · ${e.nombre}`,
                }))} />
              <Selector etiqueta="El indicador se calcula si" valor={f.correcciones_cobertura}
                onChange={(v) => setF((p) => ({
                  ...p, correcciones_cobertura: v as 'devolucion_dian' | 'cualquier_reproceso',
                }))}
                opciones={[
                  { valor: 'devolucion_dian', texto: 'Hubo devoluciones registradas en el mes' },
                  { valor: 'cualquier_reproceso', texto: 'Se registró cualquier reproceso en el mes' },
                ]}
                ayuda="Sin evidencia registrada, cero correcciones no significa trabajo impecable: significa que nadie midió." />
            </div>
          </Seccion>

          <Seccion titulo="Cuánto se paga">
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo etiqueta="Bono máximo del operativo" sufijo="% del salario"
                valor={f.bono_max_pct} onChange={set('bono_max_pct')} />
              <Campo etiqueta="Bono máximo de quien supervisa" sufijo="% del salario"
                valor={f.bono_max_pct_director} onChange={set('bono_max_pct_director')} />
              <Campo etiqueta="Piso de quien supervisa" sufijo="%"
                valor={f.piso_director} onChange={set('piso_director')}
                ayuda="Se aplica al promedio del equipo en cada indicador por separado." />
              <Campo etiqueta="Con este % gana completo" sufijo="%"
                valor={f.techo_director} onChange={set('techo_director')} />
            </div>
          </Seccion>
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t px-5 py-3"
          style={{ borderColor: BORDE }}>
          <p className="text-[11px]" style={{ color: GRIS }}>
            Al guardar, los meses ya pasados que aún seguían la política general quedan fijados
            con la que tenían.
          </p>
          <div className="flex items-center gap-2">
            <button onClick={cerrar} className="rounded-lg px-3 py-2 text-xs font-medium hover:bg-gray-100"
              style={{ color: GRIS }}>
              Cerrar
            </button>
            <button onClick={guardar} disabled={pending || !cambiado}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
              style={{ backgroundColor: VERDE }}>
              {pending ? 'Guardando…' : `Guardar ${MESES[periodo.mes - 1]}`}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function Seccion({ titulo, ayuda, children }: {
  titulo: string; ayuda?: string; children: React.ReactNode
}) {
  return (
    <section>
      <h4 className="text-sm font-semibold" style={{ color: CARBON }}>{titulo}</h4>
      {ayuda && <p className="mb-3 mt-0.5 text-[11px] leading-relaxed" style={{ color: GRIS }}>{ayuda}</p>}
      {!ayuda && <div className="mb-3" />}
      {children}
    </section>
  )
}

function Campo({ etiqueta, sufijo, valor, onChange, ayuda }: {
  etiqueta: string; sufijo?: string; valor: string; onChange: (v: string) => void; ayuda?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium" style={{ color: GRIS }}>
        {etiqueta}{sufijo ? ` (${sufijo})` : ''}
      </span>
      <input type="number" inputMode="decimal" min={0} step="any" value={valor}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100"
        style={{ borderColor: BORDE, color: CARBON }} />
      {ayuda && <span className="mt-1 block text-[10px] leading-snug" style={{ color: GRIS }}>{ayuda}</span>}
    </label>
  )
}

function Selector({ etiqueta, valor, onChange, opciones, ayuda }: {
  etiqueta: string; valor: string; onChange: (v: string) => void
  opciones: { valor: string; texto: string }[]; ayuda?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium" style={{ color: GRIS }}>{etiqueta}</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border px-2.5 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-100"
        style={{ borderColor: BORDE, color: CARBON }}>
        {opciones.length === 0 && <option value="">Cargando…</option>}
        {opciones.map((o) => <option key={o.valor} value={o.valor}>{o.texto}</option>)}
      </select>
      {ayuda && <span className="mt-1 block text-[10px] leading-snug" style={{ color: GRIS }}>{ayuda}</span>}
    </label>
  )
}

function Nota({ tono, texto }: { tono: 'alerta' | 'info'; texto: string }) {
  const esAlerta = tono === 'alerta'
  return (
    <div className="flex gap-2 rounded-lg border p-3"
      style={{ borderColor: esAlerta ? '#FDE68A' : BORDE, backgroundColor: esAlerta ? '#FFFBEB' : '#F9FAFB' }}>
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: esAlerta ? AMBAR : GRIS }} />
      <p className="text-[11px] leading-relaxed" style={{ color: GRIS }}>{texto}</p>
    </div>
  )
}
