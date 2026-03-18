'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Building2, Paperclip, X, FileText, Image } from 'lucide-react'
import { toast } from 'sonner'
import { CATEGORIAS_GASTO } from '@/lib/pipeline/constants'
import { createGasto, getRubrosProyecto, uploadSoporteGasto } from './gasto-action'

// Categorías empresa: solo las últimas 4 (arriendo, marketing, capacitación, otros)
const CATEGORIAS_EMPRESA = CATEGORIAS_GASTO.filter(c =>
  ['arriendo', 'marketing', 'capacitacion', 'otros'].includes(c.value)
)

// Mapping from rubro tipo (cotización) to allowed expense categories
const RUBRO_TO_CATEGORIAS: Record<string, string[]> = {
  mo_propia: ['servicios_profesionales'],
  mo_terceros: ['servicios_profesionales'],
  materiales: ['materiales'],
  viaticos: ['transporte', 'alimentacion'],
  software: ['software'],
  servicios_prof: ['servicios_profesionales'],
}

interface Props {
  proyectos: { id: string; nombre: string; tipo: string; codigo: string }[]
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
  const [yaPagado, setYaPagado] = useState(true)
  const [soporteFile, setSoporteFile] = useState<File | null>(null)
  const [soportePreview, setSoportePreview] = useState<string | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Rubros for selected project
  const [rubros, setRubros] = useState<{ id: string; nombre: string; tipo: string | null }[]>([])
  const [loadingRubros, setLoadingRubros] = useState(false)

  const isEmpresa = proyectoId === 'empresa'
  const isProyecto = proyectoId !== 'empresa'

  // When project is selected, filter categories to only those matching the project's rubro types
  const categoriasVisibles = (() => {
    if (isEmpresa) return CATEGORIAS_EMPRESA
    if (rubros.length === 0) return CATEGORIAS_GASTO
    // Collect only categories that map from the project's rubros
    const allowedCats = new Set<string>()
    for (const rubro of rubros) {
      const cats = rubro.tipo ? RUBRO_TO_CATEGORIAS[rubro.tipo] : null
      if (cats) {
        cats.forEach(c => allowedCats.add(c))
      }
    }
    if (allowedCats.size === 0) return CATEGORIAS_GASTO
    return CATEGORIAS_GASTO.filter(c => allowedCats.has(c.value))
  })()

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

  // Reset categoria when available categories change and current isn't in the list
  useEffect(() => {
    if (!categoriasVisibles.some(c => c.value === categoria)) {
      setCategoria(categoriasVisibles[0]?.value ?? 'otros')
    }
  }, [categoriasVisibles, categoria])

  const compressImage = async (file: File, maxWidth = 1600, quality = 0.8): Promise<File> => {
    if (file.type === 'application/pdf') return file
    if (file.size <= 500 * 1024) return file
    return new Promise((resolve) => {
      const img = document.createElement('img')
      img.onload = () => {
        const scale = Math.min(1, maxWidth / Math.max(img.width, img.height))
        const w = Math.round(img.width * scale)
        const h = Math.round(img.height * scale)
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            if (blob && blob.size < file.size) {
              resolve(new File([blob], file.name.replace(/\.\w+$/, '.jpg'), { type: 'image/jpeg' }))
            } else {
              resolve(file)
            }
          },
          'image/jpeg',
          quality,
        )
      }
      img.onerror = () => resolve(file)
      img.src = URL.createObjectURL(file)
    })
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 20 * 1024 * 1024) {
      toast.error('El archivo supera 20MB')
      return
    }
    const compressed = await compressImage(file)
    setSoporteFile(compressed)
    if (compressed.type.startsWith('image/')) {
      setSoportePreview(URL.createObjectURL(compressed))
    } else {
      setSoportePreview(null)
    }
  }

  const clearSoporte = () => {
    setSoporteFile(null)
    if (soportePreview) URL.revokeObjectURL(soportePreview)
    setSoportePreview(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = () => {
    const montoNum = parseFloat(monto)
    if (!montoNum || montoNum <= 0) {
      toast.error('Ingresa un monto válido')
      return
    }
    startTransition(async () => {
      let soporteUrl: string | null = null

      // Upload soporte if provided
      if (soporteFile) {
        setUploadingFile(true)
        const fd = new FormData()
        fd.append('file', soporteFile)
        const uploadRes = await uploadSoporteGasto(fd)
        setUploadingFile(false)
        if (!uploadRes.success) {
          toast.error(uploadRes.error)
          return
        }
        soporteUrl = uploadRes.url
      }

      const res = await createGasto({
        monto: montoNum,
        categoria,
        fecha,
        descripcion: descripcion.trim() || undefined,
        proyecto_id: proyectoId || null,
        rubro_id: rubroId || null,
        estado_pago: yaPagado ? 'pagado' : 'pendiente',
        soporte_url: soporteUrl,
      })
      if (res.success) {
        toast.success('Gasto registrado')
        router.back()
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
                    {p.codigo} — {p.nombre}{p.tipo === 'interno' ? ' · Interno' : ''}
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

        {/* Soporte */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Soporte (factura/recibo)</label>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={handleFileChange}
            className="hidden"
          />
          {soporteFile ? (
            <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
              {soportePreview ? (
                <Image className="h-4 w-4 text-blue-500 shrink-0" />
              ) : (
                <FileText className="h-4 w-4 text-blue-500 shrink-0" />
              )}
              <span className="flex-1 truncate text-sm">{soporteFile.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {(soporteFile.size / 1024).toFixed(0)} KB
              </span>
              <button
                type="button"
                onClick={clearSoporte}
                className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex w-full items-center gap-2 rounded-md border border-dashed bg-background px-3 py-2.5 text-sm text-muted-foreground hover:border-primary hover:text-foreground transition-colors"
            >
              <Paperclip className="h-4 w-4" />
              Adjuntar foto o PDF
            </button>
          )}
        </div>

        <button
          onClick={handleSubmit}
          disabled={isPending || !monto}
          className="w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? (uploadingFile ? 'Subiendo soporte...' : 'Registrando...') : 'Registrar gasto'}
        </button>
      </div>
    </div>
  )
}
