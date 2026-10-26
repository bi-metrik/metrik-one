// ============================================================
// Trabajo DESPUÉS de responder, con un resultado que alguien puede esperar.
//
// `src/lib/siigo/segundo-plano.ts` agenda tareas sin resultado (el abono, el RC-3). Aquí
// la tarea sí devuelve algo, y quién lo usa depende de dónde corre:
//   · Dentro de un request (server action, ruta): se agenda con `after()` de Next, que
//     corre cuando la respuesta ya salió, en la misma invocación (Vercel la mantiene viva
//     con `waitUntil`). El llamador NO espera: el resultado lo persiste la propia tarea.
//   · Fuera de un request (script, prueba): `after()` lanza; la tarea corre EN LÍNEA y el
//     llamador recibe la promesa para esperarla, como antes de mover nada a segundo plano.
//
// ⚠️ Lo agendado sigue sujeto al `maxDuration` de la función que lo agenda: `after()` no
// compra tiempo, solo libera a quien espera la respuesta.
//
// Server-only.
// ============================================================

import { after } from 'next/server'

export type Agendado<T> = { agendado: true } | { agendado: false; resultado: Promise<T> }

export function despuesDeResponder<T>(etiqueta: string, tarea: () => Promise<T>): Agendado<T> {
  try {
    after(async () => {
      try {
        await tarea()
      } catch (e) {
        // La tarea debería persistir su propio error; esto es la red de seguridad para que
        // un fallo no se pierda como rechazo sin dueño.
        console.error(`[segundo-plano] ${etiqueta} falló:`, (e as Error)?.message ?? e)
      }
    })
    return { agendado: true }
  } catch {
    return { agendado: false, resultado: tarea() }
  }
}
