# Taller — módulo de CTRL+

Módulo de taller (flota, mantenimientos, combustibles, abastecimiento, fondos y partes
diarios). Se conecta a CTRL+ mediante el contrato `GET /api/module/manifest` y al ERP
general mediante un único punto de cruce (`server/bridge`, pendiente de fase 4).

## Requisitos

- Node.js 18+

## Desarrollo

```bash
npm install
npm run dev         # web en http://127.0.0.1:3100 y API en http://127.0.0.1:3101
```

- Sin `DATABASE_URL`, la API usa una base local (Postgres en PGlite, en `.data/pglite`):
  no hace falta instalar ni contratar nada. La primera vez se crea sola.
- Con `DATABASE_URL` (Postgres o Neon) la API usa esa base. Ver `.env.example`.
- `.env` con `AUTH_BYPASS=true` (ya creado en desarrollo) permite probar la API sin Clerk
  enviando las cabeceras `X-Dev-User: <cualquiera>` y
  `X-Dev-Company: 00000000-0000-4000-8000-000000000001` (empresa de ejemplo).
  Nunca se activa en producción.

Comandos separados: `npm run dev:web` y `npm run dev:api`.

## Pruebas y chequeos

```bash
npm test        # vitest: contrato del módulo, autenticación y aislamiento por empresa (RLS)
npm run lint    # tsc --noEmit
npm run build   # build de la web
```

## Estructura

```
src/client/   web (React 19, Tailwind)
src/server/   API (Express 4, Drizzle, Postgres con RLS)
src/shared/   dominio puro compartido (tipos, cálculos)
```

Reglas de límites: `shared` no importa de nadie; `client` y `server` solo de `shared`;
solo `server/bridge` habla con el ERP.
