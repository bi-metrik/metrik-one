// ============================================================
// W06 — Contacto Nuevo (§8)
// ============================================================

import type { HandlerContext } from '../../types.ts';
import { bold } from '../../wa-format.ts';
import { findContacts } from '../../wa-lookup.ts';

export async function handleContactoNuevo(ctx: HandlerContext): Promise<void> {
  const { parsed, user, supabase } = ctx;
  const { name, phone, role } = parsed.fields;

  if (!name) {
    await ctx.sendMessage('¿Cómo se llama el contacto?');
    await ctx.updateSession('collecting', {
      intent: 'CONTACTO_NUEVO', pending_action: 'W06',
      parsed_fields: parsed.fields,
    });
    return;
  }

  // Check for duplicates
  const duplicates = await findContacts(supabase, user.workspace_id, name, 3);
  const exactPhoneMatch = phone ? duplicates.find((d: any) => d.telefono === phone) : null;

  if (exactPhoneMatch) {
    await ctx.sendMessage(
      `⚠️ Ya existe un contacto con ese teléfono:\n\n👤 ${bold(exactPhoneMatch.nombre)} — ${exactPhoneMatch.telefono}\n\n1️⃣ Es la misma persona (no crear nuevo)\n2️⃣ Es diferente, crear contacto nuevo\n3️⃣ Cancelar`
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'CONTACTO_NUEVO', pending_action: 'W06',
      parsed_fields: parsed.fields,
      options: [
        { id: 'same', label: 'Es la misma persona' },
        { id: 'create', label: 'Crear nuevo' },
        { id: 'cancelar', label: 'Cancelar' },
      ],
    });
    return;
  }

  const similarName = duplicates.find((d: any) => d.nombre.toLowerCase().includes(name.toLowerCase().slice(0, 4)));
  if (similarName) {
    await ctx.sendMessage(
      `⚠️ Ya existe un contacto similar:\n\n👤 ${bold(similarName.nombre)} — ${similarName.telefono || 'sin teléfono'}\n\n1️⃣ Es la misma persona (no crear nuevo)\n2️⃣ Es diferente, crear contacto nuevo\n3️⃣ Cancelar`
    );
    await ctx.updateSession('awaiting_selection', {
      intent: 'CONTACTO_NUEVO', pending_action: 'W06',
      parsed_fields: parsed.fields,
      options: [
        { id: 'same', label: 'Es la misma persona' },
        { id: 'create', label: 'Crear nuevo' },
        { id: 'cancelar', label: 'Cancelar' },
      ],
    });
    return;
  }

  // No duplicates — confirm creation
  let msg = `👤 Nuevo contacto:\n\n📛 Nombre: ${bold(name)}`;
  if (phone) msg += `\n📱 Teléfono: ${phone}`;
  if (role) msg += `\n💼 Rol: ${role}`;
  if (!phone && !role) msg += '\n\nNo tengo teléfono ni email.';

  await ctx.sendButtons(msg, [
    { id: 'btn_confirm', title: '✅ Confirmar' },
    { id: 'btn_cancel', title: '❌ Cancelar' },
  ]);
  await ctx.updateSession('confirming', {
    intent: 'CONTACTO_NUEVO', pending_action: 'W06',
    parsed_fields: parsed.fields,
  });
}
