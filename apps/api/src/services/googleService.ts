import crypto from "crypto";
import { env } from "../config/env.js";
import { prisma } from "../db.js";

export interface GoogleTokenInfo {
  accessToken: string;
  refreshToken?: string | null;
  expiryDate?: Date | null;
  scope?: string | null;
  userEmail?: string | null;
}

export interface CalendarEventResult {
  success: boolean;
  eventId?: string;
  meetLink?: string;
  htmlLink?: string;
  error?: string;
}

export interface GmailNotificationResult {
  success: boolean;
  messageId?: string;
  error?: string;
  recipientEmail?: string;
}

const STATE_SECRET = env.SESSION_SECRET || "google-oauth-state-secret-2026";

/**
 * Generates an HMAC-signed state token containing user ID and expiration timestamp
 */
export function generateOAuthState(userId: string): string {
  const payload = JSON.stringify({
    userId,
    timestamp: Date.now(),
    nonce: crypto.randomBytes(8).toString("hex"),
  });
  const hmac = crypto
    .createHmac("sha256", STATE_SECRET)
    .update(payload)
    .digest("hex");
  return Buffer.from(JSON.stringify({ payload, hmac })).toString("base64url");
}

/**
 * Verifies and parses the OAuth state token. Returns userId if valid, null if invalid or expired.
 */
export function verifyOAuthState(stateStr: string): string | null {
  try {
    const raw = Buffer.from(stateStr, "base64url").toString("utf-8");
    const { payload, hmac } = JSON.parse(raw);
    const expectedHmac = crypto
      .createHmac("sha256", STATE_SECRET)
      .update(payload)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(hmac), Buffer.from(expectedHmac))) {
      return null;
    }
    const data = JSON.parse(payload) as { userId: string; timestamp: number };
    // State valid for 15 minutes
    if (Date.now() - data.timestamp > 15 * 60 * 1000) {
      return null;
    }
    return data.userId;
  } catch {
    return null;
  }
}

/**
 * Returns the Google OAuth 2.0 authorization URL
 */
export function getGoogleAuthorizationUrl(userId: string): string {
  const state = generateOAuthState(userId);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID || "",
    redirect_uri: env.GOOGLE_REDIRECT_URI,
    response_type: "code",
    scope: [
      "https://www.googleapis.com/auth/calendar.events",
      "https://www.googleapis.com/auth/gmail.send",
      "openid",
      "email",
      "profile",
    ].join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchanges authorization code for tokens and saves them in the database
 */
export async function handleGoogleOAuthCallback(
  code: string,
  state: string
): Promise<{ success: boolean; userEmail?: string; error?: string }> {
  const userId = verifyOAuthState(state);
  if (!userId) {
    return {
      success: false,
      error: "INVALID_STATE: OAuth state verification failed or state expired.",
    };
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return {
      success: false,
      error:
        "CONFIGURATION_ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.",
    };
  }

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_CLIENT_ID,
        client_secret: env.GOOGLE_CLIENT_SECRET,
        redirect_uri: env.GOOGLE_REDIRECT_URI,
        grant_type: "authorization_code",
      }).toString(),
    });

    const tokenData = (await tokenRes.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      error?: string;
      error_description?: string;
    };

    if (!tokenRes.ok || !tokenData.access_token) {
      return {
        success: false,
        error:
          tokenData.error_description ||
          tokenData.error ||
          "Failed to exchange OAuth code for tokens.",
      };
    }

    // Retrieve userinfo to record the connected Google email
    let userEmail: string | null = null;
    try {
      const userInfoRes = await fetch(
        "https://www.googleapis.com/oauth2/v3/userinfo",
        {
          headers: { Authorization: `Bearer ${tokenData.access_token}` },
        }
      );
      if (userInfoRes.ok) {
        const userInfo = (await userInfoRes.json()) as { email?: string };
        userEmail = userInfo.email ?? null;
      }
    } catch {
      // Non-fatal if userinfo fails
    }

    const expiryDate = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000)
      : null;

    // Upsert token in database
    await prisma.googleOAuthToken.upsert({
      where: { userId },
      update: {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? undefined,
        scope: tokenData.scope,
        userEmail: userEmail ?? undefined,
        expiryDate,
      },
      create: {
        id: `GTOKEN-${userId}`,
        userId,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token ?? null,
        scope: tokenData.scope ?? null,
        userEmail: userEmail ?? null,
        expiryDate,
      },
    });

    return { success: true, userEmail: userEmail ?? undefined };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unexpected error during Google OAuth exchange.",
    };
  }
}

