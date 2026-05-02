# Top10All API

Backend Node.js + TypeScript + Prisma + JWT

## Setup

1. Copie `.env.example` para `.env` e configure PostgreSQL
2. `npm install`
3. `npm run prisma:generate`
4. `npm run prisma:migrate` (precisa database configurado)
5. `npm run dev`

## Endpoints

- POST /auth/register
- POST /auth/login
- GET  /categorias (JWT)
- POST /categorias (JWT)

## Observações

- `log_api` registra todas as rotas com IP e user-agent
- `usuario.senha` é hash bcrypt
- `JWT_SECRET` deve ser uma chave forte
