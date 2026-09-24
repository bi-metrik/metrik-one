---
name: voto-entre-fuentes
description: #895 mergeado (voto entre fuentes, cruce coincide, DIAN sin dato en disputa, reprocesos en la tarjeta) y #896 SIN mergear (config SOENA con migración 20260924230000); V0012 queda sin poder generar formularios DIAN
metadata:
  type: project
---

2026-09-24. Brief `proyectos/soena/ve/2026-09-24_brief-max-blindaje-lectura-documentos.md`.

- **#895 (mergeado, código genérico, inerte sin config):** `votos.ts` (`config_extra.votos`), cruce `coincide` en `cruces.ts` + `comparar-valores.ts`, `disputa-generacion.ts` en `generarFormularioCore` (fail-closed), `corregirLecturaDudosa` (el valor lo decide el servidor), `campos.dv.leido` en `normalizarNitYDv`, reprocesos de `reproceso_eventos` en la tarjeta de datos clave, badge «Leído por IA» en vez del chulo verde.
- **#896 (SIN mergear, trae migración `20260924230000_soena_voto_documento_y_verificador_upme.sql`):** la aplica la sesión principal; orden indiferente (el código ya está en main).

**Why:** V0142: la IA leyó la casilla 26 del RUT mal (0.98) y la cédula errada salió en la declaración y la relación de facturas; factura y certificado traían la buena y nadie comparaba.

**How to apply:**
- ⚠️ **Las plantillas NO se unificaron a una fuente, a propósito:** 010/1668 leen `rut.nit` (casilla 5) y declaración/relación/carta `rut.numero_identificacion` (26). En cédula de extranjería (V0099, V0169, V0216, V0312, V0382) y V0012 difieren legítimamente. Lo que las ata: las dos casillas votan juntas cuando `tipo_documento` es cédula de ciudadanía.
- ⚠️ **V0012** (NIT 700004389 con CC 1015442918): con #896 aplicado no podrá generar formularios hasta que alguien edite a mano la casilla 5 (con el mismo valor basta: `edicion` la vuelve «confirmada»). Lo decide Deisy.
- **El DV guardado de los RUT existentes es tautológico** (se recalculó desde el NIT): el chequeo de DV solo sirve para extracciones nuevas (`leido`). `nit_completo` NO sirve de testigo: 28 de 148 traen el DV pegado dos veces. Leer el DV real de los RUT viejos exige re-extraer (script aparte con dry-run, no hecho).
- Simulación del 24-sep (439 abiertos): dudosas RUT 26 = 2 (V0142, V0355), RUT 5 = 1 (V0012), factura = 6, certificado = 1 (V0164), sin mayoría 0; niegan DIAN 3; frenan hoy V0291 (voto) y V0064, V0263 (cruces del certificado).
- Sin QA en pantalla. Script de simulación reutilizable: correr `evaluarVotos`/`evaluarCruces` con la config de la migración sobre una foto GET (`npx tsx --tsconfig tsconfig.json` desde el worktree resuelve `@/`).

Relacionado: [[datos-clave-cruces-titularidad]], [[nit-dv-y-retorno-reproceso]], [[confirmacion-nit-ciegas]].
