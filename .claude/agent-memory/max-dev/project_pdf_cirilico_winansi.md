---
name: pdf-cirilico-winansi
description: La IA mete letras cirílicas en el RUT (В por B, «МЕЛА» por MEJIA); el 010/1668 se caía con «WinAnsi cannot encode». Dobles exactos se convierten, el resto se nombra (2026-10-06)
metadata:
  type: project
---

`src/lib/texto/caracteres-pdf.ts` es la regla única: `aLetraLatina` (dobles exactos cirílico/griego →
latín), `textoParaPdf` (lanza `CaracterNoImprimibleError` con mensaje para la persona) y
`revisarLetrasLeidas` (la extracción manda el campo a revisión, `manual: true` con el valor visible y
`letras_no_validas`). `sanitize()` de `acroform.ts` la usa; `generarFormulario` valida `datosFinal` con
`datosParaPdf` y nombra el campo.

**Why:** «Л» no tiene doble (la IA convierte «JI» en «Л»): adivinar escribiría mal un nombre ante la DIAN.

**How to apply:** todo PDF nuevo con `StandardFonts` estampa por `sanitize`/`textoParaPdf`, nunca el
texto crudo. Los datos malos de V0121, V0143 y V0167 NO se corrigieron (los corrige la persona o
Mauricio). Relacionado: [[formulario-010-dian]].
