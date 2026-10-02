---
name: build-en-worktree
description: Cómo correr next build / vitest en un worktree aislado cuando el node_modules del repo principal no tiene una dependencia nueva (p. ej. unpdf)
metadata:
  type: reference
---

El `node_modules` del repo principal puede ir atrás de `package.json` de `origin/main` (2026-10-02:
faltaba `unpdf`, 18 archivos de prueba y el build caían por eso, no por el cambio).

Receta sin tocar el repo principal:
1. `node_modules` del worktree como DIRECTORIO real con un symlink por entrada del principal
   (`ln -s <main>/node_modules/* <main>/node_modules/.[!.]* node_modules/`).
2. Instalar la dependencia que falta en el scratchpad (`npm install <pkg>`) y **copiarla** (no
   symlink) a `node_modules/<pkg>`: Turbopack toma como raíz el repo principal (dos lockfiles) y no
   resuelve un symlink que apunte fuera de ella.
3. Borrar `node_modules` y `.env.local` del worktree al cerrar.
