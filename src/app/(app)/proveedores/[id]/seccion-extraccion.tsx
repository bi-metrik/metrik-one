'use client'

import { useRef, useState } from 'react'
import { FileJson, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { NOMBRE_TARIFA_CANAL } from '@/lib/proveedores/tipos'
import { fechaCorta } from '@/lib/proveedores/vigencia'
import { guardarExtraccion, usarSugerenciasDeExtraccion, type ExtraccionVista } from '../actions'

const DECISION: Record<string, string> = {
  usar: 'usados',
  unir: 'unidos',
  complemento: 'complemento',
  descartar_por_reemplazo: 'reemplazados',
  vencido_sin_reemplazo: 'vencidos sin reemplazo',
  excluir_bancario: 'bancarios (excluidos)',
}

const siNo = (v: boolean | null) => (v === true ? 'sí' : v === false ? 'no' : 'no lo dice')

/**
 * «Extracción del motor» (Mauricio, 2026-10-19): el resumen de la última lectura de los
 * tarifarios de este proveedor (esquema 0.2) y lo que el motor dice que hay que pedirle. El JSON lo
 * produce el motor (hoy, desde la torre) y se sube aquí; ONE lo guarda tal cual.
 */
export default function SeccionExtraccion({
  proveedorId,
  extraccion,
  editable,
  onCambio,
}: {
  proveedorId: string
  extraccion: ExtraccionVista | null
  editable: boolean
  onCambio: () => void
}) {
  const entrada = useRef<HTMLInputElement>(null)
  const [ocupado, setOcupado] = useState(false)

  const subir = async (archivo: File) => {
    if (ocupado) return
    setOcupado(true)
    try {
      const texto = await archivo.text()
      const r = await guardarExtraccion(proveedorId, texto, { instruccion: /v\d+/i.exec(archivo.name)?.[0] ?? null })
      if (!r.ok) return void toast.error(r.error)
      toast.success('Extracción guardada')
      onCambio()
    } catch {
      toast.error('No se pudo leer el archivo. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
      if (entrada.current) entrada.current.value = ''
    }
  }

  const usar = async () => {
    if (ocupado) return
    setOcupado(true)
    try {
      const r = await usarSugerenciasDeExtraccion(proveedorId)
      if (!r.ok) return void toast.error(r.error)
      toast.success('Anotado en la ficha')
      onCambio()
    } catch {
      toast.error('No se pudo guardar. Vuelve a intentarlo.')
    } finally {
      setOcupado(false)
    }
  }

  const r = extraccion?.resumen
  const s = extraccion?.sugerencias
  const haySugerencias = !!s && (s.tarifaCanal !== null || s.ivaDeclarado !== null || s.ivaIncluido !== null)
  return (
    <section className="space-y-2" data-seccion="extraccion">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">Extracción del motor</h2>
        {editable && (
          <>
            <button type="button" onClick={() => entrada.current?.click()} disabled={ocupado} className="inline-flex h-8 items-center gap-1 rounded-md border bg-background px-3 text-xs font-medium hover:bg-accent disabled:opacity-50">
              {ocupado ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileJson className="h-3.5 w-3.5" />} Subir extracción (JSON)
            </button>
            <input ref={entrada} type="file" accept="application/json,.json" className="hidden" onChange={(e) => e.target.files?.[0] && void subir(e.target.files[0])} />
          </>
        )}
      </div>
      {!extraccion || !r ? (
        <p className="m-0 text-xs text-muted-foreground">Todavía no hay una extracción de los tarifarios de este proveedor.</p>
      ) : (
        <div className="space-y-2 rounded-lg border p-3 text-xs" data-resumen-extraccion>
          <p className="m-0 text-muted-foreground">
            {fechaCorta(extraccion.creadaAt.slice(0, 10))}
            {extraccion.creadaPor ? ` · ${extraccion.creadaPor}` : ''}
            {extraccion.instruccion ? ` · instrucción ${extraccion.instruccion}` : ''}
            {extraccion.modelo ? ` · ${extraccion.modelo}` : ''}
          </p>
          <p className="m-0">
            {r.tarifas} tarifas en {r.temporadas} temporadas{r.moneda ? ` (${r.moneda})` : ''}
            {r.vigencia.desde || r.vigencia.hasta ? ` · vigencia ${r.vigencia.desde ? fechaCorta(r.vigencia.desde) : '…'} – ${r.vigencia.hasta ? fechaCorta(r.vigencia.hasta) : '…'}` : ''}
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
          {editable && haySugerencias && s && (
            <div className="flex flex-wrap items-center gap-2 border-t pt-2">
              <span className="text-muted-foreground">
                La extracción dice{s.tarifaCanal ? ` tarifa ${NOMBRE_TARIFA_CANAL[s.tarifaCanal].toLowerCase()}` : ''}
                {s.ivaDeclarado ? `, cobra IVA${s.ivaIncluido === true ? ' (incluido en el precio)' : s.ivaIncluido === false ? ' (aparte)' : ''}` : ''}.
              </span>
              <button type="button" onClick={() => void usar()} disabled={ocupado} className="inline-flex h-7 items-center rounded-md border bg-background px-2 font-medium hover:bg-accent disabled:opacity-50">
                Usar en la ficha
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}
