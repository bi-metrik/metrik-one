'use client'

import { useEffect, useState, useTransition } from 'react'
import { ArrowDown, ArrowUp, Loader2, Lock, Plus, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { getTerminosPropuesta, guardarTerminosPropuesta } from './terminos-actions'
import type { ClausulaTerminos } from '@/lib/propuesta/terminos'

// Editor de los terminos y condiciones que salen impresos en la propuesta.
// El texto se escribe PLANO: la unica marca es `**negrita**`, porque las
// clausulas resaltan en negrita las exclusiones de responsabilidad y hay que
// poder conservarlas sin abrirle la puerta a HTML dentro del PDF.

const AYUDA_NEGRITA = 'Encierra en **dobles asteriscos** lo que deba ir en negrita.'

export default function TerminosSection() {
  const [cargando, setCargando] = useState(true)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [sinConfigurar, setSinConfigurar] = useState(false)
  const [version, setVersion] = useState(0)
  const [clausulas, setClausulas] = useState<ClausulaTerminos[]>([])
  const [cierre, setCierre] = useState('')
  const [sucio, setSucio] = useState(false)
  const [guardando, startGuardar] = useTransition()

  useEffect(() => {
    getTerminosPropuesta().then((res) => {
      setCargando(false)
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setPuedeEditar(res.puedeEditar)
      setSinConfigurar(res.sinConfigurar)
      setVersion(res.terminos.version)
      setClausulas(res.terminos.clausulas)
      setCierre(res.terminos.cierre)
    })
  }, [])

  const editar = (fn: (prev: ClausulaTerminos[]) => ClausulaTerminos[]) => {
    setClausulas(fn)
    setSucio(true)
  }

  const mover = (i: number, delta: number) =>
    editar((prev) => {
      const destino = i + delta
      if (destino < 0 || destino >= prev.length) return prev
      const copia = [...prev]
      ;[copia[i], copia[destino]] = [copia[destino], copia[i]]
      return copia
    })

  const guardar = () =>
    startGuardar(async () => {
      const res = await guardarTerminosPropuesta({ clausulas, cierre })
      if ('error' in res) {
        toast.error(res.error)
        return
      }
      setVersion(res.version)
      setSinConfigurar(false)
      setSucio(false)
      toast.success(`Términos guardados (versión ${res.version})`)
    })

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando términos…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
        {puedeEditar ? (
          <>
            Este es el texto que sale impreso al final de cada propuesta. {AYUDA_NEGRITA} La
            numeración se calcula sola: si mueves una cláusula, se renumera todo, incluidas las
            sub-cláusulas.
          </>
        ) : (
          <span className="flex items-center gap-1.5">
            <Lock className="h-3.5 w-3.5" />
            Solo el dueño o el administrador del workspace pueden editar los términos.
          </span>
        )}
        {sinConfigurar ? (
          <p className="mt-1.5 font-medium text-amber-700 dark:text-amber-400">
            Todavía no hay términos propios guardados: las propuestas salen con el texto por
            defecto del documento.
          </p>
        ) : (
          <p className="mt-1.5">Versión guardada: {version}.</p>
        )}
      </div>

      <div className="space-y-3">
        {clausulas.map((clausula, i) => (
          <div key={i} className="rounded-xl border bg-card p-4">
            <div className="flex items-start gap-3">
              <span className="mt-2 w-6 shrink-0 text-sm font-semibold text-muted-foreground">
                {i + 1}.
              </span>
              <input
                value={clausula.titulo}
                disabled={!puedeEditar}
                placeholder="Título de la cláusula"
                onChange={(e) =>
                  editar((prev) =>
                    prev.map((c, j) => (j === i ? { ...c, titulo: e.target.value } : c)),
                  )
                }
                className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm font-medium disabled:opacity-70"
              />
              {puedeEditar && (
                <div className="flex shrink-0 items-center gap-1">
                  <IconBtn label="Subir" onClick={() => mover(i, -1)} disabled={i === 0}>
                    <ArrowUp className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Bajar"
                    onClick={() => mover(i, 1)}
                    disabled={i === clausulas.length - 1}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </IconBtn>
                  <IconBtn
                    label="Eliminar cláusula"
                    onClick={() => editar((prev) => prev.filter((_, j) => j !== i))}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-destructive" />
                  </IconBtn>
                </div>
              )}
            </div>

            <div className="mt-3 space-y-2 pl-9">
              {clausula.parrafos.map((parrafo, k) => {
                const subNumero =
                  clausula.parrafos.slice(0, k + 1).filter((p) => p.subtitulo !== undefined).length
                return (
                  <div key={k} className="space-y-1.5">
                    {parrafo.subtitulo !== undefined && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-muted-foreground">
                          {i + 1}.{subNumero}
                        </span>
                        <input
                          value={parrafo.subtitulo}
                          disabled={!puedeEditar}
                          placeholder="Título de la sub-cláusula"
                          onChange={(e) =>
                            editar((prev) =>
                              prev.map((c, j) =>
                                j === i
                                  ? {
                                      ...c,
                                      parrafos: c.parrafos.map((p, m) =>
                                        m === k ? { ...p, subtitulo: e.target.value } : p,
                                      ),
                                    }
                                  : c,
                              ),
                            )
                          }
                          className="flex-1 rounded-md border bg-background px-2 py-1 text-xs font-medium disabled:opacity-70"
                        />
                      </div>
                    )}
                    <div className="flex items-start gap-2">
                      <textarea
                        value={parrafo.texto}
                        disabled={!puedeEditar}
                        rows={3}
                        placeholder="Texto del párrafo"
                        onChange={(e) =>
                          editar((prev) =>
                            prev.map((c, j) =>
                              j === i
                                ? {
                                    ...c,
                                    parrafos: c.parrafos.map((p, m) =>
                                      m === k ? { ...p, texto: e.target.value } : p,
                                    ),
                                  }
                                : c,
                            ),
                          )
                        }
                        className="flex-1 rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed disabled:opacity-70"
                      />
                      {puedeEditar && clausula.parrafos.length > 1 && (
                        <IconBtn
                          label="Eliminar párrafo"
                          onClick={() =>
                            editar((prev) =>
                              prev.map((c, j) =>
                                j === i
                                  ? { ...c, parrafos: c.parrafos.filter((_, m) => m !== k) }
                                  : c,
                              ),
                            )
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                        </IconBtn>
                      )}
                    </div>
                  </div>
                )
              })}

              {puedeEditar && (
                <div className="flex gap-3 pt-1">
                  <TextBtn
                    onClick={() =>
                      editar((prev) =>
                        prev.map((c, j) =>
                          j === i ? { ...c, parrafos: [...c.parrafos, { texto: '' }] } : c,
                        ),
                      )
                    }
                  >
                    + Párrafo
                  </TextBtn>
                  <TextBtn
                    onClick={() =>
                      editar((prev) =>
                        prev.map((c, j) =>
                          j === i
                            ? { ...c, parrafos: [...c.parrafos, { subtitulo: '', texto: '' }] }
                            : c,
                        ),
                      )
                    }
                  >
                    + Sub-cláusula
                  </TextBtn>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {puedeEditar && (
        <button
          onClick={() => editar((prev) => [...prev, { titulo: '', parrafos: [{ texto: '' }] }])}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm text-muted-foreground hover:bg-accent/50"
        >
          <Plus className="h-4 w-4" /> Agregar cláusula
        </button>
      )}

      <div className="rounded-xl border bg-card p-4">
        <p className="text-sm font-medium">Párrafo de aceptación</p>
        <p className="mb-2 text-xs text-muted-foreground">
          Va sobre las firmas, al cerrar el documento.
        </p>
        <textarea
          value={cierre}
          disabled={!puedeEditar}
          rows={4}
          onChange={(e) => {
            setCierre(e.target.value)
            setSucio(true)
          }}
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm leading-relaxed disabled:opacity-70"
        />
      </div>

      {puedeEditar && (
        <div className="flex items-center justify-end gap-3">
          {sucio && <span className="text-xs text-amber-600">Cambios sin guardar</span>}
          <button
            onClick={guardar}
            disabled={guardando || !sucio}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {guardando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar términos
          </button>
        </div>
      )}
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border p-1.5 hover:bg-accent disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function TextBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-xs text-primary hover:underline">
      {children}
    </button>
  )
}
