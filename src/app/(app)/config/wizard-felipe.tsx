'use client'

import { useState, useTransition } from 'react'
import {
  ArrowLeft, ArrowRight, Check, Loader2, HelpCircle,
  Building2, User, Shield, Receipt, MapPin,
} from 'lucide-react'
import { toast } from 'sonner'
import { saveFiscalProfile, skipFiscalSetup } from './fiscal-actions'
import type { FiscalWizardData } from './fiscal-actions'

// ── Types ──────────────────────────────────────────────

interface WizardFelipeProps {
  onComplete: (result: { isComplete: boolean; isEstimated: boolean }) => void
  onSkip: () => void
  initialData?: Partial<FiscalWizardData>
}

type Step = 'person' | 'regime' | 'iva' | 'retefuente' | 'ica' | 'review'

const STEPS: Step[] = ['person', 'regime', 'iva', 'retefuente', 'ica', 'review']

// ── ICA Cities (main cities) ────────────────────────────

const ICA_CITIES: { city: string; rate: number }[] = [
  { city: 'Bogotá', rate: 9.66 },
  { city: 'Medellín', rate: 10.0 },
  { city: 'Cali', rate: 10.0 },
  { city: 'Barranquilla', rate: 7.0 },
  { city: 'Cartagena', rate: 7.0 },
  { city: 'Bucaramanga', rate: 10.0 },
  { city: 'Pereira', rate: 7.0 },
  { city: 'Manizales', rate: 7.0 },
  { city: 'Santa Marta', rate: 7.0 },
  { city: 'Otra ciudad', rate: 9.66 },
]

// ── Component ──────────────────────────────────────────

