import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db.js";
import {
  MeetingRecordSchema,
  GoogleIntegrationStatusSchema,
  createPaginatedSchema,
} from "@learntrack/contracts";
import {
  generateOAuthState,
  verifyOAuthState,
  createGoogleCalendarEvent,
  sendGmailMeetingNotification,
} from "../src/services/googleService.js";

const app = createApp();

async function loginAs(email: string) {
  const agent = request.agent(app);
  const csrfRes = await agent.get("/api/auth/csrf");
  const csrfToken = csrfRes.body.csrfToken;
  const loginRes = await agent
    .post("/api/auth/login")
    .set("X-CSRF-Token", csrfToken)
    .send({ email, password: "demo-password" });
  return { agent, csrfToken, user: loginRes.body };
}

describe("Google Calendar & Gmail Real Integration Tests", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  it("1. OAuth state token is cryptographically signed and expires", () => {
    const userId = "U-TEST-123";
    const state = generateOAuthState(userId);
    expect(typeof state).toBe("string");

    const verifiedUserId = verifyOAuthState(state);
    expect(verifiedUserId).toBe(userId);

    // Tampered state fails verification
    const tampered = state.slice(0, -4) + "XXXX";
    expect(verifyOAuthState(tampered)).toBeNull();

    // Invalid base64 fails verification
    expect(verifyOAuthState("not-a-valid-state")).toBeNull();
  });

  it("2. Validates meeting start and end times (rejects invalid intervals)", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");

    // End time before start time
    const invalidIntervalRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: "2026-10-20T11:00:00.000Z",
        endIso: "2026-10-20T10:00:00.000Z", // Earlier than start
        timezone: "Asia/Kolkata",
      });
    expect(invalidIntervalRes.status).toBe(400);
    expect(invalidIntervalRes.body.error.code).toBe("INVALID_INTERVAL");

    // Invalid ISO date
    const invalidDateRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: "not-a-date",
        endIso: "also-not-a-date",
        timezone: "Asia/Kolkata",
      });
    expect(invalidDateRes.status).toBe(400);
  });

  it("3. Rejects meeting scheduling for non-existent student", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");

    const notFoundRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-NONEXISTENT-999",
        startIso: "2026-10-22T10:00:00.000Z",
        endIso: "2026-10-22T10:30:00.000Z",
        timezone: "Asia/Kolkata",
      });
    expect(notFoundRes.status).toBe(404);
    expect(notFoundRes.body.error.code).toBe("STUDENT_NOT_FOUND");
  });

  it("4. Prevents duplicate meeting scheduling within a short window", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");
    const uniqueDay = Math.floor(10 + Math.random() * 15);
    const uniqueStartIso = `2026-11-${uniqueDay}T14:00:00.000Z`;
    const uniqueEndIso = `2026-11-${uniqueDay}T14:30:00.000Z`;

    const firstRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: uniqueStartIso,
        endIso: uniqueEndIso,
        timezone: "Asia/Kolkata",
      });
    expect(firstRes.status).toBe(201);

    // Duplicate submission with same participant and start time
    const duplicateRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: uniqueStartIso,
        endIso: uniqueEndIso,
        timezone: "Asia/Kolkata",
      });
    expect(duplicateRes.status).toBe(409);
    expect(duplicateRes.body.error.code).toBe("DUPLICATE_MEETING");
  });

  it("5. Non-staff (student) is forbidden from scheduling meetings", async () => {
    const { agent, csrfToken } = await loginAs("student@learntrack.edu");

    const forbiddenRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: "2026-10-25T10:00:00.000Z",
        endIso: "2026-10-25T10:30:00.000Z",
        timezone: "Asia/Kolkata",
      });
    expect(forbiddenRes.status).toBe(403);
  });

  it("6. Calendar event creation and Gmail notification dispatch succeed in MOCK mode", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");

    const createRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: "2026-10-28T09:00:00.000Z",
        endIso: "2026-10-28T09:30:00.000Z",
        timezone: "Asia/Kolkata",
        caseId: "C-104",
      });

    expect(createRes.status).toBe(201);
    expect(MeetingRecordSchema.safeParse(createRes.body).success).toBe(true);
    expect(createRes.body.syncStatus).toBe("SYNCED");
    expect(createRes.body.googleEventId).toBeDefined();
    expect(createRes.body.notificationStatus).toBe("SENT");
    expect(createRes.body.title).toBe("Academic Support Check-in");
  });

  it("7. Handles Calendar success with Gmail failure (preserves partial success)", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");

    // Temporarily set student S-107 email to null
    await prisma.student.update({
      where: { id: "S-107" },
      data: { email: null },
    });

    try {
      const createRes = await agent
        .post("/api/meetings")
        .set("X-CSRF-Token", csrfToken)
        .send({
          participantId: "S-107",
          startIso: "2026-10-29T11:00:00.000Z",
          endIso: "2026-10-29T11:30:00.000Z",
          timezone: "Asia/Kolkata",
        });

      expect(createRes.status).toBe(201);
      expect(createRes.body.syncStatus).toBe("SYNCED");
      // Gmail notification unavailable because student has no email
      expect(createRes.body.notificationStatus).toBe("UNAVAILABLE");
      expect(createRes.body.notificationError).toContain("No verified email");
    } finally {
      // Restore S-107 email
      await prisma.student.update({
        where: { id: "S-107" },
        data: { email: "zoya.farooqi@learntrack.edu" },
      });
    }
  });

  it("8. Re-syncing and patching meeting retains data and allows calendar updates", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");

    const createRes = await agent
      .post("/api/meetings")
      .set("X-CSRF-Token", csrfToken)
      .send({
        participantId: "S-104",
        startIso: "2026-10-30T15:00:00.000Z",
        endIso: "2026-10-30T15:30:00.000Z",
        timezone: "Asia/Kolkata",
      });
    expect(createRes.status).toBe(201);
    const meetingId = createRes.body.id;

    // Patch with resync: true
    const patchRes = await agent
      .patch(`/api/meetings/${meetingId}`)
      .set("X-CSRF-Token", csrfToken)
      .send({ resync: true });

    expect(patchRes.status).toBe(200);
    expect(patchRes.body.syncStatus).toBe("SYNCED");

    // Patch with updated time
    const rescheduleRes = await agent
      .patch(`/api/meetings/${meetingId}`)
      .set("X-CSRF-Token", csrfToken)
      .send({
        startIso: "2026-10-30T16:00:00.000Z",
        endIso: "2026-10-30T16:30:00.000Z",
        resync: true,
      });

    expect(rescheduleRes.status).toBe(200);
    expect(rescheduleRes.body.startIso).toBe("2026-10-30T16:00:00.000Z");
  });

  it("9. Google Integration status endpoint returns valid contract shape and manages connect/disconnect", async () => {
    const { agent, csrfToken } = await loginAs("mentor@learntrack.edu");

    const statusRes = await agent.get("/api/integrations/google/status");
    expect(statusRes.status).toBe(200);
    expect(GoogleIntegrationStatusSchema.safeParse(statusRes.body).success).toBe(true);

    const disconnectRes = await agent
      .post("/api/integrations/google/disconnect")
      .set("X-CSRF-Token", csrfToken)
      .send({});
    expect(disconnectRes.status).toBe(200);
    expect(disconnectRes.body.connected).toBe(false);

    const connectRes = await agent
      .post("/api/integrations/google/connect")
      .set("X-CSRF-Token", csrfToken)
      .send({});
    expect(connectRes.status).toBe(200);
    expect(connectRes.body.connected).toBe(true);
  });

  it("10. Google OAuth callback rejects missing or invalid state parameters", async () => {
    const res = await request(app).get("/api/integrations/google/callback");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("MISSING_OAUTH_PARAMS");

    const invalidStateRes = await request(app)
      .get("/api/integrations/google/callback?code=mock_code&state=invalid_tampered_state")
      .set("Accept", "application/json");
    expect(invalidStateRes.status).toBe(400);
    expect(invalidStateRes.body.error.code).toBe("OAUTH_CALLBACK_FAILED");
  });
});
