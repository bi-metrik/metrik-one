'use client';

// Wrapper sobre driver.js para tutoriales in-app.
// Auto-arranca si el usuario nunca lo abrio. El boton "?" del header puede
// forzar re-trigger ignorando completed_at.
//
// Marca: usa la paleta MeTRIK via la clase `metrik-driver` (ver tutorial.css
// importado al final). NO usa zinc/slate/gray.

import { useEffect, useRef } from 'react';
import { driver, type Driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import { getTutorial } from '@/lib/tutorials/registry';
import {
  getTutorialProgress,
  markStepComplete,
  markCompleted,
  markDismissed,
  resetTutorial,
} from '@/lib/actions/tutorial-progress';
import type { TutorialSlug, TutorialStep } from '@/lib/tutorials/types';
import './tutorial.css';

type Props = {
  slug: TutorialSlug;
  /**
   * Si es true, fuerza re-trigger ignorando completed_at/dismissed_at.
   * Cambia el valor para disparar el tour desde un boton externo.
   */
  forceStart?: number;
};

function buildDriveSteps(steps: TutorialStep[]): DriveStep[] {
  return steps.map(step => {
    const driveStep: DriveStep = {
      popover: {
        title: step.title,
        description: step.description,
      },
    };
    if (step.element) {
      driveStep.element = step.element;
    }
    if (driveStep.popover && step.side) {
      driveStep.popover.side = step.side;
    }
    if (driveStep.popover && step.align) {
      driveStep.popover.align = step.align;
    }
    return driveStep;
  });
}

export default function TutorialTour({ slug, forceStart = 0 }: Props) {
  const driverRef = useRef<Driver | null>(null);
  const completedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function start(force: boolean) {
      const tutorial = getTutorial(slug);
      const progress = await getTutorialProgress(slug);

      if (!force) {
        // Auto-start solo si el usuario nunca lo abrio o esta a mitad de camino.
        if (progress?.completed_at || progress?.dismissed_at) return;
        if (progress && progress.current_step > 0) return; // ya recorrio parte, no insistir
      } else {
        // Reset para volver a contar desde 0.
        await resetTutorial(slug);
      }

      if (cancelled) return;

      const driveSteps = buildDriveSteps(tutorial.steps);
      completedRef.current = false;

      const instance = driver({
        showProgress: true,
        smoothScroll: true,
        allowClose: true,
        animate: true,
        overlayColor: '#1A1A1A',
        overlayOpacity: 0.55,
        stagePadding: 6,
        stageRadius: 8,
        popoverClass: 'metrik-driver',
        nextBtnText: 'Siguiente',
        prevBtnText: 'Atras',
        doneBtnText: 'Listo',
        progressText: '{{current}} de {{total}}',
        steps: driveSteps,
        onHighlightStarted: (_el, _step, opts) => {
          const idx = opts.state.activeIndex ?? 0;
          // Detectar si el usuario llego al ultimo step (proxy para "completado")
          if (idx >= driveSteps.length - 1) {
            completedRef.current = true;
          }
          // fire-and-forget, no bloquea UX
          void markStepComplete(slug, idx);
        },
        onDestroyed: () => {
          if (completedRef.current) {
            void markCompleted(slug);
          } else {
            void markDismissed(slug);
          }
        },
      });

      driverRef.current = instance;
      instance.drive();
    }

    void start(forceStart > 0);

    return () => {
      cancelled = true;
      if (driverRef.current) {
        driverRef.current.destroy();
        driverRef.current = null;
      }
    };
  }, [slug, forceStart]);

  return null;
}
