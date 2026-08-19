// Sustituto de `server-only` y `client-only` cuando corren las pruebas.
//
// Los dos son marcadores: no exportan nada, solo existen para que el bundler
// reviente si un modulo de servidor termina en el cliente. Next los resuelve
// con un alias interno (por eso `next build` pasa) y NO estan en package.json
// ni en el lock, asi que vitest, que es vite pelado, no los encuentra y el
// archivo de prueba ni siquiera alcanza a colectar.
//
// Se aliasan aqui en vez de instalar el paquete para no agregar una dependencia
// de produccion que duplique lo que Next ya trae.
export {}
