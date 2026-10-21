'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { todayBogotaISO } from '@/lib/dates/bogota'
import { TIPOS_COLABORADOR, valorVigente, type Colaborador, type TipoColaborador } from '@/lib/obras/colaboradores'
import { fechaLegible, pesos } from '@/lib/obras/formato'
import {
  agregarValorJornada,
  borrarValorJornada,
  cambiarActivoColaborador,
  cambiarTipoColaborador,
  guardarColaborador,
  leerColaboradores,
} from './obras-config-actions'

const campo = 'block h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm text-foreground'
const etiqueta = 'min-w-0 space-y-0.5 text-[11px] text-muted-foreground'
const boton = 'inline-flex h-9 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50'

interface Borrador {
  id: string | null
  name: string
  phone: string
  tipo: TipoColaborador
}

/** El celular guardado (573001234567) como se lee: 300 123 4567. */
function celularLegible(phone: string): string {
  const d = phone.replace(/\D/g, '')
  const local = d.startsWith('57') && d.length === 12 ? d.slice(2) : d
  return local.length === 10 ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : `+${d}`
}

/**
 * «Colaboradores de WhatsApp» en Configuración (C5, C6): quién le escribe al asistente sin ser
 * usuario de ONE, si es Equipo u Operario, y el valor de su jornada con la fecha desde la que vale
 * (con su historial). Cambiar el valor no reescribe los días que ya se marcaron.
 */
