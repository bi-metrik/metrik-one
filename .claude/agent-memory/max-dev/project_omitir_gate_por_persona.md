---
name: omitir-gate-por-persona
description: PR #696 mergeado 2026-09-14 — omitir gates con motivo ya no es solo owner/admin; lista por persona en config_extra.omitir_gate.staff_ids, inerte hasta que SOENA cargue el valor; choque de nombre con puedeOmitirGate
metadata:
  type: project
---

El override de `cambiarEtapaNegocioConGate` (avanzar con `motivoOverride` sobre gates
pendientes) acepta owner/admin **o** un `staff.id` en
`workspaces.config_extra.omitir_gate.staff_ids`. Criterio único en
`src/lib/permissions/omitir-gates.ts` → `puedeOmitirGatesConMotivo`. Mergeado el
2026-09-14 (#696, squash `03a21ffd`), sin migración.

**Why:** el dueño de SOENA pidió que una supervisora comercial pudiera saltarse etapas
como él; Mauricio decidió permiso por persona en vez de subirla a admin (el rol
arrastra todo lo demás en silencio). Retroceder NO entra.

**How to apply:**
- ⚠️ **Inerte hasta que alguien cargue la lista.** El código no escribió el valor (el
  brief lo prohibía): lo pone la sesión de soena. Si preguntan "por qué Daniela sigue
  sin ver el botón", mirar primero si la clave existe en `config_extra`.
- ⚠️ **Choque de nombre:** `puedeOmitirGate` (singular, `lib/negocios/gate-omitible.ts`)
  es OTRA cosa: dejar UN bloque en "no aplica" por área (`omitible_por`). La nueva es
  `puedeOmitirGatesConMotivo`. No fusionarlas.
- Antes de #696 el botón "Omitir gate (owner)" se pintaba a **todos** y el servidor
  rechazaba a quien no era owner/admin. Ahora `page.tsx` calcula `puedeOmitirGates` y
  el modal solo dibuja "Volver" a quien no puede.
- Guard y pantalla leen `config_extra` con `createServiceClient()` acotado al
  workspace de la sesión: la columna es server-only, y leerla con el cliente de sesión
  en un lado y de servicio en el otro abre la desincronización que la función única
  evita.
- No cubierto por prueba: el render del modal. Falta QA en pantalla con una persona en
  la lista. Emparentado con [[guard-bloque-items]].
