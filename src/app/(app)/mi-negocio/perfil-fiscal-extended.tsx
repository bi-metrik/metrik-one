'use client'

import { useState, useTransition } from 'react'
import { Shield, Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import WizardFelipe from '../config/wizard-felipe'
import { updateFiscalExtended } from './actions'
import type { FiscalProfile } from '@/types/database'

interface Props {
  fiscalProfile: FiscalProfile | null
  onClose: () => void
}

export default function PerfilFiscalExtended({ fiscalProfile, onClose }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [showWizard, setShowWizard] = useState(false)

  // Extended fields form
  const [nit, setNit] = useState(fiscalProfile?.nit || '')
  const [razonSocial, setRazonSocial] = useState(fiscalProfile?.razon_social || '')
  const [direccionFiscal, setDireccionFiscal] = useState(fiscalProfile?.direccion_fiscal || '')
  const [emailFacturacion, setEmailFacturacion] = useState(fiscalProfile?.email_facturacion || '')

  const isConfigured = fiscalProfile?.is_complete || fiscalProfile?.is_estimated

  const handleWizardComplete = (result: { isComplete: boolean; isEstimated: boolean }) => {
    setShowWizard(false)
    router.refresh()
  }

  const handleSaveExtended = () => {
    startTransition(async () => {
      const res = await updateFiscalExtended({
        nit: nit.trim() || undefined,
        razon_social: razonSocial.trim() || undefined,
        direccion_fiscal: direccionFiscal.trim() || undefined,
        email_facturacion: emailFacturacion.trim() || undefined,
      })
      if (res.success) {
        toast.success('Datos de facturacion actualizados')
        router.refresh()
      } else {
        toast.error(res.error || 'Error')
      }
    })
  }

  const fiscalSummary = isConfigured ? {
    personType: fiscalProfile!.person_type === 'juridica' ? 'Persona Juridica' : 'Persona Natural',
    regime: fiscalProfile!.tax_regime === 'simple' ? 'Simple (SIMPLE)' : 'Ordinario',
    iva: fiscalProfile!.iva_responsible ? 'Responsable (19%)' : 'No responsable',
    city: fiscalProfile!.ica_city || 'Bogota',
    icaRate: fiscalProfile!.ica_rate || 9.66,
    isEstimated: fiscalProfile!.is_estimated,
  } : null

  // Show wizard if not configured or user clicked edit
  if (!isConfigured || showWizard) {
    return (
      <WizardFelipe
        onComplete={handleWizardComplete}
        onSkip={onClose}
        initialData={fiscalProfile ? {
          personType: (fiscalProfile.person_type as 'natural' | 'juridica') || undefined,
          taxRegime: (fiscalProfile.tax_regime as 'ordinario' | 'simple') || undefined,
          ivaResponsible: fiscalProfile.iva_responsible ?? undefined,
          isDeclarante: fiscalProfile.is_declarante ?? true,
          selfWithholder: fiscalProfile.self_withholder ?? false,
          icaCity: fiscalProfile.ica_city || '',
          icaRate: fiscalProfile.ica_rate || 9.66,
        } : undefined}
      />
    )
  }

  // Configured — show summary + extended fields
  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Perfil fiscal</h3>
          {fiscalSummary?.isEstimated && (
            <div className="flex items-center gap-1 mt-1">
              <Shield className="h-3 w-3 text-amber-500" />
              <span className="text-xs text-amber-600 dark:text-amber-400">
                Algunos valores son estimados
              </span>
            </div>
          )}
        </div>
        <button
          onClick={() => setShowWizard(true)}
          className="text-xs text-primary hover:underline"
        >
          Editar perfil
        </button>
      </div>

      <div className="space-y-1.5 rounded-lg border p-3">
        <SummaryRow label="Tipo persona" value={fiscalSummary!.personType} />
        <SummaryRow label="Regimen" value={fiscalSummary!.regime} />
        <SummaryRow label="IVA" value={fiscalSummary!.iva} />
        <SummaryRow label="Ciudad ICA" value={`${fiscalSummary!.city} (${fiscalSummary!.icaRate}‰)`} />
      </div>

      {/* Extended: Facturacion fields */}
      <div className="space-y-3 border-t pt-4">
        <h4 className="text-sm font-medium">Datos de facturacion</h4>
        <p className="text-xs text-muted-foreground">
          Estos datos aparecen en tus cotizaciones y facturas.
        </p>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground">NIT / CC</label>
            <input
              type="text"
              value={nit}
              onChange={e => setNit(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="900.123.456-7"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Razon social</label>
            <input
              type="text"
              value={razonSocial}
              onChange={e => setRazonSocial(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Mi Empresa SAS"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Direccion fiscal</label>
            <input
              type="text"
              value={direccionFiscal}
              onChange={e => setDireccionFiscal(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="Cra 7 #45-12, Bogota"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Email facturacion</label>
            <input
              type="email"
              value={emailFacturacion}
              onChange={e => setEmailFacturacion(e.target.value)}
              className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              placeholder="facturacion@miempresa.co"
            />
          </div>
        </div>

        <button
          onClick={handleSaveExtended}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          Guardar
        </button>
      </div>
    </div>
  )
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs font-medium">{value}</span>
    </div>
  )
}
