'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Building2, Lightbulb } from 'lucide-react'
import { toast } from 'sonner'
import { CATEGORIAS_GASTO } from '@/lib/pipeline/constants'
import { createGasto, getRubrosProyecto } from './gasto-action'

// Categorías empresa: solo las últimas 4 (arriendo, marketing, capacitación, otros)
const CATEGORIAS_EMPRESA = CATEGORIAS_GASTO.filter(c =>
  ['arriendo', 'marketing', 'capacitacion', 'otros'].includes(c.value)
)

interface Props {
  proyectos: { id: string; nombre: string; tipo: string }[]
}

export default function NuevoGastoForm({ proyectos }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Form state
  const [monto, setMonto] = useState('')
  const [proyectoId, setProyectoId] = useState<string>('empresa')  // 'empresa' = empresa (default), UUID = proyecto
  const [rubroId, setRubroId] = useState('')
  const [categoria, setCategoria] = useState('arriendo')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [descripcion, setDescripcion] = useState('')
  const [deducible, setDeducible] = useState(false)
  const [yaPagado, setYaPagado] = useState(true)

  // Rubros for selected project
  const [rubros, setRubros] = useState<{ id: string; nombre: string }[]>([])
  const [loadingRubros, setLoadingRubros] = useState(false)

  const isEmpresa = proyectoId === 'empresa'
  const isProyecto = proyectoId !== 'empresa'
  const categoriasVisibles = isEmpresa ? CATEGORIAS_EMPRESA : CATEGORIAS_GASTO

  // Fetch rubros when project changes
  useEffect(() => {
    if (isProyecto) {
      setLoadingRubros(true)
      getRubrosProyecto(proyectoId).then(data => {
        setRubros(data)
        setRubroId(data.length === 1 ? data[0].id : '')
        setLoadingRubros(false)
      })
    } else {
      setRubros([])
      setRubroId('')
    }
  }, [proyectoId, isProyecto])

  // Reset categoria when switching to empresa if current isn't in empresa subset
  useEffect(() => {
    if (isEmpresa && !CATEGORIAS_EMPRESA.some(c => c.value === categoria)) {
      setCategoria('arriendo')
    }
  }, [isEmpresa, categoria])

  const handleSubmit = () => {
    const montoNum = parseFloat(monto)
    if (!montoNum || montoNum <= 0) {
      toast.error('Ingresa un monto válido')
      return
    }
    startTransition(async () => {
      const res = await createGasto({
        monto: montoNum,
        categoria,
        fecha,
        descripcion: descripcion.trim() || undefined,
        deducible,
        proyecto_id: proyectoId || null,
        rubro_id: rubroId || null,
        estado_pago: yaPagado ? 'pagado' : 'pendiente',
      })
      if (res.success) {
        toast.success('Gasto registrado')
        router.push('/numeros')
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <Link href="/numeros" className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-lg font-bold">Registrar gasto</h1>
          <p className="text-xs text-muted-foreground">Registro rapido</p>
        </div>
      </div>

      <div className="space-y-4 rounded-lg border p-4">
        {/* Monto */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Monto *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              required
              min="1"
              autoFocus
              placeholder="50000"
              className="w-full rounded-md border bg-background py-2.5 pl-7 pr-3 text-sm"
            />
          </div>
        </div>

        {/* Proyecto / Empresa selector */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Proyecto</label>
          <select
            value={proyectoId}
            onChange={e => setProyectoId(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          >
            <option value="empresa">Gasto de mi empresa</option>
            {proyectos.length > 0 && (
              <optgroup label="Proyectos activos">
                {proyectos.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}{p.tipo === 'interno' ? ' · Interno' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </div>

        {/* Helper text empresa */}
        {isEmpresa && (
          <div className="flex items-start gap-2 rounded-md bg-blue-50 p-3 text-xs text-blue-700 dark:bg-blue-950/20 dark:text-blue-400">
            <Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Este gasto se registrará como costo operativo de tu negocio</span>
          </div>
        )}

        {/* Rubro (only when project selected and has >1 rubro) */}
        {isProyecto && !loadingRubros && rubros.length > 1 && (
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Costo</label>
            <select
              value={rubroId}
              onChange={e => setRubroId(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
            >
              <option value="">Sin costo</option>
              {rubros.map(r => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
          </div>
        )}

        {/* Categoria */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Categoria</label>
          <select
            value={categoria}
            onChange={e => setCategoria(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          >
            {categoriasVisibles.map(c => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Fecha */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Fecha</label>
          <input
            type="date"
            value={fecha}
            onChange={e => setFecha(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        {/* Ya pagado */}
        <div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={yaPagado}
              onChange={e => setYaPagado(e.target.checked)}
              className="rounded border"
            />
            <span className="text-sm">Ya pagado</span>
          </label>
          {!yaPagado && (
            <p className="mt-1 ml-6 text-[11px] text-orange-600 dark:text-orange-400">
              Se registra como cuenta por pagar. Podrás marcarlo como pagado después.
            </p>
          )}
        </div>

        {/* Descripcion */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripcion</label>
          <input
            type="text"
            value={descripcion}
            onChange={e => setDescripcion(e.target.value)}
            placeholder="Describe el gasto"
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          />
        </div>

        {/* Deducible */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={deducible}
              onChange={e => setDeducible(e.target.checked)}
              className="rounded border"
            />
            <span className="text-sm">Deducible de impuestos</span>
          </label>
          {isEmpresa && (
            <span className="inline-flex items-center gap-1 rounded-full bg-yellow-100 px-2 py-0.5 text-[10px] font-medium text-yellow-700 dark:bg-yellow-900/20 dark:text-yellow-400">
              <Lightbulb className="h-3 w-3" />
              Guárdalo — es deducible
            </span>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isPending || !monto}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? 'Registrando...' : 'Registrar gasto'}
        </button>
      </div>
    </div>
  )
}
