'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { ExperienciaCatalogo, MontajeCatalogo } from '@/lib/funciones/datos'
import type { Borrador } from '@/lib/funciones/extraccion-pdf'
import { posicionPorDefecto } from '@/lib/funciones/reglas'
import { guardarMontajeAction } from '../actions'
import { AltaExperiencia, bordeMarca, CargarPdf, MarcaCampo, type Marca } from '../formulario-comun'

type CampoMesa = 'etiqueta' | 'puestos' | 'zona' | 'condicion'

interface Fila {
  clave: string
  id?: string
  etiqueta: string
  puestos: string
  zona: string
  condicion: string
  x: number
  y: number
  ancho: number
  alto: number
  forma: 'redonda' | 'rectangular'
  marcas: Partial<Record<CampoMesa, Marca>>
}

let siguiente = 0
const nuevaClave = () => `f${++siguiente}`

function filaVacia(i: number, n: number): Fila {
  const { x, y } = posicionPorDefecto(i, n)
  return { clave: nuevaClave(), etiqueta: '', puestos: '', zona: '', condicion: '', x, y, ancho: 10, alto: 10, forma: 'rectangular', marcas: {} }
}

/**
 * Formulario de montaje (§4.3): experiencia, nombre y la tabla de mesas con etiqueta, puestos, zona, condición
 * informativa (sin precio) y posición, con la vista previa del mapa y la suma de puestos. Un PDF del plano lo
 * pre-llena como borrador; lo que se guarda es lo que la persona confirma con «Guardar montaje».
 */