export default function ColaboradoresSection() {
  const hoy = todayBogotaISO()
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [colaboradores, setColaboradores] = useState<Colaborador[]>([])
  const [borrador, setBorrador] = useState<Borrador | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [valor, setValor] = useState({ valor: '', vigente_desde: hoy })
  const [ocupado, setOcupado] = useState(false)

  const cargar = useCallback(async () => {
    const r = await leerColaboradores()
    setCargando(false)
    if (!r.ok) return setError(r.error)
    setError(null)
    setColaboradores(r.colaboradores)
  }, [])

  useEffect(() => {
    void cargar()
  }, [cargar])

  const correr = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, exito: string) => {
    if (ocupado) return false
    setOcupado(true)
    try {
      const r = await fn()
      if (!r.ok) {
        toast.error(r.error)
        return false
      }
      toast.success(exito)
      await cargar()
      return true
    } catch {
      toast.error('No se pudo. Vuelve a intentarlo.')
      return false
    } finally {
      setOcupado(false)
    }
  }

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando colaboradores…
      </div>
    )
  }
  if (error) return <p className="p-4 text-sm text-muted-foreground">{error}</p>

  return (
    <div className="space-y-4" data-colaboradores>
      <p className="m-0 rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        Las personas que le escriben al asistente de WhatsApp sin ser usuarios de ONE. Un <strong>operario</strong> solo marca su llegada a la obra y ve
        sus días; su jornada vale lo que diga el valor vigente ese día.
      </p>

      <button
        type="button"
        onClick={() => setBorrador({ id: null, name: '', phone: '', tipo: 'operario' })}
        className="inline-flex h-9 items-center gap-1 rounded-md bg-[#10B981] px-3 text-xs font-medium text-white hover:bg-[#059669]"
      >
        <Plus className="h-3.5 w-3.5" /> Agregar colaborador
      </button>

      {borrador && (
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-3" data-borrador-colaborador>
          <label className={etiqueta}>
            Nombre
            <input className={campo} value={borrador.name} onChange={(e) => setBorrador({ ...borrador, name: e.target.value })} placeholder="Pedro Gómez" />
          </label>
          <label className={etiqueta}>
            Celular
            <input className={campo} inputMode="tel" value={borrador.phone} onChange={(e) => setBorrador({ ...borrador, phone: e.target.value })} placeholder="300 123 4567" />
          </label>
          <label className={etiqueta}>
            Tipo
            <select className={campo} value={borrador.tipo} onChange={(e) => setBorrador({ ...borrador, tipo: e.target.value as TipoColaborador })}>
              {TIPOS_COLABORADOR.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex gap-2 sm:col-span-3">
            <button
              type="button"
              className={boton}
              disabled={ocupado}
              onClick={async () => {
                const ok = await correr(() => guardarColaborador(borrador.id, borrador), 'Colaborador guardado')
                if (ok) setBorrador(null)
              }}
            >
              {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Guardar
            </button>
            <button type="button" onClick={() => setBorrador(null)} className="h-9 px-2 text-xs text-muted-foreground">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {colaboradores.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-xs text-muted-foreground">Todavía no hay colaboradores de WhatsApp.</p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {colaboradores.map((c) => {
            const vigente = valorVigente(c.valores, hoy)
            const esAbierto = abierto === c.id
            return (
              <li key={c.id} className={`p-3 text-xs ${c.is_active ? '' : 'opacity-60'}`} data-colaborador={c.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1 text-left"
                    onClick={() => {
                      setAbierto(esAbierto ? null : c.id)
                      setValor({ valor: '', vigente_desde: hoy })
                    }}
                    aria-expanded={esAbierto}
                  >
                    {esAbierto ? <ChevronDown className="h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 shrink-0" />}
                    <span className="truncate font-semibold text-foreground">{c.name}</span>
                    <span className="text-muted-foreground">{celularLegible(c.phone)}</span>
                    {!c.is_active && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">Inactivo</span>}
                  </button>
                  <select
                    aria-label={`Tipo de ${c.name}`}
                    className="h-8 rounded-md border bg-background px-2 text-xs"
                    value={c.tipo}
                    disabled={ocupado}
                    onChange={(e) => void correr(() => cambiarTipoColaborador(c.id, e.target.value), 'Tipo cambiado')}
                  >
                    {TIPOS_COLABORADOR.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="tabular-nums text-muted-foreground">{vigente ? `${pesos(vigente.valor)} / jornada` : 'Sin valor de jornada'}</span>
                </div>

                {esAbierto && (
                  <div className="mt-3 space-y-3 border-t pt-3">
                    <div>
                      <p className="mb-1 font-medium text-foreground">Valor de la jornada</p>
                      {c.valores.length === 0 ? (
                        <p className="text-muted-foreground">Sin valores. Mientras no tenga uno, sus llegadas quedan sin valor y no suman a la mano de obra.</p>
                      ) : (
                        <ul className="space-y-1" data-historial-jornada>
                          {c.valores.map((v) => (
                            <li key={v.id} className="flex items-center gap-2">
                              <span className="tabular-nums">{pesos(v.valor)}</span>
                              <span className="text-muted-foreground">desde el {fechaLegible(v.vigente_desde)}</span>
                              {vigente?.id === v.id && <span className="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] text-emerald-700">Vigente</span>}
                              {v.vigente_desde > hoy && <span className="rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-800">Programado</span>}
                              <button
                                type="button"
                                aria-label="Quitar valor"
                                className="ml-auto rounded p-1 hover:bg-accent"
                                disabled={ocupado}
                                onClick={() => void correr(() => borrarValorJornada(v.id), 'Valor quitado')}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                        <label className={etiqueta}>
                          Nuevo valor
                          <input className={campo} type="number" inputMode="numeric" min={1} value={valor.valor} onChange={(e) => setValor({ ...valor, valor: e.target.value })} placeholder="140000" />
                        </label>
                        <label className={etiqueta}>
                          Vale desde
                          <input className={campo} type="date" value={valor.vigente_desde} onChange={(e) => setValor({ ...valor, vigente_desde: e.target.value })} />
                        </label>
                        <button
                          type="button"
                          className={boton}
                          disabled={ocupado}
                          onClick={async () => {
                            const ok = await correr(() => agregarValorJornada(c.id, valor), 'Valor de jornada guardado')
                            if (ok) setValor({ valor: '', vigente_desde: hoy })
                          }}
                        >
                          Agregar
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-muted-foreground">Los días ya marcados conservan el valor con el que se guardaron.</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={boton} onClick={() => setBorrador({ id: c.id, name: c.name, phone: c.phone, tipo: c.tipo })}>
                        <Pencil className="h-3.5 w-3.5" /> Editar
                      </button>
                      <button
                        type="button"
                        className={boton}
                        disabled={ocupado}
                        onClick={() => void correr(() => cambiarActivoColaborador(c.id, !c.is_active), c.is_active ? 'Colaborador desactivado' : 'Colaborador activado')}
                      >
                        {c.is_active ? 'Desactivar' : 'Activar'}
                      </button>
                      <span className="self-center text-[11px] text-muted-foreground">
                        {c.consent_accepted_at ? `Aceptó el aviso de datos el ${fechaLegible(c.consent_accepted_at)}` : 'Todavía no acepta el aviso de datos'}
                      </span>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
