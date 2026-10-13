# LearnTrack — Student Learning & Academic Advising Platform

LearnTrack is a comprehensive student success, performance analytics, academic document processing, and advising management platform.

---

## Architecture Overview

```
LearnTrack
├── apps/
│   ├── api/             # Node.js/Express TypeScript backend (Port 4000)
│   │   ├── prisma/      # SQLite database schema (dev.db) & seeds
│   │   ├── src/         # API routes, auth, RBAC, meetings & Google integration
│   │   └── test/        # Vitest backend integration test suite (25 tests)
│   └── web/             # React + Vite TypeScript frontend (Port 5173/5174)
│       ├── src/         # UI pages, Meeting Scheduler, OCR, and dashboard
│       └── test/        # Vitest end-to-end component tests (10 tests)
├── packages/
│   └── contracts/       # Shared Zod schemas, TypeScript types, and contracts
└── ml-delivery (3)/ml-delivery (2)/ml-delivery/
    ├── app/             # FastAPI ML service + BHASHINI OCR (Port 8000)
    └── tests/           # Pytest suite for ML prediction & OCR (23 tests)
```

---

## Features

1. **Academic Support & Case Management:**
   - Role-Based Access Control (RBAC) across Mentor, Faculty, Counsellor, Finance, HOD, and Student.
   - Student 360 profiling with consent-governed data protection (restricted notes never exposed inappropriately).
   - Early warning risk assessments with explainable indicators.

2. **Real Google Calendar Integration:**
   - Synchronizes advising meetings directly with Google Calendar via the Google Calendar API (`/v3/calendars/primary/events`).
   - Supports `Asia/Kolkata` timezone by default or custom student timezones.
   - Privacy-safe event titles ("Academic Support Check-in") and descriptions that never expose internal case refs, student marks, or confidential notes.
   - Generates Google Meet links (`hangoutsMeet`) when conference data is supported.
   - Tracks Google Event ID, sync status (`SYNCED`, `PENDING`, `FAILED`), and error details with retry support.

3. **Gmail Meeting Notifications:**
   - Sends formatted advising appointment notifications via the Gmail API (`/gmail/v1/users/me/messages/send`).
   - Uses verified recipient addresses from student records—never invents addresses.
   - Includes appointment title, formatted date/time, timezone, organiser, and rescheduling/cancellation instructions.
   - Independent status tracking (`SENT`, `PENDING`, `FAILED`, `UNAVAILABLE`) preserving partial success when Calendar succeeds and email fails.
   - Idempotent and duplicate-safe: retries do not send duplicate emails.

4. **BHASHINI OCR Integration & Document Parsing:**
   - Government of India BHASHINI Dhruva pipeline integration (`bhashini/bodhan/indic-doc/ocr`).
   - Dynamic document parsing for student marks, roll numbers, exams, and attendance.
   - Tamper-proof SHA-256 canonical cryptographic document hashing.

---

## Environment & Configuration

### API Backend (`apps/api/.env`)
Copy from `apps/api/.env.example`:
```env
NODE_ENV=development
PORT=4000
DATABASE_URL="file:./dev.db"
SESSION_SECRET="replace-with-a-long-random-session-secret-in-production"
SESSION_EXPIRY_HOURS=24
DEMO_PASSWORD="demo-password"
ML_MODE="MOCK"
ML_SERVICE_URL="http://127.0.0.1:8000"
ML_TIMEOUT_MS=4000

# Google Calendar & Gmail Integration
GOOGLE_INTEGRATION_MODE="MOCK" # Set to "LIVE" for real Google Cloud APIs
GOOGLE_CLIENT_ID="your-client-id.apps.googleusercontent.com"
GOOGLE_CLIENT_SECRET="your-client-secret"
GOOGLE_REDIRECT_URI="http://localhost:4000/api/integrations/google/callback"
GOOGLE_REFRESH_TOKEN=""
GOOGLE_SENDER_EMAIL="advising@learntrack.edu"
```

### ML & OCR Service (`ml-delivery (3)/ml-delivery (2)/ml-delivery/.env`)
```env
BHASHINI_OCR_URL=https://dhruva-api.bhashini.gov.in/services/inference/pipeline
BHASHINI_INFERENCE_API_KEY=your_bhashini_api_key_here
BHASHINI_OCR_LANGUAGE=hi
BHASHINI_OCR_SERVICE_ID=bhashini/bodhan/indic-doc/ocr
MAX_IMAGE_UPLOAD_MB=5
```

---

## One-Time Google Cloud Setup (For LIVE Mode)

1. Open [Google Cloud Console](https://console.cloud.google.com/) and create a project (e.g., `LearnTrack`).
2. Enable APIs:
   - **Google Calendar API**
   - **Gmail API**
3. Configure the **OAuth consent screen**:
   - User Type: External (or Internal for Google Workspace).
   - Add scopes:
     - `https://www.googleapis.com/auth/calendar.events`
     - `https://www.googleapis.com/auth/gmail.send`
     - `openid`
     - `email`
     - `profile`
   - In Testing mode, add test user Google accounts.
4. Create **OAuth 2.0 Client ID**:
   - Application type: Web application.
   - Authorized redirect URIs:
     `http://localhost:4000/api/integrations/google/callback`
5. Place the Client ID and Client Secret in `apps/api/.env` and set `GOOGLE_INTEGRATION_MODE=LIVE`.
6. Open the Meetings page (`/meetings`) and click **Authorize Google** to complete one-time consent.

---

## Running the Application on Windows

### 1. Start the API Backend (Port 4000)
```powershell
npm run dev:api
```
*(If port 4000 is occupied by a stale process, check `netstat -ano | findstr 4000` and stop the conflicting PID).*

### 2. Start the Frontend (Port 5173 / 5174)
```powershell
npm run dev:web
```
Open `http://localhost:5173/` (or `http://localhost:5174/` if 5173 is busy).

### 3. Start the ML & OCR Backend (Port 8000)
```powershell
cd "ml-delivery (3)\ml-delivery (2)\ml-delivery"
python -m uvicorn app.main:app --reload --port 8000
```
Swagger UI: `http://127.0.0.1:8000/docs`

---

## Running Automated Tests

- **API Backend Tests (25 tests):**
  ```powershell
  npm run test --workspace=@learntrack/api
  ```
- **Web Frontend Tests (10 tests):**
  ```powershell
  npm run test --workspace=@learntrack/web
  ```
- **Typecheck:**
  ```powershell
  npm run typecheck
  ```
- **ML & OCR Tests (23 tests):**
  ```powershell
  cd "ml-delivery (3)\ml-delivery (2)\ml-delivery"
  python -m pytest
  ```

Total automated test coverage: **58 automated tests passing (100% green)**.