export function FormularioMontaje({ experiencias: iniciales, montaje }: { experiencias: ExperienciaCatalogo[]; montaje: MontajeCatalogo | null }) {
  const router = useRouter()
  const [pendiente, empezar] = useTransition()
  const [experiencias, setExperiencias] = useState(iniciales)
  const [experienciaId, setExperienciaId] = useState(montaje?.experiencia_id ?? iniciales[0]?.id ?? '')
  const [nombre, setNombre] = useState(montaje?.nombre ?? '')
  const [marcaNombre, setMarcaNombre] = useState<Marca | undefined>()
  const [notas, setNotas] = useState(montaje?.notas ?? '')
  const [altaAbierta, setAltaAbierta] = useState(iniciales.length === 0)
  const [filas, setFilas] = useState<Fila[]>(() =>
    montaje
      ? montaje.mesas.map((m) => ({
          clave: nuevaClave(),
          id: m.id,
          etiqueta: m.etiqueta,
          puestos: String(m.puestos),
          zona: m.zona ?? '',
          condicion: m.condicion ?? '',
          x: m.x,
          y: m.y,
          ancho: m.ancho,
          alto: m.alto,
          forma: m.forma,
          marcas: {},
        }))
      : [filaVacia(0, 1)],
  )

  const suma = filas.reduce((s, f) => s + (Number(f.puestos) || 0), 0)
  const cambiar = (clave: string, cambio: Partial<Fila>, campo?: CampoMesa) =>
    setFilas((fs) => fs.map((f) => (f.clave === clave ? { ...f, ...cambio, marcas: campo ? { ...f.marcas, [campo]: undefined } : f.marcas } : f)))

  const aplicarBorrador = (b: Borrador) => {
    if (b.tipo !== 'montaje') return
    if (b.nombre.origen === 'pdf' && b.nombre.valor) {
      setNombre(b.nombre.valor)
      setMarcaNombre('pdf')
    } else if (!nombre) setMarcaNombre('no_leido')
    if (b.mesas.length === 0) return
    // El borrador REEMPLAZA las filas nuevas; las mesas que ya existen (edición) se conservan.
    const existentes = filas.filter((f) => f.id)
    const n = existentes.length + b.mesas.length
    const nuevas = b.mesas.map((m, i): Fila => {
      const { x, y } = posicionPorDefecto(existentes.length + i, n)
      return {
        clave: nuevaClave(),
        etiqueta: m.etiqueta.valor ?? '',
        puestos: m.puestos.valor != null ? String(m.puestos.valor) : '',
        zona: m.zona.valor ?? '',
        condicion: m.condicion.valor ?? '',
        x,
        y,
        ancho: 10,
        alto: 10,
        forma: 'rectangular',
        marcas: { etiqueta: m.etiqueta.origen, puestos: m.puestos.origen, zona: m.zona.origen, condicion: m.condicion.origen },
      }
    })
    setFilas([...existentes, ...nuevas])
  }

  const faltan = filas.filter((f) => !f.etiqueta.trim() || !(Number(f.puestos) >= 1))
  const guardar = () =>
    empezar(async () => {
      if (!experienciaId) return void toast.error('Elige la experiencia.')
      if (faltan.length > 0) return void toast.error('Cada mesa necesita etiqueta y puestos (1 o más).')
      const r = await guardarMontajeAction({
        id: montaje?.id ?? null,
        experiencia_id: experienciaId,
        nombre,
        notas,
        mesas: filas.map((f) => ({
          id: f.id,
          etiqueta: f.etiqueta.trim(),
          puestos: Number(f.puestos),
          zona: f.zona,
          condicion: f.condicion,
          x: f.x,
          y: f.y,
          ancho: f.ancho,
          alto: f.alto,
          forma: f.forma,
        })),
      })
      if (!r.ok) return void toast.error(r.error)
      toast.success('Montaje guardado.')
      router.push('/funciones/montajes')
      router.refresh()
    })

  const celda = (f: Fila, campo: CampoMesa, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div>
      <input
        value={f[campo]}
        onChange={(e) => cambiar(f.clave, { [campo]: e.target.value } as Partial<Fila>, campo)}
        className={`w-full rounded border px-1.5 py-1 ${bordeMarca(f.marcas[campo])}`}
        {...props}
      />
      <MarcaCampo marca={f.marcas[campo]} />
    </div>
  )

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4 md:p-6">
      <h1 className="text-xl font-semibold text-[#1A1A1A]">{montaje ? `Editar montaje: ${montaje.nombre}` : 'Nuevo montaje'}</h1>
      <CargarPdf tipo="montaje" onBorrador={aplicarBorrador} />

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="text-xs text-[#6B7280]">Experiencia</span>
            <div className="flex gap-2">
              <select value={experienciaId} onChange={(e) => setExperienciaId(e.target.value)} className="mt-0.5 flex-1 rounded border border-[#E5E7EB] px-2 py-1">
                {experiencias.length === 0 && <option value="">(crea una primero)</option>}
                {experiencias.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.nombre}
                  </option>
                ))}
              </select>
              <button type="button" onClick={() => setAltaAbierta((a) => !a)} className="rounded border px-2 text-xs">
                + Nueva
              </button>
            </div>
          </label>
          {altaAbierta && (
            <AltaExperiencia
              onCreada={(e) => {
                setExperiencias((xs) => [...xs, e])
                setExperienciaId(e.id)
                setAltaAbierta(false)
              }}
            />
          )}
          <label className="block">
            <span className="text-xs text-[#6B7280]">
              Nombre del montaje <MarcaCampo marca={marcaNombre} />
            </span>
            <input
              value={nombre}
              onChange={(e) => {
                setNombre(e.target.value)
                setMarcaNombre(undefined)
              }}
              className={`mt-0.5 w-full rounded border px-2 py-1 ${bordeMarca(marcaNombre)}`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-[#6B7280]">Notas</span>
            <textarea value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-[#E5E7EB] px-2 py-1" />
          </label>
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-[#6B7280]">
            <span>Vista previa</span>
            <span>
              {filas.length} mesas · <strong className="text-[#1A1A1A]">{suma} puestos</strong>
            </span>
          </div>
          <div className="relative overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#FAFAFA]" style={{ aspectRatio: '16 / 10' }}>
            {filas.map((f) => (
              <div
                key={f.clave}
                className={`absolute flex items-center justify-center border border-[#E5E7EB] bg-white text-[10px] ${f.forma === 'redonda' ? 'rounded-full' : 'rounded-md'}`}
                style={{ left: `${f.x}%`, top: `${f.y}%`, width: `${f.ancho}%`, height: `${f.alto * 1.6}%` }}
              >
                {f.etiqueta || '?'} · {f.puestos || '?'}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[#E5E7EB] bg-white">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-[#6B7280]">
            <tr>
              <th className="px-2 py-2">Etiqueta</th>
              <th className="px-2 py-2">Puestos</th>
              <th className="px-2 py-2">Zona</th>
              <th className="px-2 py-2">Condición (informativa, sin precio)</th>
              <th className="px-2 py-2">X</th>
              <th className="px-2 py-2">Y</th>
              <th className="px-2 py-2">Forma</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave} className="align-top">
                <td className="w-24 px-2 py-1">{celda(f, 'etiqueta')}</td>
                <td className="w-20 px-2 py-1">{celda(f, 'puestos', { type: 'number', min: 1 })}</td>
                <td className="w-32 px-2 py-1">{celda(f, 'zona')}</td>
                <td className="px-2 py-1">{celda(f, 'condicion')}</td>
                {(['x', 'y'] as const).map((k) => (
                  <td key={k} className="w-16 px-2 py-1">
                    <input type="number" min={0} max={100} value={f[k]} onChange={(e) => cambiar(f.clave, { [k]: Number(e.target.value) })} className="w-full rounded border border-[#E5E7EB] px-1 py-1" />
                  </td>
                ))}
                <td className="w-28 px-2 py-1">
                  <select value={f.forma} onChange={(e) => cambiar(f.clave, { forma: e.target.value as Fila['forma'] })} className="rounded border border-[#E5E7EB] px-1 py-1">
                    <option value="rectangular">Rectangular</option>
                    <option value="redonda">Redonda</option>
                  </select>
                </td>
                <td className="px-2 py-1">
                  <button type="button" onClick={() => setFilas((fs) => fs.filter((x) => x.clave !== f.clave))} className="text-xs text-[#6B7280] hover:text-red-600" aria-label="Quitar mesa">
                    Quitar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => setFilas((fs) => [...fs, filaVacia(fs.length, fs.length + 1)])} className="m-2 rounded border px-3 py-1 text-xs">
          + Mesa
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" disabled={pendiente} onClick={guardar} className="rounded-md bg-[#10B981] px-4 py-2 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50">
          {pendiente ? 'Guardando…' : 'Guardar montaje'}
        </button>
        {faltan.length > 0 && <span className="text-xs text-amber-700">{faltan.length} mesa(s) sin etiqueta o sin puestos.</span>}
      </div>
    </div>
  )
}
