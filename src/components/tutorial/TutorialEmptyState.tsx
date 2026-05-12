'use client';

// Tarjeta "Comienza aqui" para superficies sin historial.
// Renderizar arriba de los tabs cuando historial.length === 0.

import { ShieldCheck } from 'lucide-react';

type Props = {
  title?: string;
  description?: string;
  onStartDemo: () => void;
  onTryConsulta?: () => void;
  ctaSecundario?: string;
};

export default function TutorialEmptyState({
  title = 'Comienza aqui', // TODO(mateo)
  description = 'Recorre el tutorial guiado o prueba una consulta de ejemplo. Aprendes en menos de un minuto.', // TODO(mateo)
  onStartDemo,
  onTryConsulta,
  ctaSecundario = 'Hacer consulta de prueba',
}: Props) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 sm:p-8 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-full bg-[#10B981]/10 text-[#10B981] shrink-0">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-bold text-[#1A1A1A]">{title}</h3>
        <p className="text-sm text-[#6B7280] mt-1">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2 sm:shrink-0">
        <button
          type="button"
          onClick={onStartDemo}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#10B981] text-white text-sm font-semibold hover:bg-[#059669] transition-colors"
        >
          Ver demo guiada
        </button>
        {onTryConsulta && (
          <button
            type="button"
            onClick={onTryConsulta}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
          >
            {ctaSecundario}
          </button>
        )}
      </div>
    </div>
  );
}
