'use client'

import { useState } from 'react'
import { Shield } from 'lucide-react'
import { useRouter } from 'next/navigation'
import WizardFelipe from '../config/wizard-felipe'
import { uploadAndParseRutMiNegocio, confirmRutDataMiNegocio } from './actions'
import type { FiscalProfile } from '@/types/database'
import RutUploadCard from '@/components/rut-upload-card'
import RutDataDisplay from '@/components/rut-data-display'

interface Props {
  fiscalProfile: FiscalProfile | null
  onClose: () => void
}

export default function PerfilFiscalExtended({ fiscalProfile, onClose }: Props) {
  const router = useRouter()
  const [showWizard, setShowWizard] = useState(false)

  const isConfigured = fiscalProfile?.is_complete || fiscalProfile?.is_estimated
  const rutVerificado = fiscalProfile?.rut_verificado === true

  const handleWizardComplete = () => {
    setShowWizard(false)
    router.refresh()
  }

  const handleRutComplete = () => {
    router.refresh()
  }

  // Show wizard if not configured AND no RUT, or user explicitly clicked edit
  if ((!isConfigured && !rutVerificado) || showWizard) {
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

  const fiscalSummary = isConfigured ? {
    city: fiscalProfile!.ica_city || 'Bogota',
    icaRate: fiscalProfile!.ica_rate || 9.66,
    isEstimated: fiscalProfile!.is_estimated,
    isDeclarante: fiscalProfile!.is_declarante,
  } : null

  return (
    <div className="space-y-5">
      {/* RUT Upload */}
      <div>
        <h3 className="font-semibold mb-2">Documento RUT</h3>
        <p className="text-[10px] text-muted-foreground mb-3">
          Sube el RUT y llenamos el perfil fiscal automaticamente con IA
        </p>
        <RutUploadCard
          onUploadAndParse={uploadAndParseRutMiNegocio}
          onConfirm={confirmRutDataMiNegocio}
          currentRutUrl={fiscalProfile?.rut_documento_url}
          currentRutVerificado={fiscalProfile?.rut_verificado}
          currentRutFecha={fiscalProfile?.rut_fecha_carga}
          onComplete={handleRutComplete}
        />
      </div>

      {/* RUT extracted data (read-only) */}
      <RutDataDisplay
        nit={fiscalProfile?.nit}
        tipo_documento={fiscalProfile?.tipo_documento}
        tipo_persona={fiscalProfile?.person_type}
        razon_social={fiscalProfile?.razon_social}
        regimen_tributario={fiscalProfile?.tax_regime}
        gran_contribuyente={fiscalProfile?.gran_contribuyente}
        agente_retenedor={fiscalProfile?.agente_retenedor}
        autorretenedor={fiscalProfile?.self_withholder}
        responsable_iva={fiscalProfile?.iva_responsible}
        direccion_fiscal={fiscalProfile?.direccion_fiscal}
        municipio={fiscalProfile?.municipio}
        departamento={fiscalProfile?.departamento}
        telefono={fiscalProfile?.telefono}
        email_fiscal={fiscalProfile?.email_fiscal}
        actividad_ciiu={fiscalProfile?.ciiu}
        actividad_secundaria={fiscalProfile?.actividad_secundaria}
        fecha_inicio_actividades={fiscalProfile?.fecha_inicio_actividades}
        onEdit={() => setShowWizard(true)}
      />

      {/* ICA / Declarante — not from RUT, stays editable */}
      {fiscalSummary && (
        <div className="space-y-1.5 rounded-lg border p-3">
          <p className="text-[10px] font-medium text-muted-foreground mb-1">Datos ICA</p>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground">Ciudad ICA</span>
            <span className="text-xs font-medium">{fiscalSummary.city} ({fiscalSummary.icaRate}‰)</span>
          </div>
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-muted-foreground">Declarante</span>
            <span className="text-xs font-medium">{fiscalSummary.isDeclarante ? 'Si' : 'No'}</span>
          </div>
          {fiscalSummary.isEstimated && (
            <div className="flex items-center gap-1 mt-1">
              <Shield className="h-3 w-3 text-amber-500" />
              <span className="text-[10px] text-amber-600 dark:text-amber-400">
                Algunos valores son estimados
              </span>
            </div>
          )}
          <button
            onClick={() => setShowWizard(true)}
            className="mt-1 text-[10px] text-primary hover:underline"
          >
            Editar perfil completo
          </button>
        </div>
      )}

    </div>
  )
}