export default function WizardFelipe({ onComplete, onSkip, initialData }: WizardFelipeProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [isPending, startTransition] = useTransition()

  // Wizard state
  const [personType, setPersonType] = useState<'natural' | 'juridica' | null>(
    initialData?.personType || null
  )
  const [taxRegime, setTaxRegime] = useState<'ordinario' | 'simple' | 'no_se' | null>(
    initialData?.taxRegime || null
  )
  const [ivaResponsible, setIvaResponsible] = useState<boolean | 'no_se' | null>(
    initialData?.ivaResponsible ?? null
  )
  const [isDeclarante, setIsDeclarante] = useState<boolean>(
    initialData?.isDeclarante ?? true
  )
  const [selfWithholder, setSelfWithholder] = useState<boolean>(
    initialData?.selfWithholder ?? false
  )
  const [icaCity, setIcaCity] = useState<string>(
    initialData?.icaCity || ''
  )

  const step = STEPS[currentStep]
  const totalSteps = STEPS.length

  // ── Navigation ──

  const canGoNext = (): boolean => {
    switch (step) {
      case 'person': return personType !== null
      case 'regime': return taxRegime !== null
      case 'iva': return ivaResponsible !== null
      case 'retefuente': return true // always valid (defaults)
      case 'ica': return icaCity !== ''
      case 'review': return true
      default: return false
    }
  }

  const goNext = () => {
    if (currentStep < totalSteps - 1) {
      // Skip IVA question if regime is Simple (no IVA in Simple)
      if (step === 'regime' && taxRegime === 'simple') {
        setIvaResponsible(false)
        setCurrentStep(currentStep + 2) // skip IVA step
        return
      }
      setCurrentStep(currentStep + 1)
    }
  }

  const goBack = () => {
    if (currentStep > 0) {
      // If at retefuente and regime was Simple, go back to regime (skip IVA)
      if (step === 'retefuente' && taxRegime === 'simple') {
        setCurrentStep(currentStep - 2)
        return
      }
      setCurrentStep(currentStep - 1)
    }
  }

  // ── IVA Inference (D412) ──
  // "¿No sabes?" → "¿Facturas con IVA?" → Si: Responsable / No: No Responsable
  const [showIvaInference, setShowIvaInference] = useState(false)

  // ── Submit ──

  const handleSubmit = () => {
    startTransition(async () => {
      const data: FiscalWizardData = {
        personType: personType!,
        taxRegime: taxRegime === 'no_se' ? null : taxRegime,
        ivaResponsible: ivaResponsible === 'no_se' ? null : ivaResponsible as boolean,
        isDeclarante,
        selfWithholder,
        icaCity: icaCity || 'Bogotá',
        icaRate: ICA_CITIES.find(c => c.city === icaCity)?.rate || 9.66,
      }

      const result = await saveFiscalProfile(data)

      if (!result.success) {
        toast.error(result.error)
        return
      }

      const statusMsg = result.isComplete
        ? '✅ Perfil fiscal completo'
        : '⚠️ Perfil fiscal estimado — puedes completarlo después'

      toast.success(statusMsg)
      onComplete({ isComplete: result.isComplete, isEstimated: result.isEstimated })
    })
  }

  const handleSkip = () => {
    startTransition(async () => {
      await skipFiscalSetup()
      toast('Configurar después', {
        description: 'Usaremos valores conservadores por defecto.',
      })
      onSkip()
    })
  }

  // ── Inferred values for review ──

  const getIcaRate = () => ICA_CITIES.find(c => c.city === icaCity)?.rate || 9.66
  const resolvedRegime = taxRegime === 'no_se' ? 'ordinario' : taxRegime
  const resolvedIva = ivaResponsible === 'no_se' ? true : ivaResponsible

  // ── Render ──────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">
            <span className="mr-2">🧑‍💼</span>Felipe — Setup Fiscal
          </h3>
          <p className="text-sm text-muted-foreground">
            Configura tu perfil para cálculos precisos
          </p>
        </div>
        <button
          onClick={handleSkip}
          disabled={isPending}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          Configurar después →
        </button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-1">
        {STEPS.map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i <= currentStep ? 'bg-primary' : 'bg-muted'
            }`}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="min-h-[240px]">
        {/* ─── Step 1: Tipo Persona ─── */}
        {step === 'person' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">¿Qué tipo de persona eres?</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Esto define cómo se calculan tus retenciones.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <OptionCard
                icon={<User className="h-6 w-6" />}
                label="Persona Natural"
                description="Independiente, freelancer, profesional"
                selected={personType === 'natural'}
                onClick={() => setPersonType('natural')}
              />
              <OptionCard
                icon={<Building2 className="h-6 w-6" />}
                label="Persona Jurídica"
                description="SAS, Ltda, empresa constituida"
                selected={personType === 'juridica'}
                onClick={() => setPersonType('juridica')}
              />
            </div>
          </div>
        )}

        {/* ─── Step 2: Régimen Tributario ─── */}
        {step === 'regime' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">¿Cuál es tu régimen tributario?</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Si no sabes, te ayudamos a inferirlo.
              </p>
            </div>
            <div className="space-y-2">
              <OptionRow
                label="Régimen Ordinario"
                description="La mayoría de independientes y empresas"
                selected={taxRegime === 'ordinario'}
                onClick={() => setTaxRegime('ordinario')}
              />
              <OptionRow
                label="Régimen Simple (SIMPLE)"
                description="Tributación simplificada, sin retenciones de IVA"
                selected={taxRegime === 'simple'}
                onClick={() => setTaxRegime('simple')}
              />
              <OptionRow
                label="No sé"
                description="Usaremos Ordinario por defecto (conservador)"
                selected={taxRegime === 'no_se'}
                onClick={() => setTaxRegime('no_se')}
                muted
              />
            </div>
          </div>
        )}

        {/* ─── Step 3: IVA ─── */}
        {step === 'iva' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">¿Eres responsable de IVA?</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Si facturas con IVA del 19%, eres responsable.
              </p>
            </div>

            {!showIvaInference ? (
              <div className="space-y-2">
                <OptionRow
                  label="Sí, soy responsable de IVA"
                  description="Facturo con IVA del 19%"
                  selected={ivaResponsible === true}
                  onClick={() => { setIvaResponsible(true); setShowIvaInference(false) }}
                />
                <OptionRow
                  label="No, no soy responsable de IVA"
                  description="No cobro IVA en mis facturas"
                  selected={ivaResponsible === false}
                  onClick={() => { setIvaResponsible(false); setShowIvaInference(false) }}
                />
                <button
                  onClick={() => setShowIvaInference(true)}
                  className="flex items-center gap-2 text-sm text-primary hover:underline mt-2"
                >
                  <HelpCircle className="h-4 w-4" />
                  No sé — ayúdame a descubrirlo
                </button>
              </div>
            ) : (
              /* Inference flow */
              <div className="space-y-4 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-medium">
                  🤔 Pregunta rápida: ¿Tus facturas incluyen una línea de IVA del 19%?
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => { setIvaResponsible(true); setShowIvaInference(false) }}
                    className="flex-1 rounded-lg border bg-background px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    Sí, incluyen IVA
                  </button>
                  <button
                    onClick={() => { setIvaResponsible(false); setShowIvaInference(false) }}
                    className="flex-1 rounded-lg border bg-background px-4 py-3 text-sm font-medium hover:bg-accent transition-colors"
                  >
                    No, no incluyen IVA
                  </button>
                </div>
                <button
                  onClick={() => { setIvaResponsible('no_se'); setShowIvaInference(false) }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Realmente no sé → usaremos &quot;Sí&quot; por defecto (conservador)
                </button>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 4: Retención en la fuente ─── */}
        {step === 'retefuente' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">Retención en la fuente</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Esto afecta cuánto te retienen en cada pago.
              </p>
            </div>
            <div className="space-y-2">
              <OptionRow
                label="Soy declarante de renta"
                description={personType === 'natural' ? 'ReteFuente: 11% (honorarios)' : 'ReteFuente: 4% (servicios)'}
                selected={isDeclarante}
                onClick={() => setIsDeclarante(true)}
              />
              <OptionRow
                label="No soy declarante de renta"
                description={personType === 'natural' ? 'ReteFuente: 10% (honorarios)' : 'Sin diferencia para jurídicas'}
                selected={!isDeclarante}
                onClick={() => setIsDeclarante(false)}
              />
            </div>

            {personType === 'juridica' && (
              <div className="space-y-2 mt-4">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setSelfWithholder(!selfWithholder)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      selfWithholder
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input hover:border-primary'
                    }`}
                  >
                    {selfWithholder && <Check className="h-3 w-3" />}
                  </button>
                  <div>
                    <p className="text-sm font-medium">Soy autorretenedor</p>
                    <p className="text-xs text-muted-foreground">
                      Los clientes no te retienen — tú te autorretienes
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ─── Step 5: ICA ─── */}
        {step === 'ica' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">
                <MapPin className="inline h-4 w-4 mr-1" />
                ¿En qué ciudad operas principalmente?
              </h4>
              <p className="text-sm text-muted-foreground mt-1">
                Esto define tu tarifa de ReteICA.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {ICA_CITIES.map(({ city, rate }) => (
                <button
                  key={city}
                  onClick={() => setIcaCity(city)}
                  className={`rounded-lg border px-3 py-2.5 text-left text-sm transition-colors ${
                    icaCity === city
                      ? 'border-primary bg-primary/10 font-medium'
                      : 'hover:bg-accent/50'
                  }`}
                >
                  <p className="font-medium">{city}</p>
                  <p className="text-xs text-muted-foreground">{rate}‰</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ─── Step 6: Review ─── */}
        {step === 'review' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium">Resumen de tu perfil fiscal</h4>
              <p className="text-sm text-muted-foreground mt-1">
                Revisa que todo esté correcto antes de guardar.
              </p>
            </div>

            <div className="space-y-2 rounded-lg border bg-card p-4">
              <ReviewRow label="Tipo persona" value={personType === 'natural' ? 'Persona Natural' : 'Persona Jurídica'} />
              <ReviewRow
                label="Régimen"
                value={resolvedRegime === 'simple' ? 'Simple (SIMPLE)' : 'Ordinario'}
                estimated={taxRegime === 'no_se'}
              />
              <ReviewRow
                label="IVA"
                value={resolvedIva ? 'Responsable (19%)' : 'No responsable'}
                estimated={ivaResponsible === 'no_se'}
              />
              <ReviewRow
                label="Declarante renta"
                value={isDeclarante ? 'Sí' : 'No'}
              />
              {selfWithholder && (
                <ReviewRow label="Autorretenedor" value="Sí" />
              )}
              <ReviewRow
                label="Ciudad ICA"
                value={`${icaCity} (${getIcaRate()}‰)`}
              />
            </div>

            {(taxRegime === 'no_se' || ivaResponsible === 'no_se') && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/30">
                <Shield className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
                <div>
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
                    Perfil estimado
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-500">
                    Algunos valores usan defaults conservadores porque seleccionaste &quot;No sé&quot;.
                    Puedes editarlos después en Configuración.
                  </p>
                </div>
              </div>
            )}

            <p className="text-xs text-muted-foreground">
              Valores estimados con base en parámetros fiscales 2026. Consulta tu contador para cálculos definitivos.
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <button
          onClick={goBack}
          disabled={currentStep === 0 || isPending}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-30 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Atrás
        </button>

        <span className="text-xs text-muted-foreground">
          {currentStep + 1} de {totalSteps}
        </span>

        {step === 'review' ? (
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            Guardar perfil
          </button>
        ) : (
          <button
            onClick={goNext}
            disabled={!canGoNext() || isPending}
            className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            Siguiente
            <ArrowRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

// ── Sub-Components ──────────────────────────────────────

function OptionCard({
  icon,
  label,
  description,
  selected,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  description: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center gap-2 rounded-xl border p-6 text-center transition-all ${
        selected
          ? 'border-primary bg-primary/10 shadow-sm'
          : 'hover:bg-accent/50'
      }`}
    >
      <div className={`${selected ? 'text-primary' : 'text-muted-foreground'}`}>
        {icon}
      </div>
      <p className="font-medium text-sm">{label}</p>
      <p className="text-xs text-muted-foreground">{description}</p>
    </button>
  )
}

function OptionRow({
  label,
  description,
  selected,
  onClick,
  muted = false,
}: {
  label: string
  description: string
  selected: boolean
  onClick: () => void
  muted?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all ${
        selected
          ? 'border-primary bg-primary/10'
          : 'hover:bg-accent/50'
      } ${muted ? 'opacity-70' : ''}`}
    >
      <div className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
        selected ? 'border-primary bg-primary' : 'border-input'
      }`}>
        {selected && <Check className="h-3 w-3 text-primary-foreground" />}
      </div>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
    </button>
  )
}

function ReviewRow({
  label,
  value,
  estimated = false,
}: {
  label: string
  value: string
  estimated?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{value}</span>
        {estimated && (
          <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            estimado
          </span>
        )}
      </div>
    </div>
  )
}
