'use client'

import { useRef, useState, useTransition } from 'react'
import { Check, Loader2, Palette, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { updateBranding, uploadLogo } from './actions'

interface Props {
  workspace: any
}

export default function MarcaSection({ workspace }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const fileRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [logoUrl, setLogoUrl] = useState(workspace?.logo_url || '')
  const [colorPrimario, setColorPrimario] = useState(workspace?.color_primario || '#10B981')
  const [colorSecundario, setColorSecundario] = useState(workspace?.color_secundario || '#1A1A1A')

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    const fd = new FormData()
    fd.append('logo', file)
    const res = await uploadLogo(fd)
    if (res.success && res.url) {
      setLogoUrl(res.url)
      toast.success('Logo subido')
    } else {
      toast.error(res.error || 'Error al subir logo')
    }
    setUploading(false)
    if (fileRef.current) fileRef.current.value = ''
  }

  const handleSave = () => {
    startTransition(async () => {
      const res = await updateBranding({
        logo_url: logoUrl.trim() || undefined,
        color_primario: colorPrimario,
        color_secundario: colorSecundario,
      })
      if (res.success) {
        toast.success('Marca actualizada')
        router.refresh()
      } else {
        toast.error(res.error || 'Error')
      }
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="font-semibold">Mi marca</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Personaliza la apariencia de tu app, cotizaciones y reportes. Los colores se aplican al sidebar y elementos de tu interfaz.
        </p>
      </div>

      {/* Logo upload */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">Logo de tu negocio</label>
        <div className="mt-2 flex flex-col gap-3">
          {/* File upload */}
          <div className="flex items-center gap-3">
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              onChange={handleFileUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="flex items-center gap-2 rounded-md border bg-background px-4 py-2 text-sm hover:bg-accent disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {uploading ? 'Subiendo...' : 'Subir imagen'}
            </button>
            <span className="text-[10px] text-muted-foreground">
              PNG, SVG, JPEG o WebP · Max 2MB
            </span>
          </div>
          {/* URL paste fallback */}
          <div>
            <label className="text-[10px] text-muted-foreground">O pega una URL:</label>
            <input
              type="url"
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="https://miempresa.co/logo.png"
            />
          </div>
        </div>
      </div>

      {/* Logo preview */}
      {logoUrl && (
        <div className="flex items-center gap-3 rounded-lg border p-3">
          <img
            src={logoUrl}
            alt="Logo preview"
            className="h-10 w-10 rounded object-contain"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
          />
          <span className="text-xs text-muted-foreground">Vista previa del logo</span>
        </div>
      )}

      {/* Colors */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">Color primario</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={colorPrimario}
              onChange={e => setColorPrimario(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border p-0.5"
            />
            <input
              type="text"
              value={colorPrimario}
              onChange={e => setColorPrimario(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              maxLength={7}
            />
          </div>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Color secundario</label>
          <div className="mt-1 flex items-center gap-2">
            <input
              type="color"
              value={colorSecundario}
              onChange={e => setColorSecundario(e.target.value)}
              className="h-9 w-12 cursor-pointer rounded border p-0.5"
            />
            <input
              type="text"
              value={colorSecundario}
              onChange={e => setColorSecundario(e.target.value)}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
              maxLength={7}
            />
          </div>
        </div>
      </div>

      {/* Preview card */}
      <div className="rounded-lg border p-4">
        <p className="text-xs font-medium text-muted-foreground mb-2">Vista previa</p>
        <div className="flex items-center gap-3 rounded-md p-3" style={{ backgroundColor: colorSecundario }}>
          {logoUrl ? (
            <img src={logoUrl} alt="Logo" className="h-8 w-8 rounded object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded" style={{ backgroundColor: colorPrimario }}>
              <Palette className="h-4 w-4 text-white" />
            </div>
          )}
          <span className="text-sm font-semibold" style={{ color: colorPrimario }}>
            {workspace?.name || 'Mi Negocio'}
          </span>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={isPending}
        className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
        Guardar marca
      </button>
    </div>
  )
}
