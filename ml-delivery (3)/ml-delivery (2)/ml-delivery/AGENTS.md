# LearnTrack Project Rules & Architecture Instructions

Welcome to the **LearnTrack** codebase. This document outlines permanent architecture rules, safety boundaries, coding conventions, and operational workflows for autonomous and paired development.

---

## 1. Project Overview & Working Paths

- **Python Backend / ML Delivery Root:**
  `C:\Users\himan\a21\LearnTrack\ml-delivery (3)\ml-delivery (2)\ml-delivery`
- **Monorepo Root:**
  `C:\Users\himan\a21\LearnTrack`
- **Frontend App (React / Vite):**
  `C:\Users\himan\a21\LearnTrack\apps\web`
- **Node/Express API (if used):**
  `C:\Users\himan\a21\LearnTrack\apps\api`

---

## 2. Core Architecture Principles

1. **Maintain Prediction Contract Integrity:**
   - The ML service endpoint `POST /predict` accepts time-series student observations and returns risks/intervention suggestions.
   - Do not break, rename, or arbitrarily alter schemas in `app/schemas.py` or prediction logic in `app/predictor.py`.
2. **BHASHINI OCR Integration:**
   - External service uses the verified endpoint:
     `https://dhruva-api.bhashini.gov.in/services/inference/pipeline`
   - Active working service ID: `bhashini/bodhan/indic-doc/ocr`.
   - Never hardcode API keys or print them in logs, error payloads, or markdown files.
   - External requests must always specify finite timeouts (default 60s).
   - Upstream service failures return a clean HTTP 502 with sanitized descriptions.
3. **Dynamic Student Document Parsing:**
   - Never assume fixed layouts, uniform school names, or fixed subject lists.
   - Always extract text dynamically, preserve raw OCR output, and identify ambiguous or unparsed fields for human review.
   - Never fabricate roll numbers, student names, marks, or attendance data.
4. **Data Persistence & Local Storage:**
   - Use lightweight, local, maintainable storage (SQLite / JSON storage) with unique document identifiers and duplicate detection.
   - Never silently overwrite records belonging to another student.
5. **Testing & Quality Assurance:**
   - Automated test suite must run using `python -m pytest`.
   - All tests must pass deterministically without depending on a live internet connection (use mocks for external HTTP APIs).
   - Never delete tests, weaken assertions, or hardcode artificial responses to make tests pass.

---

## 3. Secret Management & Git Hygiene

- Keep secrets strictly in `.env`.
- Ensure `.gitignore` at root ignores `.env`, `__pycache__`, virtualenvs, and sensitive tokens.
- Maintain `.env.example` with placeholders only.

---

## 4. Common Execution Commands

From `C:\Users\himan\a21\LearnTrack\ml-delivery (3)\ml-delivery (2)\ml-delivery`:

- **Run Server:** `python -m uvicorn app.main:app --reload`
- **Run Tests:** `python -m pytest`
- **Retrain Model (if necessary):** `python -m scripts.train`
