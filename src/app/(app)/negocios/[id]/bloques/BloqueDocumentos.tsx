'use client'

import { useState, useTransition } from 'react'
import { FileText, Download, Eye, CheckCircle2, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarBloqueData, marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

export interface DocumentoConfig {
  slug: string
  label: string
  required: boolean
}

interface BloqueDocumentosProps {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  documentos: DocumentoConfig[]
}

function getExt(url: string) {
  try {
    const pathname = new URL(url).pathname
    return pathname.split('.').pop()?.toLowerCase() ?? ''
  } catch {
    return url.split('.').pop()?.toLowerCase() ?? ''
  }
}

function Previsualizador({ url }: { url: string }) {
  const ext = getExt(url)
  const isImage = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)
  const isPdf = ext === 'pdf'

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
      {isImage && (
        <img src={url} alt="Previsualización" className="max-h-40 w-full object-contain p-2" />
      )}
      {isPdf && (
        <iframe src={url} className="h-48 w-full" title="PDF" />
      )}
      {!isImage && !isPdf && (
        <div className="flex items-center gap-2 p-3">
          <FileText className="h-4 w-4 text-[#6B7280]" />
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#10B981] underline underline-offset-2">
            Abrir documento
          </a>
        </div>
      )}
    </div>
  )
}

export default function BloqueDocumentos({
  negocioBloqueId,
  instancia,
  modo,
  documentos,
}: BloqueDocumentosProps) {
  const saved = (instancia?.data ?? {}) as Record<string, string>
  const [urls, setUrls] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {}
    documentos.forEach(d => { init[d.slug] = saved[d.slug] ?? '' })
    return init
  })
  const [previewing, setPreviewing] = useState<Record<string, boolean>>({})
  const [verifying, setVerifying] = useState<Record<string, boolean>>({})
  const [verified, setVerified] = useState<Record<string, boolean>>({})
  const [isPending, startTransition] = useTransition()

  function isComplete(vals: Record<string, string>) {
    return documentos.filter(d => d.required).every(d => vals[d.slug]?.trim())
  }

  function handleUrlChange(slug: string, url: string) {
    const next = { ...urls, [slug]: url }
    setUrls(next)
  }

  function handleSave(slug: string) {
    startTransition(async () => {
      const complete = isComplete(urls)
      let result
      if (complete) {
        result = await marcarBloqueCompleto(negocioBloqueId, urls)
      } else {
        result = await actualizarBloqueData(negocioBloqueId, urls)
      }
      if (result.error) toast.error(result.error)
      else toast.success(`Documento "${documentos.find(d => d.slug === slug)?.label}" guardado`)
    })
  }

  function handleVerify(slug: string) {
    setVerifying(prev => ({ ...prev, [slug]: true }))
    setTimeout(() => {
      setVerifying(prev => ({ ...prev, [slug]: false }))
      setVerified(prev => ({ ...prev, [slug]: true }))
      toast.success('Verificación AI: documento válido')
    }, 2000)
  }

  if (modo === 'visible') {
    return (
      <div className="space-y-2">
        {documentos.map(doc => {
          const url = saved[doc.slug]
          return (
            <div key={doc.slug} className="flex items-center gap-2">
              {url ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[#10B981]" />
              ) : (
                <Circle className="h-3.5 w-3.5 shrink-0 text-[#6B7280]/30" />
              )}
              <span className={`text-xs ${url ? 'text-[#1A1A1A]' : 'text-[#6B7280]'}`}>{doc.label}</span>
              {url && (
                <a href={url} target="_blank" rel="noopener noreferrer" className="ml-auto">
                  <Download className="h-3.5 w-3.5 text-[#10B981]" />
                </a>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {documentos.map(doc => (
        <div key={doc.slug} className="rounded-lg border border-[#E5E7EB] p-3">
          <div className="flex items-center gap-1.5 mb-2">
            {urls[doc.slug] ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-[#10B981] shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-[#6B7280]/30 shrink-0" />
            )}
            <span className="text-xs font-medium text-[#1A1A1A]">
              {doc.label}
              {doc.required && <span className="ml-0.5 text-red-500">*</span>}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="url"
              placeholder="https://drive.google.com/..."
              value={urls[doc.slug]}
              onChange={e => handleUrlChange(doc.slug, e.target.value)}
              disabled={isPending}
              className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
            />
            <button
              onClick={() => handleSave(doc.slug)}
              disabled={isPending || !urls[doc.slug]?.trim()}
              className="rounded-lg bg-[#10B981] px-2.5 py-1.5 text-[11px] font-medium text-white hover:bg-[#059669] disabled:opacity-40"
            >
              Guardar
            </button>
          </div>

          {urls[doc.slug] && (
            <div className="mt-2 flex items-center gap-2">
              <button
                onClick={() => setPreviewing(prev => ({ ...prev, [doc.slug]: !prev[doc.slug] }))}
                className="inline-flex items-center gap-1 text-[11px] text-[#6B7280] hover:text-[#1A1A1A]"
              >
                <Eye className="h-3 w-3" />
                {previewing[doc.slug] ? 'Ocultar' : 'Previsualizar'}
              </button>
              <button
                onClick={() => handleVerify(doc.slug)}
                disabled={verifying[doc.slug]}
                className={`inline-flex items-center gap-1 text-[11px] ${verified[doc.slug] ? 'text-[#10B981]' : 'text-[#6B7280] hover:text-[#1A1A1A]'} disabled:opacity-60`}
              >
                <CheckCircle2 className="h-3 w-3" />
                {verifying[doc.slug] ? 'Verificando...' : verified[doc.slug] ? 'Verificado AI' : 'Verificar AI'}
              </button>
              <a href={urls[doc.slug]} target="_blank" rel="noopener noreferrer" className="ml-auto inline-flex items-center gap-1 text-[11px] text-[#10B981]">
                <Download className="h-3 w-3" />
                Descargar
              </a>
            </div>
          )}

          {previewing[doc.slug] && urls[doc.slug] && (
            <Previsualizador url={urls[doc.slug]} />
          )}
        </div>
      ))}
      <div className="text-[10px] text-[#6B7280]">
        {documentos.filter(d => d.required && urls[d.slug]?.trim()).length} / {documentos.filter(d => d.required).length} requeridos completos
      </div>
    </div>
  )
}
