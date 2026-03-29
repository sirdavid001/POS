# QuickPOS

QuickPOS is a full-stack point-of-sale application built as an npm workspace monorepo. It includes a Vite-powered frontend, an Express + PostgreSQL backend, shared workspace code, Docker support, JWT authentication, role-based access, reporting, inventory management, offline order queueing, barcode scanning, and real-time dashboard updates over WebSockets.

## Features

- POS terminal with cart management, receipt printing, and checkout flows
- Role-based authentication for `admin`, `manager`, and `cashier`
- Product, category, customer, inventory, supplier, and order management
- Sales reporting with dashboard metrics and Chart.js visualizations
- Barcode support through camera scanning and USB/Bluetooth scanners
- Offline-friendly frontend with PWA support and queued local sales sync
- Real-time order updates via WebSockets
- Paystack payment initialization and verification endpoints
- Dockerized local environment for PostgreSQL, API, and frontend

## Monorepo Layout

```text
.
|- package.json
|- docker-compose.yml
|- packages/
|  |- client/   # Vite frontend
|  |- server/   # Express API + PostgreSQL access
|  `- shared/   # shared constants/utilities
`- .env.example
```

## Tech Stack

- Frontend: Vite, Tailwind CSS v4, Chart.js, `vite-plugin-pwa`, `html5-qrcode`
- Backend: Node.js, Express, PostgreSQL, `pg`, JWT, `bcryptjs`, `ws`, `zod`
- Tooling: npm workspaces, `concurrently`, Docker Compose

## Requirements

- Node.js 20+
- npm 10+
- PostgreSQL 16+ for local development
- Docker Desktop or Docker Engine if you want the containerized setup

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Create a local `.env` from the example file:

```bash
cp .env.example .env
```

Important values:

- `DATABASE_URL` should point to your PostgreSQL instance
- `JWT_SECRET` and `JWT_REFRESH_SECRET` should be replaced before production use
- `VITE_API_URL` defaults to `http://localhost:3001/api/v1`
- `VITE_WS_URL` defaults to `ws://localhost:3001`
- `PAYSTACK_*` keys are required only if you want Paystack enabled

### 3. Start PostgreSQL

If you already have PostgreSQL running locally, update `.env` and skip this step.

To run only the database with Docker:

```bash
docker compose up -d postgres
```

### 4. Run migrations and seed data

```bash
npm run db:migrate
npm run db:seed
```

This creates the schema and sample data, including a default admin user:

- Email: `admin@posapp.com`
- Password: `admin123`

### 5. Start the app in development

```bash
npm run dev
```

This starts:

- API server: `http://localhost:3001`
- Frontend: `http://localhost:5173`
- WebSocket endpoint: `ws://localhost:3001/ws`

The Vite dev server proxies `/api` and `/ws` traffic to the backend automatically.

## Docker Workflow

To run the full stack with Docker Compose:

```bash
docker compose up --build
```

The compose file starts:

- PostgreSQL on `localhost:5432`
- API server on `localhost:3001`
- Frontend on `localhost:5173`

After the containers are up, run the database setup once:

```bash
docker compose exec server node packages/server/src/db/migrate.js
docker compose exec server node packages/server/src/db/seed.js
```

## Available Scripts

### Root

```bash
npm run dev
npm run build
npm run lint
npm run test
npm run db:migrate
npm run db:seed
```

### Server workspace

```bash
npm run dev -w packages/server
npm run start -w packages/server
npm run db:migrate -w packages/server
npm run db:seed -w packages/server
npm run admin:ensure -w packages/server
```

### Client workspace

```bash
npm run dev -w packages/client
npm run build -w packages/client
npm run preview -w packages/client
```

## API Overview

The backend exposes versioned routes under `/api/v1`.

- `/auth` for login, registration, token refresh, logout, and profile
- `/products`, `/categories`, `/customers`, `/orders` for core POS data
- `/inventory` for stock adjustments, logs, suppliers, and purchase orders
- `/payments` for payment recording and Paystack flows
- `/reports` for revenue, sales, top products, and recent order summaries
- `/settings` for store settings and staff management

Health checks are available at:

- `GET /`
- `GET /health`
- `GET /api/health`

## Notes

- The frontend stores auth tokens and offline order queues in `localStorage`
- Dashboard updates can refresh in real time when new orders are created
- The backend can use `DATABASE_URL` directly or derive a connection string from `POSTGRES_*` or `PG*` variables
- Paystack is wired in; Stripe keys exist in config but Stripe flows are not implemented in this repo yet

## Production Considerations

- Replace all default secrets before deployment
- Restrict CORS with a real `CORS_ORIGIN`
- Use managed PostgreSQL and SSL-enabled connection strings in production
- Rotate seeded credentials or remove them entirely after initial setup

