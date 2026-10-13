# LearnTrack — Agents & System Documentation

## Architecture & Codebase Map

| Component | Path | Description | Tech Stack |
|---|---|---|---|
| Frontend Web | `apps/web/` | Student & Staff UI, OCR document upload, Meetings & Calendar | React 18, Vite, React Router, TanStack Query, TailwindCSS |
| API Backend | `apps/api/` | Express REST API, SQLite Prisma, Google OAuth, Calendar, Gmail | Express, Prisma ORM, Zod, bcryptjs, Vitest |
| Shared Contracts | `packages/contracts/` | Source-of-truth Zod schemas and TypeScript interfaces | TypeScript, Zod |
| ML & OCR Service | `ml-delivery (3)/ml-delivery (2)/ml-delivery/` | Student risk prediction & Government of India BHASHINI OCR | Python 3.14, FastAPI, Scikit-Learn, HTTPX, Pytest |

---

## Operating Instructions for Autonomous Agents

1. **Security & Secrets:**
   - Never print or commit tokens, passwords, or `.env` files.
   - Use `.env.example` templates for documenting required variables.
   - All Google OAuth access tokens and refresh tokens remain strictly confined to the backend (`prisma.googleOAuthToken` in SQLite or backend environment variables).

2. **Integration Modes:**
   - `GOOGLE_INTEGRATION_MODE="LIVE"`: Calls real Google Cloud REST APIs (`calendar/v3` and `gmail/v1`).
   - `GOOGLE_INTEGRATION_MODE="MOCK"`: Simulates Calendar and Gmail responses with realistic latency and IDs for local offline development and automated testing.
   - Unit and integration tests must run in `MOCK` mode without contacting external third-party services.

3. **Privacy & Data Ethics:**
   - Advising meeting titles in Google Calendar must remain generic ("Academic Support Check-in").
   - Calendar descriptions and Gmail email subjects/bodies must never contain internal case reference numbers, student test marks, or confidential notes.

4. **Port Allocation:**
   - Port 4000: Node API server.
   - Port 5173 / 5174: Vite web application.
   - Port 8000: FastAPI ML & OCR server.
