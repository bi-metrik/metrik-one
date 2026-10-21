'use client'

import { useRef, useState, useTransition } from 'react'
import { toast } from 'sonner'
import type { Borrador, TipoBorrador } from '@/lib/funciones/extraccion-pdf'
import type { ExperienciaCatalogo } from '@/lib/funciones/datos'
import { extraerPdfAction, guardarExperienciaAction } from './actions'

export type Marca = 'pdf' | 'no_leido'

/** La marca de un campo pre-llenado desde el PDF. Se quita cuando la persona lo toca. */
export function MarcaCampo({ marca }: { marca: Marca | undefined }) {
  if (!marca) return null
  return marca === 'pdf' ? (
    <span className="ml-1 rounded bg-sky-50 px-1 text-[10px] font-medium text-sky-700">leído del PDF</span>
  ) : (
    <span className="ml-1 rounded bg-amber-50 px-1 text-[10px] font-medium text-amber-700">no se pudo leer</span>
  )
}

/** Clase del borde de un campo con marca. */
export const bordeMarca = (m: Marca | undefined) => (m === 'pdf' ? 'border-sky-300 bg-sky-50/40' : m === 'no_leido' ? 'border-amber-300 bg-amber-50/40' : 'border-[#E5E7EB]')

/**
 * Subir un PDF para pre-llenar el formulario. Devuelve un BORRADOR: nada se guarda hasta que la persona confirma
 * con el botón del formulario. El PDF no se guarda.
 */
export function CargarPdf({ tipo, onBorrador }: { tipo: TipoBorrador; onBorrador: (b: Borrador) => void }) {
  const [pendiente, empezar] = useTransition()
  const [avisos, setAvisos] = useState<string[]>([])
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="rounded-lg border border-dashed border-[#E5E7EB] bg-white p-3 text-sm">
      <p className="text-[#6B7280]">
        ¿Tienes {tipo === 'montaje' ? 'el plano del salón' : 'la programación de funciones'} en PDF? Súbelo y ONE pre-llena el formulario. Revisa todo antes de guardar: lo que no se pudo
        leer queda vacío.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <input ref={input} type="file" accept="application/pdf" className="text-xs" disabled={pendiente} />
        <button
          type="button"
          disabled={pendiente}
          onClick={() => {
            const archivo = input.current?.files?.[0]
            if (!archivo) return toast.error('Elige un PDF.')
            const f = new FormData()
            f.set('tipo', tipo)
            f.set('pdf', archivo)
            empezar(async () => {
              const r = await extraerPdfAction(f)
              if (!r.ok) return void toast.error(r.error)
              setAvisos(r.dato!.avisos)
              onBorrador(r.dato!)
              toast.success('Borrador listo: revísalo y guarda.')
            })
          }}
          className="rounded border px-3 py-1 disabled:opacity-50"
        >
          {pendiente ? 'Leyendo…' : 'Leer PDF'}
        </button>
      </div>
      {avisos.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs text-amber-700">
          {avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Alta mínima de una experiencia (nombre y minutos de apartado) dentro del mismo flujo. */
export function AltaExperiencia({ nombreInicial, marca, onCreada }: { nombreInicial?: string; marca?: Marca; onCreada: (e: ExperienciaCatalogo) => void }) {
  const [pendiente, empezar] = useTransition()
  const [nombre, setNombre] = useState(nombreInicial ?? '')
  const [minutos, setMinutos] = useState('')
  const [tocado, setTocado] = useState(false)
  return (
    <div className="space-y-2 rounded-lg border border-[#E5E7EB] bg-white p-3 text-sm">
      <p className="font-medium">Nueva experiencia</p>
      <label className="block">
        <span className="text-xs text-[#6B7280]">
          Nombre
          <MarcaCampo marca={tocado ? undefined : marca} />
        </span>
        <input
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value)
            setTocado(true)
          }}
          className={`mt-0.5 w-full rounded border px-2 py-1 ${bordeMarca(tocado ? undefined : marca)}`}
        />
      </label>
      <label className="block">
        <span className="text-xs text-[#6B7280]">Minutos que dura un apartado sin pago (si aún no se sabe, déjalo vacío: no se podrá apartar)</span>
        <input type="number" min={1} value={minutos} onChange={(e) => setMinutos(e.target.value)} className="mt-0.5 w-32 rounded border px-2 py-1" />
      </label>
      <button
        type="button"
        disabled={pendiente || !nombre.trim()}
        onClick={() =>
          empezar(async () => {
            const m = minutos.trim() ? Number(minutos) : null
            const r = await guardarExperienciaAction({ id: null, nombre, minutos_apartado: m })
            if (!r.ok) return void toast.error(r.error)
            toast.success('Experiencia creada.')
            onCreada({ id: r.dato!, nombre: nombre.trim(), minutos_apartado: m, activa: true })
          })
        }
        className="rounded bg-[#10B981] px-3 py-1 text-white disabled:opacity-50"
      >
        Crear experiencia
      </button>
    </div>
  )
}
