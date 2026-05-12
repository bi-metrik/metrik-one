'use client';

// Boton circular "?" en header de la pagina. Click fuerza re-trigger del tour.

import { HelpCircle } from 'lucide-react';

type Props = {
  onClick: () => void;
  label?: string;
};

export default function TutorialButton({ onClick, label = 'Ver tutorial' }: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex items-center justify-center h-9 w-9 rounded-full border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#10B981] hover:border-[#10B981] transition-colors"
    >
      <HelpCircle className="h-5 w-5" />
    </button>
  );
}
