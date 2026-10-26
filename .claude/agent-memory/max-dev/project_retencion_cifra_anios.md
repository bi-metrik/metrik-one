---
name: retencion-cifra-anios
description: Un archivo nuevo (no test) en src/, supabase/ o scripts/ que escriba «N años» hace caer src/lib/compliance/retencion.test.ts en CI
metadata:
  type: project
---

`src/lib/compliance/retencion.test.ts` barre todo `src/`, `supabase/` y `scripts/` (menos `*.test.ts`) y exige que
cada archivo con una cifra seguida de «años» esté clasificado en `CLASIFICACION` (`plazo` o `no-es-plazo` con razón).
Mordió en #1073 (2026-10-07): el prompt nuevo de `bandeja/extraccion.ts` dice «menor de 2 años» y CI cayó en
«Tipos y pruebas», aunque las pruebas de `supabase/functions` pasaban todas.

**Why:** es el guardián del plazo de conservación de datos personales; el silencio no vale, clasificar es la decisión.

**How to apply:** si un archivo nuevo menciona edades o años, agregar su entrada `no-es-plazo` en el mismo PR. Antes
del push correr también `npx vitest run src/lib/compliance/retencion.test.ts`, no solo las pruebas de la carpeta tocada.