/**
 * Retrieves a valid Google access token, automatically refreshing it if expired
 */
export async function getValidAccessToken(
  userId?: string
): Promise<{ accessToken: string; userEmail?: string } | null> {
  // Check database first
  let tokenRecord = userId
    ? await prisma.googleOAuthToken.findUnique({ where: { userId } })
    : null;

  if (!tokenRecord) {
    // Check if any connected token exists
    tokenRecord = await prisma.googleOAuthToken.findFirst({
      orderBy: { updatedAt: "desc" },
    });
  }

  // If found in DB
  if (tokenRecord) {
    const isExpired =
      tokenRecord.expiryDate &&
      tokenRecord.expiryDate.getTime() - 60000 < Date.now();

    if (!isExpired) {
      return {
        accessToken: tokenRecord.accessToken,
        userEmail: tokenRecord.userEmail ?? undefined,
      };
    }

    // Refresh if refresh token available
    if (tokenRecord.refreshToken && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET) {
      try {
        const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: env.GOOGLE_CLIENT_ID,
            client_secret: env.GOOGLE_CLIENT_SECRET,
            refresh_token: tokenRecord.refreshToken,
            grant_type: "refresh_token",
          }).toString(),
        });

        const refreshData = (await refreshRes.json()) as {
          access_token?: string;
          expires_in?: number;
        };

        if (refreshRes.ok && refreshData.access_token) {
          const newExpiry = refreshData.expires_in
            ? new Date(Date.now() + refreshData.expires_in * 1000)
            : null;

          await prisma.googleOAuthToken.update({
            where: { id: tokenRecord.id },
            data: {
              accessToken: refreshData.access_token,
              expiryDate: newExpiry,
            },
          });

          return {
            accessToken: refreshData.access_token,
            userEmail: tokenRecord.userEmail ?? undefined,
          };
        }
      } catch (err) {
        console.error("Failed to refresh Google access token:", err);
      }
    }
  }

  // Check if system-level refresh token is configured via environment
  if (
    env.GOOGLE_REFRESH_TOKEN &&
    env.GOOGLE_CLIENT_ID &&
    env.GOOGLE_CLIENT_SECRET
  ) {
    try {
      const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          refresh_token: env.GOOGLE_REFRESH_TOKEN,
          grant_type: "refresh_token",
        }).toString(),
      });

      const refreshData = (await refreshRes.json()) as {
        access_token?: string;
        expires_in?: number;
      };

      if (refreshRes.ok && refreshData.access_token) {
        return {
          accessToken: refreshData.access_token,
          userEmail: env.GOOGLE_SENDER_EMAIL,
        };
      }
    } catch (err) {
      console.error("Failed to exchange env GOOGLE_REFRESH_TOKEN:", err);
    }
  }

  return null;
}

/**
 * Returns the overall Google Integration Status for the current user/system
 */
export async function getGoogleIntegrationStatus(userId?: string) {
  const isConfigured = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
  );
  const activeToken = await getValidAccessToken(userId);
  const isConnected = Boolean(activeToken);

  const mode =
    env.GOOGLE_INTEGRATION_MODE === "DISABLED"
      ? "DISABLED"
      : env.GOOGLE_INTEGRATION_MODE === "LIVE"
      ? "LIVE"
      : isConnected && isConfigured
      ? "LIVE"
      : "MOCK";

  return {
    connected: isConnected || mode === "MOCK",
    mode: mode as "LIVE" | "MOCK" | "DISABLED",
    organiserEmail:
      activeToken?.userEmail ??
      env.GOOGLE_SENDER_EMAIL ??
      "mentor@learntrack.edu",
    calendarConnected: isConnected || mode === "MOCK",
    gmailConnected: isConnected || mode === "MOCK",
    configured: isConfigured,
    authUrl:
      isConfigured && userId ? getGoogleAuthorizationUrl(userId) : null,
    accountEmail: activeToken?.userEmail ?? null,
  };
}

/**
 * Disconnects Google integration for the specified user
 */
