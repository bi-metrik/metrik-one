'use client'

import { useState, useTransition } from 'react'
import { Check, Loader2, Palette } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { updateBranding } from './actions'

interface Props {
  workspace: any
}

export default function MarcaSection({ workspace }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  const [logoUrl, setLogoUrl] = useState(workspace?.logo_url || '')
  const [colorPrimario, setColorPrimario] = useState(workspace?.color_primario || '#10B981')
  const [colorSecundario, setColorSecundario] = useState(workspace?.color_secundario || '#1A1A1A')

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

      {/* Logo URL */}
      <div>
        <label className="text-xs font-medium text-muted-foreground">URL del logo</label>
        <input
          type="url"
          value={logoUrl}
          onChange={e => setLogoUrl(e.target.value)}
          className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
          placeholder="https://miempresa.co/logo.png"
        />
        <p className="mt-1 text-[10px] text-muted-foreground">
          Pega la URL de tu logo. Subida de archivos disponible pronto.
        </p>
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
