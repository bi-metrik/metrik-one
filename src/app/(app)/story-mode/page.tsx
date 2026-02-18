'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus,
  Users,
  Calculator,
  FolderKanban,
  Receipt,
  BarChart3,
  Rocket,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react'

interface StorySlide {
  icon: React.ReactNode
  title: string
  subtitle: string
  description: string
  visual: React.ReactNode
}

const SLIDES: StorySlide[] = [
  {
    icon: <Plus className="h-8 w-8" />,
    title: 'Todo empieza con un registro',
    subtitle: 'El botón + es tu mejor amigo',
    description:
      'Un gasto, una hora de trabajo, un cobro. Con un toque desde cualquier pantalla, ONE lo captura todo.',
    visual: (
      <div className="relative flex items-center justify-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-primary shadow-lg">
          <Plus className="h-10 w-10 text-primary-foreground" />
        </div>
        <div className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-success text-xs font-bold text-white">
          FAB
        </div>
      </div>
    ),
  },
  {
    icon: <Users className="h-8 w-8" />,
    title: 'Tus clientes, organizados',
    subtitle: 'Pipeline visual',
    description:
      'Desde que alguien te busca hasta que cierras el negocio. 6 etapas claras para que nunca se te escape una oportunidad.',
    visual: (
      <div className="flex gap-2">
        {['Lead', 'Prospecto', 'Cotización', 'Negociación', 'Ganada'].map((stage, i) => (
          <div
            key={stage}
            className="flex h-16 flex-1 items-center justify-center rounded-lg border border-border text-xs font-medium"
            style={{ opacity: 1 - i * 0.12 }}
          >
            {stage}
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: <Calculator className="h-8 w-8" />,
    title: '¿Cuánto cobrar?',
    subtitle: 'Cotización + cálculo fiscal en vivo',
    description:
      'Escribe el valor y al instante ves cuánto te retienen, cuánto te consignan y cuánto te queda limpio. Sin sorpresas.',
    visual: (
      <div className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Cobras</span>
          <span className="font-bold">$8.000.000</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Te retienen</span>
          <span className="text-destructive">−$880.000</span>
        </div>
        <div className="h-px bg-border" />
        <div className="flex justify-between text-sm">
          <span className="font-medium">Te consignan</span>
          <span className="font-bold text-success">$7.120.000</span>
        </div>
      </div>
    ),
  },
  {
    icon: <FolderKanban className="h-8 w-8" />,
    title: 'Controla cada proyecto',
    subtitle: 'Vista 360',
    description:
      'Horas, gastos directos, cobros programados y recibidos. Todo en un solo lugar para que sepas la rentabilidad real de cada proyecto.',
    visual: (
      <div className="grid grid-cols-2 gap-3">
        {[
          { label: 'Horas', value: '48h', color: 'text-primary' },
          { label: 'Gastos', value: '$1.2M', color: 'text-destructive' },
          { label: 'Cobrado', value: '$5.6M', color: 'text-success' },
          { label: 'Margen', value: '32%', color: 'text-warning' },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border border-border p-3 text-center">
            <p className="text-xs text-muted-foreground">{item.label}</p>
            <p className={`text-lg font-bold ${item.color}`}>{item.value}</p>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: <Receipt className="h-8 w-8" />,
    title: 'Facturas y cobras',
    subtitle: 'Cartera + alertas inteligentes',
    description:
      'Programa tus cobros, registra lo que te pagan y ONE te avisa cuando es hora de cobrar. Tú nunca contactas al cliente — ONE te prepara el mensaje.',
    visual: (
      <div className="space-y-2">
        {[
          { client: 'Constructora ABC', amount: '$4.2M', status: 'Cobrado', color: 'bg-success/10 text-success' },
          { client: 'Estudio Diseño XY', amount: '$2.1M', status: 'Vence mañana', color: 'bg-warning/10 text-warning' },
          { client: 'Inmobiliaria 123', amount: '$6.5M', status: 'Pendiente', color: 'bg-muted text-muted-foreground' },
        ].map((item) => (
          <div key={item.client} className="flex items-center justify-between rounded-lg border border-border px-4 py-3">
            <div>
              <p className="text-sm font-medium">{item.client}</p>
              <p className="text-xs text-muted-foreground">{item.amount}</p>
            </div>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${item.color}`}>
              {item.status}
            </span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: <BarChart3 className="h-8 w-8" />,
    title: 'Todo se convierte en claridad',
    subtitle: 'Las 5 preguntas de tus Números',
    description:
      '¿Cuánta plata tengo? ¿Estoy ganando? ¿Cuánto queda para mí? ¿Cuánto necesito vender? ¿Cuánto aguanto? — Respuestas reales con tus datos.',
    visual: (
      <div className="space-y-2">
        {[
          '¿Cuánta plata tengo?',
          '¿Estoy ganando?',
          '¿Cuánto queda para mí?',
          '¿Cuánto necesito vender?',
          '¿Cuánto aguanto?',
        ].map((q, i) => (
          <div key={q} className="flex items-center gap-3 rounded-lg border border-border px-4 py-2.5">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
              {i + 1}
            </div>
            <span className="text-sm">{q}</span>
          </div>
        ))}
      </div>
    ),
  },
  {
    icon: <Rocket className="h-8 w-8" />,
    title: 'Tu negocio te espera',
    subtitle: 'Comencemos con tu primera acción',
    description:
      '14 días gratis con todas las funcionalidades Pro. Sin tarjeta de crédito. Empieza registrando lo que está pasando hoy en tu negocio.',
    visual: (
      <div className="space-y-4 text-center">
        <div className="mx-auto flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
          <Rocket className="h-12 w-12 text-primary" />
        </div>
        <p className="text-lg font-semibold">14 días Pro gratis</p>
        <p className="text-sm text-muted-foreground">Sin tarjeta de crédito</p>
      </div>
    ),
  },
]

export default function StoryModePage() {
  const router = useRouter()
  const [current, setCurrent] = useState(0)

  const slide = SLIDES[current]
  const isLast = current === SLIDES.length - 1
  const isFirst = current === 0

  const handleNext = () => {
    if (isLast) {
      router.push('/dashboard')
    } else {
      setCurrent(current + 1)
    }
  }

  const handleBack = () => {
    if (!isFirst) {
      setCurrent(current - 1)
    }
  }

  const handleSkip = () => {
    router.push('/dashboard')
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      {/* Skip button — always visible (D6-D14) */}
      <div className="flex justify-end p-4">
        <button
          onClick={handleSkip}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Saltar tour
        </button>
      </div>

      {/* Content */}
      <div className="flex flex-1 flex-col items-center justify-center px-4">
        <div className="w-full max-w-md space-y-8">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              {slide.icon}
            </div>
          </div>

          {/* Text */}
          <div className="space-y-2 text-center">
            <p className="text-sm font-medium uppercase tracking-wide text-primary">
              {slide.subtitle}
            </p>
            <h1 className="text-2xl font-bold">{slide.title}</h1>
            <p className="text-muted-foreground">{slide.description}</p>
          </div>

          {/* Visual */}
          <div className="py-4">{slide.visual}</div>
        </div>
      </div>

      {/* Navigation */}
      <div className="p-4">
        <div className="mx-auto w-full max-w-md space-y-4">
          {/* Dots */}
          <div className="flex justify-center gap-1.5">
            {SLIDES.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrent(i)}
                className={`h-2 rounded-full transition-all ${
                  i === current ? 'w-6 bg-primary' : 'w-2 bg-muted-foreground/30'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-3">
            {!isFirst && (
              <button
                onClick={handleBack}
                className="flex h-12 w-12 items-center justify-center rounded-lg border border-input transition-colors hover:bg-accent"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
            )}
            <button
              onClick={handleNext}
              className="flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {isLast ? (
                'Ir a mi Dashboard'
              ) : (
                <>
                  Siguiente
                  <ChevronRight className="h-4 w-4" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