export async function disconnectGoogleIntegration(userId?: string) {
  if (userId) {
    const token = await prisma.googleOAuthToken.findUnique({
      where: { userId },
    });
    if (token) {
      if (token.accessToken) {
        try {
          await fetch(
            `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(
              token.accessToken
            )}`,
            { method: "POST" }
          );
        } catch {
          // Non-fatal
        }
      }
      await prisma.googleOAuthToken.delete({ where: { userId } });
    }
  } else {
    await prisma.googleOAuthToken.deleteMany({});
  }
}

/**
 * Creates a real Google Calendar Event using Google Calendar API
 */
export async function createGoogleCalendarEvent(params: {
  title: string;
  startIso: string;
  endIso: string;
  timezone: string;
  organiserName: string;
  studentName?: string;
  studentEmail?: string;
  meetingId: string;
  userId?: string;
}): Promise<CalendarEventResult> {
  const mode = env.GOOGLE_INTEGRATION_MODE;

  // In MOCK mode (or unit test environment without credentials)
  if (mode === "MOCK") {
    return {
      success: true,
      eventId: `mock-gcal-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      meetLink: `https://meet.google.com/mock-adv-${Math.random().toString(36).slice(2, 6)}`,
      htmlLink: `https://calendar.google.com/calendar/r/eventedit/mock-${Date.now()}`,
    };
  }

  if (mode === "DISABLED") {
    return {
      success: false,
      error: "Google Calendar integration is disabled by server configuration.",
    };
  }

  // LIVE mode requires a valid access token
  const tokenInfo = await getValidAccessToken(params.userId);
  if (!tokenInfo) {
    return {
      success: false,
      error:
        "Google account not connected or authorization expired. Please connect Google Calendar in Meetings.",
    };
  }

  // Privacy-safe description: Never expose internal case references, marks, or sensitive notes
  const description = [
    "Academic advising check-in scheduled via LearnTrack.",
    `Organiser: ${params.organiserName}`,
    params.studentName ? `Student: ${params.studentName}` : null,
    "Mode: Academic Support Check-in",
  ]
    .filter(Boolean)
    .join("\n");

  const attendees: Array<{ email: string }> = [];
  if (params.studentEmail && params.studentEmail.includes("@")) {
    attendees.push({ email: params.studentEmail });
  }

  try {
    const calendarRes = await fetch(
      "https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          summary: params.title || "Academic Support Check-in",
          description,
          start: {
            dateTime: params.startIso,
            timeZone: params.timezone || "Asia/Kolkata",
          },
          end: {
            dateTime: params.endIso,
            timeZone: params.timezone || "Asia/Kolkata",
          },
          attendees,
          conferenceData: {
            createRequest: {
              requestId: `learntrack-mtg-${params.meetingId}`,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
      }
    );

    const data = (await calendarRes.json()) as {
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
      error?: { message?: string; code?: number };
    };

    if (!calendarRes.ok || !data.id) {
      return {
        success: false,
        error:
          data.error?.message ||
          `Google Calendar API returned status ${calendarRes.status}`,
      };
    }

    return {
      success: true,
      eventId: data.id,
      meetLink: data.hangoutLink ?? data.htmlLink,
      htmlLink: data.htmlLink,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unexpected error connecting to Google Calendar API.",
    };
  }
}

/**
 * Updates an existing Google Calendar Event
 */
export async function updateGoogleCalendarEvent(params: {
  eventId: string;
  startIso?: string;
  endIso?: string;
  timezone?: string;
  title?: string;
  userId?: string;
}): Promise<CalendarEventResult> {
  const mode = env.GOOGLE_INTEGRATION_MODE;
  if (mode === "MOCK") {
    return {
      success: true,
      eventId: params.eventId,
      meetLink: `https://meet.google.com/mock-resync-${Date.now()}`,
    };
  }

  const tokenInfo = await getValidAccessToken(params.userId);
  if (!tokenInfo) {
    return {
      success: false,
      error: "Google account not connected or authorization expired.",
    };
  }

  try {
    const patchBody: Record<string, unknown> = {};
    if (params.title) patchBody.summary = params.title;
    if (params.startIso) {
      patchBody.start = {
        dateTime: params.startIso,
        timeZone: params.timezone || "Asia/Kolkata",
      };
    }
    if (params.endIso) {
      patchBody.end = {
        dateTime: params.endIso,
        timeZone: params.timezone || "Asia/Kolkata",
      };
    }

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(
        params.eventId
      )}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${tokenInfo.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(patchBody),
      }
    );

    const data = (await res.json()) as {
      id?: string;
      htmlLink?: string;
      hangoutLink?: string;
      error?: { message?: string };
    };

    if (!res.ok) {
      return {
        success: false,
        error:
          data.error?.message ||
          `Google Calendar update failed with status ${res.status}`,
      };
    }

    return {
      success: true,
      eventId: data.id ?? params.eventId,
      meetLink: data.hangoutLink ?? data.htmlLink,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Error updating Google Calendar event.",
    };
  }
}

