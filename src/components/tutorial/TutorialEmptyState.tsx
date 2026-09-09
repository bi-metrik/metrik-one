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
  title = 'Comienza por aqui',
  description = 'Valida revisa listas SARLAFT en una sola consulta. Mira la demo o haz una consulta de prueba.',
  onStartDemo,
  onTryConsulta,
  ctaSecundario = 'Hacer consulta de prueba',
}: Props) {
  return (
    <div className="bg-white rounded-lg border border-[#E5E7EB] p-6 sm:p-8 flex flex-col sm:flex-row gap-5 items-start sm:items-center">
      <div className="flex items-center justify-center h-14 w-14 rounded-full bg-acento/10 text-acento shrink-0">
        <ShieldCheck className="h-7 w-7" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-base font-bold text-tinta">{title}</h3>
        <p className="text-sm text-tinta-suave mt-1">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2 sm:shrink-0">
        <button
          type="button"
          onClick={onStartDemo}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-acento text-white text-sm font-semibold hover:bg-acento-hover transition-colors"
        >
          Ver demo guiada
        </button>
        {onTryConsulta && (
          <button
            type="button"
            onClick={onTryConsulta}
            className="inline-flex items-center gap-2 h-10 px-4 rounded-lg border border-[#E5E7EB] text-sm font-semibold text-tinta hover:bg-papel transition-colors"
          >
            {ctaSecundario}
          </button>
        )}
      </div>
    </div>
  );
}
