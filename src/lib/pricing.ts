/**
 * Pricing constants — MéTRIK ONE (COP/mes)
 * Fuente: decisión 2026-03-18 (Carmen + Mauricio)
 */

export const PRICING = {
  BASE_LICENSE_COP: 100_000,
  EXTRA_USER_COP: 50_000,
} as const

export const FEATURE_CATALOG: Record<string, { label: string; description: string; defaultPrice: number }> = {
  whatsapp: {
    label: 'WhatsApp',
    description: 'Tu equipo reporta gastos, horas y novedades desde WhatsApp.',
    defaultPrice: 80_000,
  },
  ai_bot: {
    label: 'Bot AI',
    description: 'Asistente inteligente que analiza tus datos y responde preguntas.',
    defaultPrice: 80_000,
  },
}