/**
 * Sends meeting notification email via Gmail API
 */
export async function sendGmailMeetingNotification(params: {
  recipientEmail: string;
  studentName: string;
  meetingTitle: string;
  startIso: string;
  endIso: string;
  timezone: string;
  organiserName: string;
  meetLink?: string;
  locationOrLink?: string;
  userId?: string;
}): Promise<GmailNotificationResult> {
  const mode = env.GOOGLE_INTEGRATION_MODE;

  // Validate recipient email address (must be authentic and verified)
  if (
    !params.recipientEmail ||
    !params.recipientEmail.includes("@") ||
    params.recipientEmail.endsWith("@example.invalid")
  ) {
    return {
      success: false,
      error: "No verified recipient email address available for student.",
      recipientEmail: params.recipientEmail,
    };
  }

  // MOCK mode
  if (mode === "MOCK") {
    return {
      success: true,
      messageId: `mock-gmail-msg-${Date.now()}`,
      recipientEmail: params.recipientEmail,
    };
  }

  if (mode === "DISABLED") {
    return {
      success: false,
      error: "Gmail notification integration is disabled.",
    };
  }

  const tokenInfo = await getValidAccessToken(params.userId);
  if (!tokenInfo) {
    return {
      success: false,
      error:
        "Google account not connected or authorization expired for Gmail sending.",
      recipientEmail: params.recipientEmail,
    };
  }

  const senderEmail =
    tokenInfo.userEmail || env.GOOGLE_SENDER_EMAIL || "advising@learntrack.edu";

  // Format dates for email body
  let formattedStart = params.startIso;
  let formattedEnd = params.endIso;
  try {
    const sDate = new Date(params.startIso);
    const eDate = new Date(params.endIso);
    formattedStart = sDate.toLocaleString("en-IN", {
      timeZone: params.timezone || "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
    formattedEnd = eDate.toLocaleTimeString("en-IN", {
      timeZone: params.timezone || "Asia/Kolkata",
      timeStyle: "short",
    });
  } catch {
    // Keep raw ISO if formatting fails
  }

  const meetingLink = params.meetLink || params.locationOrLink || "Advising Office";

  // Privacy-safe email: No case references, no marks, no intervention notes
  const emailLines = [
    `From: LearnTrack Academic Advising <${senderEmail}>`,
    `To: ${params.recipientEmail}`,
    `Subject: Advising Meeting Scheduled: ${params.meetingTitle}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    `Dear ${params.studentName},`,
    "",
    "An academic advising check-in meeting has been scheduled for you:",
    "",
    `• Meeting: ${params.meetingTitle}`,
    `• Date & Time: ${formattedStart} – ${formattedEnd} (${params.timezone || "Asia/Kolkata"})`,
    `• Organiser: ${params.organiserName}`,
    `• Location / Link: ${meetingLink}`,
    "",
    "Instructions:",
    "Please be prepared and join on time. If you need to reschedule or cancel this meeting, please contact your mentor or update your availability in the LearnTrack portal at least 24 hours in advance.",
    "",
    "Best regards,",
    "LearnTrack Academic Advising Team",
  ];

  const rawMessage = emailLines.join("\r\n");
  const encodedRaw = Buffer.from(rawMessage, "utf-8").toString("base64url");

  try {
    const gmailRes = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${tokenInfo.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ raw: encodedRaw }),
      }
    );

    const data = (await gmailRes.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (!gmailRes.ok || !data.id) {
      return {
        success: false,
        error:
          data.error?.message ||
          `Gmail API returned status ${gmailRes.status}`,
        recipientEmail: params.recipientEmail,
      };
    }

    return {
      success: true,
      messageId: data.id,
      recipientEmail: params.recipientEmail,
    };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "Unexpected error sending Gmail message.",
      recipientEmail: params.recipientEmail,
    };
  }
}
