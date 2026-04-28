'use client'

import { useState, useEffect, useTransition, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Building2, Paperclip, X, FileText, Image as ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { CATEGORIAS_GASTO } from '@/lib/pipeline/constants'
import { createGasto, getRubrosProyecto, uploadSoporteGasto } from './gasto-action'
import { FiscalDisclaimer } from '@/components/fiscal-disclaimer'

type Clasificacion = 'variable' | 'fijo' | 'no_operativo'

// Mapping categoria → clasificacion default. Mismo seed que migration 20260427100001
const CATEGORIA_TO_CLASIF: Record<string, Clasificacion> = {
  comision: 'variable',
  materiales: 'variable',
  transporte: 'variable',
  viaticos: 'variable',
  mano_de_obra: 'variable',
  alimentacion: 'variable',
  servicios_profesionales: 'fijo',
  software: 'fijo',
  impuestos_seguros: 'fijo',
  arriendo: 'fijo',
  marketing: 'fijo',
  capacitacion: 'fijo',
  otros: 'variable',
}

// Categorías empresa: costos operativos del negocio
const CATEGORIAS_EMPRESA = CATEGORIAS_GASTO.filter(c =>
  ['arriendo', 'marketing', 'capacitacion', 'otros'].includes(c.value)
)

// Categorías proyecto/negocio: todas excepto las exclusivas de empresa
const CATEGORIAS_DESTINO = CATEGORIAS_GASTO.filter(c =>
  !['arriendo', 'marketing', 'capacitacion', 'otros'].includes(c.value)
)

// Mapping categoría → tipos de rubro compatibles (para auto-asignación)
const CAT_TO_RUBRO_TIPOS: Record<string, string[]> = {
  materiales:               ['materiales'],
  transporte:               ['viaticos'],
  alimentacion:             ['viaticos'],
  software:                 ['software'],
  servicios_profesionales:  ['servicios_prof', 'mo_terceros'],
  mano_de_obra:             ['mo_propia', 'mo_terceros'],
}

interface Props {
  destinos: {
    negocios: { id: string; nombre: string; codigo: string }[]
    proyectos: { id: string; nombre: string; tipo: string; codigo: string }[]
  }
  defaultNegocioId?: string
  defaultProyectoId?: string
}

export default function NuevoGastoForm({ destinos, defaultNegocioId, defaultProyectoId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Determine default selection
  const getDefaultDestino = () => {
    if (defaultNegocioId && destinos.negocios.some(n => n.id === defaultNegocioId)) return `negocio:${defaultNegocioId}`
    if (defaultProyectoId && destinos.proyectos.some(p => p.id === defaultProyectoId)) return `proyecto:${defaultProyectoId}`
    return 'empresa'
  }

  // Form state
  const [monto, setMonto] = useState('')
  const [destinoKey, setDestinoKey] = useState<string>(getDefaultDestino())
  const [rubroId, setRubroId] = useState('')
  const [categoria, setCategoria] = useState('arriendo')
  const [clasificacion, setClasificacion] = useState<Clasificacion>(CATEGORIA_TO_CLASIF['arriendo'] ?? 'fijo')
  const [retencion, setRetencion] = useState('')
  const [fecha, setFecha] = useState(new Date().toISOString().split('T')[0])
  const [descripcion, setDescripcion] = useState('')
  const [yaPagado, setYaPagado] = useState(true)
  const [soporteFile, setSoporteFile] = useState<File | null>(null)
  const [soportePreview, setSoportePreview] = useState<string | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Rubros for selected project
  const [rubros, setRubros] = useState<{ id: string; nombre: string; tipo: string | null }[]>([])

  const isEmpresa = destinoKey === 'empresa'
  const isNegocio = destinoKey.startsWith('negocio:')
  const isProyecto = destinoKey.startsWith('proyecto:')
  const destinoId = isNegocio ? destinoKey.slice(8) : isProyecto ? destinoKey.slice(9) : null

  const categoriasVisibles = isEmpresa ? CATEGORIAS_EMPRESA : CATEGORIAS_DESTINO

  // Fetch rubros al cambiar proyecto (solo para proyectos, negocios no tienen rubros propios)
  useEffect(() => {
    if (isProyecto && destinoId) {
      getRubrosProyecto(destinoId).then(data => {
        setRubros(data)
      })
    } else {
      setRubros([])
      setRubroId('')
    }
  }, [destinoKey, isProyecto, destinoId])

  // Reset categoría al cambiar entre empresa/destino
  useEffect(() => {
    if (!categoriasVisibles.some(c => c.value === categoria)) {
      setCategoria(categoriasVisibles[0]?.value ?? 'otros')
    }
  }, [isEmpresa, categoriasVisibles, categoria])

  // Auto-aplicar clasificacion default al cambiar categoria (overridable por usuario despues)
  useEffect(() => {
    setClasificacion(CATEGORIA_TO_CLASIF[categoria] ?? 'variable')
  }, [categoria])

  // Auto-asignar rubro según categoría seleccionada
  useEffect(() => {
    if (!isProyecto || rubros.length === 0) { setRubroId(''); return }
    const tiposCompatibles = CAT_TO_RUBRO_TIPOS[categoria] ?? []
    const match = rubros.find(r => r.tipo && tiposCompatibles.includes(r.tipo))
    setRubroId(match?.id ?? '')
  }, [categoria, rubros, isProyecto])

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
        clasificacion_costo: clasificacion,
        retencion: parseFloat(retencion) || 0,
        fecha,
        descripcion: descripcion.trim() || undefined,
        destino_id: destinoId || 'empresa',
        destino_tipo: isNegocio ? 'negocio' : isProyecto ? 'proyecto' : 'empresa',
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

  const hasNegocios = destinos.negocios.length > 0
  const hasProyectos = destinos.proyectos.length > 0

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-6">
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground">
          <ArrowLeft className="h-5 w-5" />
        </button>
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

        {/* Destino selector: negocios + proyectos + empresa */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Destino</label>
          <select
            value={destinoKey}
            onChange={e => setDestinoKey(e.target.value)}
            className="w-full rounded-md border bg-background px-3 py-2.5 text-sm"
          >
            <option value="empresa">Gasto de mi empresa</option>
            {hasNegocios && (
              <optgroup label="Negocios activos">
                {destinos.negocios.map(n => (
                  <option key={n.id} value={`negocio:${n.id}`}>
                    {n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre}
                  </option>
                ))}
              </optgroup>
            )}
            {hasProyectos && (
              <optgroup label="Proyectos activos">
                {destinos.proyectos.map(p => (
                  <option key={p.id} value={`proyecto:${p.id}`}>
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

        {/* Clasificacion costo — toggle 3-way (decision Carmen+Santiago 2026-04-26) */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Este gasto desaparece si no hay ventas?
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {([
              { value: 'variable', label: 'Si', sub: 'Variable' },
              { value: 'fijo', label: 'No', sub: 'Fijo' },
              { value: 'no_operativo', label: 'No aplica', sub: 'No operativo' },
            ] as Array<{ value: Clasificacion; label: string; sub: string }>).map(opt => {
              const active = clasificacion === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setClasificacion(opt.value)}
                  className={`rounded-md border px-2 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'border-[#10B981] bg-[#10B981]/10 text-[#059669]'
                      : 'border-[#E5E7EB] bg-background text-[#6B7280] hover:border-[#10B981]/50'
                  }`}
                >
                  <div className="leading-tight">{opt.label}</div>
                  <div className="mt-0.5 text-[10px] opacity-70">{opt.sub}</div>
                </button>
              )
            })}
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Variable: cambia con tus ventas (materiales, comisiones). Fijo: igual cada mes (arriendo, salarios). No operativo: impuesto renta, intereses.
          </p>
        </div>

        {/* Retencion — campo simple para reportes contador */}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">
            Retencion <span className="text-[10px] font-normal opacity-70">(opcional)</span>
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
            <input
              type="number"
              value={retencion}
              onChange={e => setRetencion(e.target.value)}
              min="0"
              placeholder="0"
              className="w-full rounded-md border bg-background py-2.5 pl-7 pr-3 text-sm"
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">
            Suma plana. Si tu contador necesita el detalle, lo registra desde su flujo.
          </p>
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
                <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
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

      <FiscalDisclaimer />
    </div>
  )
}
