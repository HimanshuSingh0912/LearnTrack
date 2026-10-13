# LearnTrack — Next Steps & Action Guide

This guide details the exact steps for configuring real Google Calendar and Gmail access, as well as operational procedures for future sessions.

---

## 1. One-Time Google Cloud Project Configuration (For LIVE Mode)

When you are ready to transition from development `MOCK` mode to live Google synchronization:

### Step 1: Create or Select a Google Cloud Project
1. Visit the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project named **LearnTrack** (or choose an existing one).

### Step 2: Enable the APIs
In **APIs & Services > Library**, search for and enable:
- **Google Calendar API**
- **Gmail API**

### Step 3: Configure the OAuth Consent Screen
1. Go to **APIs & Services > OAuth consent screen**.
2. Select User Type: **External** (for personal Gmail accounts) or **Internal** (if using Google Workspace).
3. Fill in:
   - App name: `LearnTrack Advising`
   - User support email: your email
   - Developer contact email: your email
4. Under **Scopes**, add:
   - `https://www.googleapis.com/auth/calendar.events` (Manage calendar events)
   - `https://www.googleapis.com/auth/gmail.send` (Send emails on user's behalf)
   - `openid`, `email`, `profile`
5. Under **Test users** (if in Testing status):
   - Add your Gmail address (e.g. the account you will log in with).

### Step 4: Create OAuth 2.0 Credentials
1. Go to **APIs & Services > Credentials**.
2. Click **Create Credentials > OAuth client ID**.
3. Application type: **Web application**.
4. Name: `LearnTrack Local Dev`.
5. Under **Authorized redirect URIs**, add:
   ```
   http://localhost:4000/api/integrations/google/callback
   ```
6. Click **Create** and copy your **Client ID** and **Client Secret**.

### Step 5: Update `apps/api/.env`
Open `apps/api/.env` and add:
```env
GOOGLE_INTEGRATION_MODE=LIVE
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:4000/api/integrations/google/callback
```

### Step 6: Perform One-Time User Authorization
1. Start the API (`npm run dev:api`) and Web (`npm run dev:web`).
2. Log in as an advisor or mentor (e.g., `mentor@learntrack.edu`).
3. Navigate to **Meetings & Calendar Integration** (`/meetings`).
4. Click **Authorize Google** and approve Google Calendar and Gmail permissions on the Google consent page.
5. Google will redirect back to LearnTrack, securely saving the access and refresh tokens.

---

## 2. Daily Local Development Commands

### Start All Services:
- **Terminal 1 — API Backend:**
  ```powershell
  npm run dev:api
  ```
- **Terminal 2 — Web Frontend:**
  ```powershell
  npm run dev:web
  ```
- **Terminal 3 — Python ML & BHASHINI OCR:**
  ```powershell
  cd "ml-delivery (3)\ml-delivery (2)\ml-delivery"
  python -m uvicorn app.main:app --reload --port 8000
  ```

### Run All Test Suites:
- Backend: `npm run test --workspace=@learntrack/api`
- Frontend: `npm run test --workspace=@learntrack/web`
- Typecheck: `npm run typecheck`
- ML & OCR: `python -m pytest` in `ml-delivery (3)\ml-delivery (2)\ml-delivery`
