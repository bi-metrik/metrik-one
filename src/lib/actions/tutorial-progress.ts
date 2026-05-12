'use server';

// Server actions para tracking de progreso de tutoriales in-app.
// Row se crea on-demand al primer paso. RLS valida workspace+user.

import { getWorkspace } from './get-workspace';
import { getTutorial } from '@/lib/tutorials/registry';
import type { TutorialProgress, TutorialSlug } from '@/lib/tutorials/types';

type ProgressRow = {
  current_step: number;
  completed_at: string | null;
  dismissed_at: string | null;
  version: number;
};

export async function getTutorialProgress(
  slug: TutorialSlug
): Promise<TutorialProgress | null> {
  const { supabase, workspaceId, userId } = await getWorkspace();
  if (!workspaceId || !userId) return null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase.from('tutorial_progress') as any)
    .select('current_step, completed_at, dismissed_at, version')
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('tutorial_slug', slug)
    .maybeSingle();

  if (!data) return null;
  const row = data as ProgressRow;
  return {
    current_step: row.current_step,
    completed_at: row.completed_at,
    dismissed_at: row.dismissed_at,
    version: row.version,
  };
}

export async function markStepComplete(
  slug: TutorialSlug,
  step: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, workspaceId, userId } = await getWorkspace();
  if (!workspaceId || !userId) return { ok: false, error: 'No autenticado' };

  const tutorial = getTutorial(slug);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tutorial_progress') as any)
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        tutorial_slug: slug,
        version: tutorial.version,
        current_step: step,
      },
      { onConflict: 'workspace_id,user_id,tutorial_slug' }
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markCompleted(
  slug: TutorialSlug
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, workspaceId, userId } = await getWorkspace();
  if (!workspaceId || !userId) return { ok: false, error: 'No autenticado' };

  const tutorial = getTutorial(slug);
  const lastStep = Math.max(0, tutorial.steps.length - 1);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tutorial_progress') as any)
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        tutorial_slug: slug,
        version: tutorial.version,
        current_step: lastStep,
        completed_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,user_id,tutorial_slug' }
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function markDismissed(
  slug: TutorialSlug
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, workspaceId, userId } = await getWorkspace();
  if (!workspaceId || !userId) return { ok: false, error: 'No autenticado' };

  const tutorial = getTutorial(slug);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tutorial_progress') as any)
    .upsert(
      {
        workspace_id: workspaceId,
        user_id: userId,
        tutorial_slug: slug,
        version: tutorial.version,
        dismissed_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,user_id,tutorial_slug' }
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function resetTutorial(
  slug: TutorialSlug
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { supabase, workspaceId, userId } = await getWorkspace();
  if (!workspaceId || !userId) return { ok: false, error: 'No autenticado' };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase.from('tutorial_progress') as any)
    .delete()
    .eq('workspace_id', workspaceId)
    .eq('user_id', userId)
    .eq('tutorial_slug', slug);

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
