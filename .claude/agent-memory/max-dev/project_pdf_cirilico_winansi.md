---
name: pdf-cirilico-winansi
description: Bloqueo de letras no latinas en TODO ONE (2026-10-06) — `texto-latino.ts` sin imports con copia EXACTA en `_shared/`; dobles se convierten, lo demás frena guardado, gate y 010; guarda de CI sobre drawText
metadata:
  type: project
---

Origen: la IA metió cirílico en el RUT (V0121 «В» por B tumbó el 010 con «WinAnsi cannot encode»;
«МЕЛА» por MEJIA) y el barrido halló griego («ΤΟ», «JOHΝ») y un contacto en cirílico por lead de Meta.
#1054 = arreglo mínimo del PDF; la pieza completa va en el PR del bloqueo.

`src/lib/texto/texto-latino.ts` es la regla única y NO importa nada: `supabase/functions/_shared/texto-latino.ts`
es copia byte a byte (la prueba `guarda-texto-pdf.test.ts` falla si se separan, y también si un
`drawText(` dibuja algo que no sea `textoParaPdf(...)` o una variable saneada listada).

Entradas cubiertas: extract-fields (marca `manual` + `letras_no_validas`), parse-rut, parse-ve-docs,
`sanearDataDelNavegador` + rechazo en actualizar/marcar bloque, `actualizarCampoDocumento`, contactos y
empresas (directorio y contactos legacy), `crearNegocioEnWorkspace`, lead de Meta, bot WA (texto del
equipo), XLSX de compliance/Valida. Frenos: guardar (campo oficial), avance de etapa (también con
override) y generación del formulario.

**Why:** «Л» no tiene doble: adivinar escribiría mal un nombre ante la DIAN. Solo LETRAS de otra escritura
frenan (un «→» o un emoji no); el PDF sí exige WinAnsi estricto aparte.

**How to apply:** entrada nueva de texto → `textoLatinoProfundo`/`formularioLatino` + `primerCampoOficialNoValido`;
PDF nuevo → `textoParaPdf`. Al tocar la pieza, copiar el archivo a `_shared/` y redesplegar
`wa-webhook` y `meta-leads-webhook`. Detección a pedido: `scripts/detectar-letras-no-latinas.sql`.
