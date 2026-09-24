---
name: rut-prefijo-tipo-documento
description: PR #908 (código) y #909 (config, migración SIN aplicar) del 2026-09-24 — la casilla 26 del RUT con el «13» de la casilla 25 pegado; tolerar al comparar no es dar por buena la lectura; V0442 en copias y nit_completo con DV doble quedaron para el script
metadata:
  type: project
---

El «13» (o solo el «1») de la casilla 25 del RUT se pegaba delante de la casilla 26:
V0521 1380180688 por 80180688, V0177 132747706 por 32747706 (impreso ante la DIAN).
El #888 lo toleraba en `mismoDocumento` y el voto lo daba por «coincide». Mauricio lo
señaló con «Pilas con esas cosas».

**Why:** tolerar una forma al COMPARAR y proponer/imprimir el valor limpio son dos
decisiones distintas; el #888 solo tomó la primera.

**How to apply:**
- Criterio estricto en `src/lib/dian/prefijo-tipo-documento.ts` (`sinPrefijoDeTipo`):
  «13»+X, o «1»+X solo con total ≤ 9 dígitos. Más estricto que `mismoDocumento` a
  propósito: 1122456789 vs 122456789 no se sabe cuál es la buena. Testigo = otra lectura,
  nunca la forma del número.
- En el voto la lectura con prefijo es `dudosa` aunque esté editada a mano; la factura con
  DV pegado (verificado por módulo 11) `coincide`. `LecturaFuente.forma` lo dice.
- La guarda de generación (`guarda-prefijo-formulario.ts`) aplica a TODA plantilla, testigo
  26↔5 del mismo RUT, sobre lo que se imprime.
- `scripts/fix-prefijo-tipo-documento.ts` NO reescribe `campos_usados`: es la foto del PDF
  ya radicado; lo lista para regenerar. Simulación del 24-sep tras la corrección manual de
  la sesión principal: 0 en los 5 casos, V0442 (2 copias heredadas, 1330310866), 22 filas de
  `nit_completo` con DV doble en 11 negocios, revisar V0012/V0326/V0354/V0361.
- `nit_completo` no lo lee ningún código ni config (medido 24-sep); solo se limpia.
- #909 trae la migración de `descripcion_ai` (rut, rut_solicitante_2, nit_completo): NO
  mergear sin aplicarla.

Relacionado: [[voto-entre-fuentes]], [[datos-clave-cruces-titularidad]], [[nit-dv-y-retorno-reproceso]].
