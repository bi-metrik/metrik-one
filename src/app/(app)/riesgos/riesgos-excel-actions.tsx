'use client'

import { useState, useRef } from 'react'
import { Download, Upload, FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import {
  generarPlantillaRiesgos,
  importarRiesgosExcel,
  exportarRiesgosExcel,
} from '@/lib/actions/riesgos'

function downloadBase64(base64: string, filename: string) {
  const byteCharacters = atob(base64)
  const byteNumbers = new Array(byteCharacters.length)
  for (let i = 0; i < byteCharacters.length; i++) {
    byteNumbers[i] = byteCharacters.charCodeAt(i)
  }
  const byteArray = new Uint8Array(byteNumbers)
  const blob = new Blob([byteArray], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.visibility = 'hidden'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // Remove data URL prefix (data:application/...;base64,)
      const base64 = result.split(',')[1]
      resolve(base64)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function RiesgosExcelActions() {
  const [loadingPlantilla, setLoadingPlantilla] = useState(false)
  const [loadingImport, setLoadingImport] = useState(false)
  const [loadingExport, setLoadingExport] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleDescargarPlantilla() {
    setLoadingPlantilla(true)
    try {
      const result = await generarPlantillaRiesgos()
      downloadBase64(result.data, result.filename)
      toast.success('Plantilla descargada')
    } catch {
      toast.error('Error al generar la plantilla')
    } finally {
      setLoadingPlantilla(false)
    }
  }

  async function handleImportarClick() {
    fileInputRef.current?.click()
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    // Reset the input so the same file can be selected again
    e.target.value = ''

    if (!file.name.endsWith('.xlsx') && !file.name.endsWith('.xls')) {
      toast.error('El archivo debe ser un Excel (.xlsx)')
      return
    }

    setLoadingImport(true)
    try {
      const base64 = await fileToBase64(file)
      const result = await importarRiesgosExcel(base64)

      if (result.imported > 0) {
        toast.success(`${result.imported} riesgo${result.imported !== 1 ? 's' : ''} importado${result.imported !== 1 ? 's' : ''} correctamente`)
      }

      if (result.errors.length > 0) {
        const errorMessages = result.errors
          .slice(0, 5)
          .map(e => `Fila ${e.fila}: ${e.error}`)
          .join('\n')
        const suffix = result.errors.length > 5 ? `\n...y ${result.errors.length - 5} errores mas` : ''
        toast.error(`Errores en importacion:\n${errorMessages}${suffix}`, {
          duration: 10000,
        })
      }

      if (result.imported === 0 && result.errors.length === 0) {
        toast.info('No se encontraron filas para importar')
      }
    } catch {
      toast.error('Error al procesar el archivo')
    } finally {
      setLoadingImport(false)
    }
  }

  async function handleExportar() {
    setLoadingExport(true)
    try {
      const result = await exportarRiesgosExcel()
      downloadBase64(result.data, result.filename)
      toast.success('Riesgos exportados')
    } catch {
      toast.error('Error al exportar los riesgos')
    } finally {
      setLoadingExport(false)
    }
  }

  const btnClass =
    'inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] px-3 py-2 text-sm font-medium text-[#6B7280] transition-colors hover:bg-gray-50 hover:text-[#1A1A1A] disabled:opacity-50 disabled:cursor-not-allowed'

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleFileSelected}
      />
      <button
        onClick={handleDescargarPlantilla}
        disabled={loadingPlantilla}
        className={btnClass}
        title="Descargar plantilla Excel"
      >
        <Download className="h-4 w-4" />
        <span className="hidden sm:inline">{loadingPlantilla ? 'Generando...' : 'Plantilla'}</span>
      </button>
      <button
        onClick={handleImportarClick}
        disabled={loadingImport}
        className={btnClass}
        title="Importar riesgos desde Excel"
      >
        <Upload className="h-4 w-4" />
        <span className="hidden sm:inline">{loadingImport ? 'Importando...' : 'Importar'}</span>
      </button>
      <button
        onClick={handleExportar}
        disabled={loadingExport}
        className={btnClass}
        title="Exportar riesgos a Excel"
      >
        <FileSpreadsheet className="h-4 w-4" />
        <span className="hidden sm:inline">{loadingExport ? 'Exportando...' : 'Exportar'}</span>
      </button>
    </>
  )
}
