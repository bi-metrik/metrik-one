'use client'

import { useMemo, useRef, useState } from 'react'
import { FileJson, Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

import { MONEDAS, type Moneda } from '@/lib/proveedores/extraccion'
import { monedaDeFila, type AjustesMoneda } from '@/lib/proveedores/tarifas-extraidas'
import { NOMBRE_TARIFA_CANAL } from '@/lib/proveedores/tipos'
import { fechaCorta } from '@/lib/proveedores/vigencia'
import { cerrarCargaExtraccion, elegirTarifarioDeFicha, extraerTarifario, guardarExtraccion, usarSugerenciasDeExtraccion, type ExtraccionVista, type UsoTarifario } from '../actions'

const DECISION: Record<string, string> = {
  usar: 'usados',
  unir: 'unidos',
  complemento: 'complemento',
  descartar_reemplazado: 'reemplazados',
  vencido_sin_reemplazo: 'vencidos sin reemplazo',
  excluir_bancario: 'bancarios (excluidos)',
  no_sirve: 'no sirven',
  duplicado: 'duplicados',
  sin_leer: 'sin leer',
}

const FUENTE: Record<string, string> = {
  contenido: 'del contenido del documento',
  nombre_archivo: 'solo del nombre del archivo',
  ninguna: 'no aparece en ningún archivo',
}

const campo = 'block h-8 w-full min-w-0 rounded-md border bg-background px-2 text-xs text-foreground'
const boton = 'inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50'
const siNo = (v: boolean | null) => (v === true ? 'sí' : v === false ? 'no' : 'no lo dice')

/** Quita las llaves vacías de los ajustes antes de guardarlos. */
function limpios(a: AjustesMoneda): AjustesMoneda {
  const r: AjustesMoneda = {}
  if (a.tarifario) r.tarifario = a.tarifario
  if (a.establecimientos && Object.keys(a.establecimientos).length > 0) r.establecimientos = a.establecimientos
  if (a.filas && Object.keys(a.filas).length > 0) r.filas = a.filas
  return r
}


/** Cuando la acción ni siquiera responde (red cortada o la página agotó su tiempo en Vercel). */
const MENSAJE_MOTOR_SIN_RESPUESTA = 'No llegó la respuesta del motor: se cortó la conexión o se agotó el tiempo. Recarga la página para ver si la extracción quedó guardada y, si no, vuelve a intentarlo.'
/**
 * «Extracción del motor» (Mauricio, 2026-10-19): la última lectura de los tarifarios del proveedor y
 * su CARGA. El motor corre desde aquí («Extraer con el motor») o se sube su JSON. La carga se cierra
 * confirmando la vigencia (obligatoria si el motor no la fijó) y la moneda (todo, por establecimiento
 * o por fila); solo una carga cerrada cuenta para cotizar. Un tarifario de cadena se usa en varias
 * fichas: cada una elige su establecimiento.
 */
export default function SeccionExtraccion({
  proveedorId,
  extraccion,
  uso = null,
  editable,
  onCambio,
}: {
  proveedorId: string
  extraccion: ExtraccionVista | null
  uso?: UsoTarifario | null
  editable: boolean
  onCambio: () => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = useState<null | 'subir' | 'motor' | 'cerrar' | 'usar' | 'uso'>(null)
  const x = extraccion
  const r = x?.resumen
  const [desde, setDesde] = useState(x?.vigenciaConfirmada?.desde ?? r?.vigencia.desde ?? '')
  const [hasta, setHasta] = useState(x?.vigenciaConfirmada?.hasta ?? r?.vigencia.hasta ?? '')
  const [monedas, setMonedas] = useState<AjustesMoneda>(x?.monedas ?? {})
  const [verFilas, setVerFilas] = useState(false)
  const [fuente, setFuente] = useState(uso?.tarifarioDe?.id ?? '')
  const [establecimiento, setEstablecimiento] = useState(uso?.establecimiento ?? '')

  // El fallo del motor queda escrito en la sección (no solo en un aviso que se va): la corrida tarda
  // minutos y la persona puede no estar mirando cuando termina.
  const [errorMotor, setErrorMotor] = useState<string | null>(null)

  const correr = async <T,>(cual: NonNullable<typeof ocupado>, fn: () => Promise<{ ok: true } & T | { ok: false; error: string }>, exito: (r: T) => string) => {
    if (ocupado) return
    setOcupado(cual)
    if (cual === 'motor') setErrorMotor(null)
    const fallo = (mensaje: string) => {
      if (cual === 'motor') setErrorMotor(mensaje)
      toast.error(mensaje, cual === 'motor' ? { duration: 15_000 } : undefined)
    }
    try {
      const res = await fn()
      if (!res.ok) return void fallo(res.error)
      toast.success(exito(res as T))
      onCambio()
    } catch {
      fallo(cual === 'motor' ? MENSAJE_MOTOR_SIN_RESPUESTA : 'No se pudo completar. Vuelve a intentarlo.')
    } finally {
      setOcupado(null)
      if (entrada.current) entrada.current.value = ''
    }
  }

  const conAvisos = (r: { avisos: string[] }) => (r.avisos.length > 0 ? `Extracción guardada. Ojo: ${r.avisos.join(' · ')}` : 'Extracción guardada')
  const subir = (archivo: File) =>
    correr<{ avisos: string[] }>('subir', async () => guardarExtraccion(proveedorId, await archivo.text(), { instruccion: /v\d+/i.exec(archivo.name)?.[0] ?? null }), conAvisos)
  const motor = () => correr<{ avisos: string[] }>('motor', () => extraerTarifario(proveedorId), conAvisos)
  const usar = () => correr('usar', () => usarSugerenciasDeExtraccion(proveedorId), () => 'Anotado en la ficha')
  const porConfirmar = !!x?.vigenciaPorConfirmar
  const faltaVigencia = porConfirmar ? !desde || !hasta : false
  const cerrar = () => {
    if (!x) return
    // Si el motor la dejó por confirmar, viajan las fechas escritas; si no, solo si la persona las cambió.
    const cambio = desde !== (r?.vigencia.desde ?? '') || hasta !== (r?.vigencia.hasta ?? '')
    const fechas = porConfirmar || cambio ? { desde, hasta } : {}
    return correr('cerrar', () => cerrarCargaExtraccion(x.id, { ...fechas, monedas: limpios(monedas) }), () => (x.estado === 'revisada' ? 'Carga actualizada' : 'Carga cerrada: el tarifario ya cuenta para cotizar'))
  }
  const guardarUso = () =>
    correr('uso', () => elegirTarifarioDeFicha(proveedorId, { tarifarioDeId: fuente || null, establecimiento: fuente === (uso?.tarifarioDe?.id ?? '') ? establecimiento || null : null }), () => 'Guardado')

  const filas = x?.filas ?? []
  const tarifario = useMemo(() => ({ moneda: r?.moneda ?? null }), [r?.moneda])
  const monedaFila = (i: number) => monedaDeFila({ establecimiento: filas[i]?.establecimiento, moneda: filas[i]?.monedaMotor }, i, tarifario, monedas)
  const establecimientos = r?.establecimientos ?? []
  const cambiarEst = (e: string, m: string) =>
    setMonedas((a) => {
      const est = { ...(a.establecimientos ?? {}) }
      if (m) est[e] = m as Moneda
      else delete est[e]
      return { ...a, establecimientos: est }
    })
  const cambiarFila = (i: number, m: string) =>
    setMonedas((a) => {
      const f = { ...(a.filas ?? {}) }
      if (m) f[String(i)] = m as Moneda
      else delete f[String(i)]
      return { ...a, filas: f }
    })

  const s = x?.sugerencias
  const haySugerencias = !!s && (s.tarifaCanal !== null || s.ivaDeclarado !== null || s.ivaIncluido !== null)
  return (
    <section className="space-y-2" data-seccion="extraccion">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Extracción del motor</h2>
        {editable && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void motor()} disabled={!!ocupado} className={boton} data-extraer-motor>
              {ocupado === 'motor' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} {ocupado === 'motor' ? 'Leyendo los tarifarios…' : 'Extraer con el motor'}
            </button>
            <button type="button" onClick={() => entrada.current?.click()} disabled={!!ocupado} className={boton}>
              {ocupado === 'subir' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />} Subir extracción (JSON)
            </button>
            <input ref={entrada} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
          </div>
        )}
      </div>
      {ocupado === 'motor' && <p className="m-0 text-xs text-muted-foreground">El motor lee todos los tarifarios del proveedor: puede tardar unos minutos.</p>}
      {errorMotor && ocupado !== 'motor' && (
        <p role="alert" className="m-0 rounded-md border border-destructive/40 bg-destructive/5 px-2 py-1.5 text-xs text-destructive" data-error-motor>
          {errorMotor}
        </p>
      )}

      {!x || !r ? (
        <p className="m-0 text-xs text-muted-foreground">Todavía no hay una extracción de los tarifarios de {uso?.tarifarioDe ? uso.tarifarioDe.nombre : 'este proveedor'}.</p>
      ) : (
        <div className="space-y-2 rounded-lg border p-3 text-xs" data-resumen-extraccion>
          <p className="m-0 text-muted-foreground">
            {x.deOtraFicha ? `Tarifario de ${x.deOtraFicha.nombre} · ` : ''}
            {fechaCorta(x.creadaAt.slice(0, 10))}
            {x.creadaPor ? ` · ${x.creadaPor}` : ''}
            {x.instruccion ? ` · instrucción ${x.instruccion}` : ''}
            {x.modelo ? ` · ${x.modelo}` : ''} · esquema {x.esquema}
          </p>
          <p className="m-0">
            {r.tarifas} tarifas en {r.temporadas} temporadas{r.monedas.length > 0 ? ` (${r.monedas.join(', ')})` : r.moneda ? ` (${r.moneda})` : ''}
            {establecimientos.length > 1 ? ` · ${establecimientos.length} establecimientos` : ''}
            {r.canal ? ` · canal ${r.canal}` : ' · canal sin decir'} · IVA declarado: {siNo(r.ivaDeclarado)} · incluido: {siNo(r.ivaIncluido)}
            {r.advertencias > 0 ? ` · ${r.advertencias} advertencias` : ''}
          </p>
          {Object.keys(r.decisiones).length > 0 && (
            <p className="m-0 text-muted-foreground">
              Archivos: {Object.entries(r.decisiones).map(([k, n]) => `${n} ${DECISION[k] ?? k}`).join(' · ')}
            </p>
          )}
          {r.pedir.length > 0 && (
            <div>
              <p className="m-0 font-medium">Lo que hay que pedirle al proveedor</p>
              <ul className="m-0 list-disc pl-4 text-muted-foreground">
                {r.pedir.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          )}

          {/* ── La carga: vigencia y moneda ── */}
          <div className="space-y-2 border-t pt-2" data-carga-extraccion={x.estado}>
            {x.estado === 'revisada' && x.vigenciaConfirmada ? (
              <p className="m-0 font-medium text-emerald-700">
                Carga cerrada · vale del {fechaCorta(x.vigenciaConfirmada.desde)} al {fechaCorta(x.vigenciaConfirmada.hasta)} ({x.vigenciaConfirmada.por === 'persona' ? 'vigencia escrita al cargar' : 'vigencia del documento'})
              </p>
            ) : (
              <p className="m-0 font-medium text-amber-700">Carga sin cerrar: este tarifario no se usa para cotizar hasta confirmar la vigencia y la moneda.</p>
            )}

            <div className={`space-y-1 rounded-md p-2 ${porConfirmar ? 'border border-[#E0B566] bg-[#FFF8EB]' : 'bg-muted/40'}`} data-vigencia-por-confirmar={porConfirmar || undefined}>
              <p className="m-0 font-medium">{porConfirmar ? 'Escribe hasta cuándo vale este tarifario' : 'Vigencia'}</p>
              {porConfirmar && <p className="m-0 text-muted-foreground">El motor no pudo fijarla con certeza: la fecha {r.vigencia.fuente ? FUENTE[r.vigencia.fuente] ?? r.vigencia.fuente : 'no está escrita'}. No se toma del nombre del archivo ni de la fecha de carga.</p>}
              {r.vigencia.texto && <p className="m-0 text-muted-foreground">Lo que dice el documento: «{r.vigencia.texto}»</p>}
              <div className="grid grid-cols-2 gap-2 sm:max-w-sm">
                <label className="space-y-0.5 text-[11px] text-muted-foreground">
                  Vale desde
                  <input type="date" className={campo} value={desde} disabled={!editable} onChange={(e) => setDesde(e.target.value)} data-vigencia-desde />
                </label>
                <label className="space-y-0.5 text-[11px] text-muted-foreground">
                  Vale hasta
                  <input type="date" className={campo} value={hasta} disabled={!editable} onChange={(e) => setHasta(e.target.value)} data-vigencia-hasta />
                </label>
              </div>
            </div>

            <div className="space-y-1">
              <p className="m-0 font-medium">Moneda</p>
              <p className="m-0 text-muted-foreground">El motor propone la moneda de cada fila. Cámbiala si no es la del documento.</p>
              <label className="flex items-center gap-2">
                <span className="w-40 shrink-0 text-muted-foreground">Todo el tarifario</span>
                <select className={`${campo} max-w-48`} value={monedas.tarifario ?? ''} disabled={!editable} onChange={(e) => setMonedas((a) => ({ ...a, tarifario: (e.target.value || null) as Moneda | null }))} data-moneda-tarifario>
                  <option value="">La que propuso el motor</option>
                  {MONEDAS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              {establecimientos.length > 1 &&
                establecimientos.map((e) => (
                  <label key={e} className="flex items-center gap-2">
                    <span className="w-40 shrink-0 truncate text-muted-foreground" title={e}>
                      {e}
                    </span>
                    <select className={`${campo} max-w-48`} value={monedas.establecimientos?.[e] ?? ''} disabled={!editable} onChange={(ev) => cambiarEst(e, ev.target.value)} data-moneda-establecimiento={e}>
                      <option value="">Como el tarifario</option>
                      {MONEDAS.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              {filas.length > 0 && (
                <button type="button" className="text-xs underline" onClick={() => setVerFilas((v) => !v)}>
                  {verFilas ? 'Ocultar las filas' : `Ver las ${filas.length} filas y cambiar la moneda de una`}
                </button>
              )}
              {verFilas && (
                <div className="max-h-96 overflow-auto rounded-md border">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-background text-left text-muted-foreground">
                      <tr>
                        {establecimientos.length > 1 && <th className="px-2 py-1">Establecimiento</th>}
                        <th className="px-2 py-1">Categoría</th>
                        <th className="px-2 py-1">Temporada · plan</th>
                        <th className="px-2 py-1">Ocupación · pax</th>
                        <th className="px-2 py-1 text-right">Precio</th>
                        <th className="px-2 py-1">Moneda</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f) => (
                        <tr key={f.i} className="border-t">
                          {establecimientos.length > 1 && <td className="px-2 py-1">{f.establecimiento ?? '—'}</td>}
                          <td className="px-2 py-1">{f.categoria ?? '—'}</td>
                          <td className="px-2 py-1">{[f.temporada, f.plan].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="px-2 py-1">{[f.ocupacion, f.pasajero, f.pax ? `${f.pax} pax` : null].filter(Boolean).join(' · ') || '—'}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{f.precio === null ? '—' : f.precio.toLocaleString('es-CO')}</td>
                          <td className="px-2 py-1">
                            <select className="h-7 rounded border bg-background px-1" value={monedas.filas?.[String(f.i)] ?? ''} disabled={!editable} onChange={(e) => cambiarFila(f.i, e.target.value)} data-moneda-fila={f.i}>
                              <option value="">{monedaFila(f.i) ?? '—'}</option>
                              {MONEDAS.map((m) => (
                                <option key={m} value={m}>
                                  {m}
                                </option>
                              ))}
                            </select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {editable && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void cerrar()} disabled={!!ocupado || faltaVigencia} className={boton} data-cerrar-carga>
                  {ocupado === 'cerrar' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {x.estado === 'revisada' ? 'Guardar cambios de la carga' : 'Cerrar la carga'}
                </button>
                {faltaVigencia && <span className="text-amber-700">Falta escribir la vigencia.</span>}
              </div>
            )}
          </div>

          {editable && haySugerencias && s && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="text-muted-foreground">
                La extracción dice{s.tarifaCanal ? ` tarifa ${NOMBRE_TARIFA_CANAL[s.tarifaCanal].toLowerCase()}` : ''}
                {s.ivaDeclarado ? `, cobra IVA${s.ivaIncluido === true ? ' (incluido en el precio)' : s.ivaIncluido === false ? ' (aparte)' : ''}` : ''}.
              </span>
              <button type="button" onClick={() => void usar()} disabled={!!ocupado} className="inline-flex h-7 items-center rounded-md border bg-background px-2 font-medium hover:bg-accent disabled:opacity-50">
                Usar en la ficha
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Qué tarifario usa esta ficha (cadena) ── */}
      {uso && (
        <div className="space-y-2 rounded-lg border p-3 text-xs" data-uso-tarifario>
          <p className="m-0 font-medium">Tarifas para cotizar esta ficha</p>
          <p className={`m-0 ${uso.cotiza.ok ? 'text-emerald-700' : 'text-amber-700'}`} data-cotiza={uso.cotiza.ok || undefined}>
            {uso.cotiza.ok ? `${uso.cotiza.tarifas} tarifas cuentan para cotizar.` : uso.cotiza.motivo}
          </p>
          {uso.nuevaPorRevisar && (
            <p className="m-0 text-amber-700" data-nueva-por-revisar>
              Hay una extracción nueva por revisar. La cotización sigue usando la revisada
              {uso.nuevaPorRevisar.revisadaAt ? ` del ${new Date(uso.nuevaPorRevisar.revisadaAt).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}` : ''} hasta que cierres la carga de la nueva.
            </p>
          )}
          {editable && (
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-0.5 text-[11px] text-muted-foreground">
                Tarifario
                <select className={campo} value={fuente} onChange={(e) => setFuente(e.target.value)} data-tarifario-de>
                  <option value="">El de esta ficha</option>
                  {uso.fichasConExtraccion.map((f) => (
                    <option key={f.id} value={f.id}>
                      El de {f.nombre} (cadena)
                    </option>
                  ))}
                  {uso.tarifarioDe && !uso.fichasConExtraccion.some((f) => f.id === uso.tarifarioDe?.id) && <option value={uso.tarifarioDe.id}>El de {uso.tarifarioDe.nombre} (cadena)</option>}
                </select>
              </label>
              {fuente === (uso.tarifarioDe?.id ?? '') && establecimientos.length > 0 && (
                <label className="space-y-0.5 text-[11px] text-muted-foreground">
                  Establecimiento que es esta ficha
                  <select className={campo} value={establecimiento} onChange={(e) => setEstablecimiento(e.target.value)} data-establecimiento>
                    <option value="">{establecimientos.length > 1 ? 'Elige uno' : 'Todo el tarifario'}</option>
                    {establecimientos.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="sm:col-span-2">
                <button type="button" onClick={() => void guardarUso()} disabled={!!ocupado} className={boton} data-guardar-uso>
                  {ocupado === 'uso' && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {fuente !== (uso.tarifarioDe?.id ?? '') ? 'Usar ese tarifario' : 'Guardar'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
