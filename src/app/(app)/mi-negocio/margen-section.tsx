'use client'

import { useEffect, useState, useTransition } from 'react'
import { Loader2, Lock, Percent, Save } from 'lucide-react'
import { toast } from 'sonner'
import { getMargenPorLinea, guardarUmbralesMargen, type LineaConMargen } from './margen-actions'
import { nombreDelMargen } from '@/lib/cotizaciones/convencion-margen'

/**
 * Los dos umbrales de margen, editables sin pasar por SQL.
 *
 * Se configuran POR LÍNEA de negocio porque ahí vive el dato: la pregunta que
 * responden —«¿a partir de qué margen este trabajo deja de valer la pena?»— es de la
 * línea, no de la empresa.
 *
 * La convención (`markup` / `sobre_venta`) y el margen por defecto se MUESTRAN pero no
 * se editan aquí: cambiarlos mueve el PRECIO de lo que se cotice después, y eso es
 * otra decisión con otras consecuencias. Estos dos solo deciden de qué color sale una
 * cifra en el editor.
 */
export default function MargenSection() {
  const [cargando, setCargando] = useState(true)
  const [puedeEditar, setPuedeEditar] = useState(false)
  const [lineas, setLineas] = useState<LineaConMargen[]>([])

  useEffect(() => {
    getMargenPorLinea().then((res) => {
      setCargando(false)
      if ('error' in res) { toast.error(res.error); return }
      setPuedeEditar(res.puedeEditar)
      setLineas(res.lineas)
    })
  }, [])

  if (cargando) {
    return (
      <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
      </div>
    )
  }

  if (lineas.length === 0) {
    return (
      <p className="p-6 text-sm text-muted-foreground">
        Este negocio todavía no tiene líneas configuradas, así que no hay dónde poner la
        política de margen.
      </p>
    )
  }

  return (
    <div className="space-y-4 p-1">
      <p className="text-xs text-muted-foreground">
        Mientras se arma una cotización, cada línea y el total muestran su margen real.
        Estos dos números deciden cuándo esa cifra se marca. <strong>Ninguno bloquea el
        envío</strong>: una cotización bajo el piso se puede mandar igual, pero nadie
        puede decir que no se enteró.
      </p>

      {lineas.map((linea) => (
        <FilaLinea
          key={linea.id}
          linea={linea}
          puedeEditar={puedeEditar}
          onGuardado={(pisoPct, avisoPct) =>
            setLineas((prev) =>
              prev.map((l) => (l.id === linea.id ? { ...l, pisoPct, avisoPct, sinConfigurar: false } : l)),
            )
          }
        />
      ))}

      {!puedeEditar && (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="h-3 w-3" />
          Solo el dueño o un administrador pueden cambiar estos números.
        </p>
      )}
    </div>
  )
}

function FilaLinea({
  linea,
  puedeEditar,
  onGuardado,
}: {
  linea: LineaConMargen
  puedeEditar: boolean
  onGuardado: (pisoPct: number, avisoPct: number) => void
}) {
  const [piso, setPiso] = useState(String(linea.pisoPct))
  const [aviso, setAviso] = useState(String(linea.avisoPct))
  const [guardando, startGuardar] = useTransition()

  const sucio = Number(piso) !== linea.pisoPct || Number(aviso) !== linea.avisoPct

  const guardar = () =>
    startGuardar(async () => {
      const res = await guardarUmbralesMargen(linea.id, { pisoPct: Number(piso), avisoPct: Number(aviso) })
      if ('error' in res) { toast.error(res.error); return }
      onGuardado(Number(piso), Number(aviso))
      toast.success(`Umbrales de "${linea.nombre}" guardados`)
    })

  return (
    <div className="rounded-lg border p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium">{linea.nombre}</span>
        {/* La convención se muestra porque cambia lo que SIGNIFICA el margen que se
            escribe en la cotización, y sin ella estos dos números se leen contra la
            cifra equivocada. No se edita aquí: eso mueve precios. */}
        <span className="text-[10px] text-muted-foreground">
          {nombreDelMargen(linea.convencion)} · nace en {linea.defaultPct}%
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <CampoPct
          etiqueta="Piso (rojo)"
          ayuda="Bajo este margen el viaje se marca en rojo."
          valor={piso}
          onChange={setPiso}
          disabled={!puedeEditar || guardando}
        />
        <CampoPct
          etiqueta="Aviso (ámbar)"
          ayuda="Bajo este margen se avisa, sin bloquear."
          valor={aviso}
          onChange={setAviso}
          disabled={!puedeEditar || guardando}
        />
      </div>

      {linea.sinConfigurar && (
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Esta línea todavía no declara nada: rigen los valores por defecto del producto.
        </p>
      )}

      {/* Un piso por encima del aviso no es un error que haya que corregir: deja la
          banda ámbar vacía. Se dice, para que nadie lo descubra mirando colores. */}
      {Number(piso) >= Number(aviso) && (
        <p className="mt-1.5 text-[10px] text-amber-600">
          Con el piso en {piso}% y el aviso en {aviso}%, no queda banda ámbar: todo lo
          que no llegue al piso sale en rojo.
        </p>
      )}

      {puedeEditar && (
        <button
          type="button"
          onClick={guardar}
          disabled={!sucio || guardando}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
        >
          {guardando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Guardar
        </button>
      )}
    </div>
  )
}

function CampoPct({
  etiqueta,
  ayuda,
  valor,
  onChange,
  disabled,
}: {
  etiqueta: string
  ayuda: string
  valor: string
  onChange: (v: string) => void
  disabled: boolean
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">{etiqueta}</label>
      <div className="relative">
        <input
          type="number"
          min="0"
          max="99.99"
          step="0.1"
          value={valor}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border bg-background py-1.5 pl-2 pr-6 text-sm tabular-nums disabled:opacity-60"
        />
        <Percent className="absolute right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">{ayuda}</p>
    </div>
  )
}
