import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Webhook } from "svix";
import { listNotifications } from "~/lib/db/scoped/notifications";
import { listReminders } from "~/lib/db/scoped/compliance";
import { recordCertificate } from "~/lib/db/scoped/alteration-writes";
import type { BuildingContext } from "~/lib/db/context";
import { withBuildingTx, withJobTx, withUntenantedTx } from "~/lib/db/tx";
import { resetEnvCache } from "~/lib/env";
import { reminderDedupeKey } from "~/lib/email/send";
import {
  obligationReminderText,
  subjectFor,
  type ObligationReminderProps,
} from "~/lib/email/templates/obligationReminder";
import { runReminders } from "~/lib/primitives/obligations/reminders";
import { addDays, today, toDbDate } from "~/lib/time";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * The reminder run.
 *
 * The property that matters most is that running twice does not mail the
 * building twice. A board that gets two identical emails about the same boiler
 * inspection learns to ignore the emails, and once they do, the product has
 * failed at the only thing it does.
 */

describe("the daily reminder run", () => {
  let president: BuildingContext;
  let now: string;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    now = today(president.building.timezone);
    rmSync(".mail", { recursive: true, force: true });
  });

  afterAll(() => {
    rmSync(".mail", { recursive: true, force: true });
  });

  it("sends nothing when no reminder is due yet", async () => {
    // The seed schedules reminders ahead of their due dates, so a run today
    // should be quiet. A cron that mails on every invocation regardless of
    // schedule would pass a weaker test than this one.
    const summary = await runReminders();
    expect(summary.failed).toEqual(0);
    expect(summary.sent).toEqual(0);
  });

  describe("with a reminder that has come due", () => {
    let obligationId: string;
    let sentFirstRun: number;

    beforeAll(async () => {
      // Pull one reminder back to today rather than fabricating an obligation,
      // so the run is exercised against real seeded data.
      const reminders = await listReminders(president);
      const target = reminders.find((r) => !r.sentAt);
      if (!target) throw new Error("seed has no unsent reminders");

      obligationId = target.obligationId;

      await withBuildingTx(president.building.id, (tx) =>
        tx.obligationReminder.update({
          where: { id: target.id },
          data: { scheduledFor: toDbDate(now as never) },
        }),
      );
    });

    it("sends to the assignee and the officers", async () => {
      const summary = await runReminders();
      sentFirstRun = summary.sent;

      expect(summary.remindersDue).toBeGreaterThan(0);
      expect(summary.sent).toBeGreaterThan(0);
      expect(summary.failed).toEqual(0);
    });

    it("writes the notification log record for each recipient", async () => {
      const log = await listNotifications(president, {
        subjectType: "OBLIGATION",
        subjectId: obligationId,
      });

      expect(log.length).toEqual(sentFirstRun);
      for (const entry of log) {
        expect(entry.template).toEqual("obligation-reminder");
        expect(entry.status).toEqual("SENT");
        expect(entry.buildingId).toEqual(president.building.id);
        // Written before dispatch, so a queued-at always exists even when the
        // provider never answered.
        expect(entry.queuedAt).toBeTruthy();
        expect(entry.providerMessageId).toBeTruthy();
      }
    });

    it("does not send again when the job runs twice", async () => {
      const second = await runReminders();

      // The reminder row is marked sent, so it is not even collected. This is
      // the first of the two guards; the dedupe key below is the second.
      expect(second.sent).toEqual(0);

      const log = await listNotifications(president, {
        subjectType: "OBLIGATION",
        subjectId: obligationId,
      });
      expect(log.length).toEqual(sentFirstRun);
    });

    it("would still refuse a duplicate if the reminder row were reopened", async () => {
      // Belt and braces: unmark the row and run again. Nothing new goes out,
      // because the dedupe key is derived from (obligation, offset, date,
      // recipient) and those have not changed.
      const reminders = await listReminders(president);
      const target = reminders.find((r) => r.obligationId === obligationId);
      if (!target) throw new Error("reminder vanished");

      await withBuildingTx(president.building.id, (tx) =>
        tx.obligationReminder.update({
          where: { id: target.id },
          data: { sentAt: null },
        }),
      );

      const third = await runReminders();
      expect(third.sent).toEqual(0);
      expect(third.duplicates).toBeGreaterThan(0);

      const log = await listNotifications(president, {
        subjectType: "OBLIGATION",
        subjectId: obligationId,
      });
      expect(log.length).toEqual(sentFirstRun);
    });
  });

  it("sends one email per filing per day, not one per reminder offset", async () => {
    // A building that goes unrun for a fortnight, or whose offsets bunch up
    // near a deadline, would otherwise get four separate emails about the same
    // boiler inspection on the same morning — exactly how a board learns to
    // ignore the emails.
    const reminders = await listReminders(president);
    const unsent = reminders.filter((r) => !r.sentAt);

    const crowded = unsent.reduce<Map<string, string[]>>((acc, r) => {
      acc.set(r.obligationId, [...(acc.get(r.obligationId) ?? []), r.id]);
      return acc;
    }, new Map());

    const target = [...crowded.entries()].find(([, ids]) => ids.length > 1);
    if (!target) return;
    const [obligationId, ids] = target;

    await withBuildingTx(president.building.id, (tx) =>
      tx.obligationReminder.updateMany({
        where: { id: { in: ids } },
        data: { scheduledFor: toDbDate(now as never) },
      }),
    );

    const before = (
      await listNotifications(president, {
        subjectType: "OBLIGATION",
        subjectId: obligationId,
        limit: 200,
      })
    ).length;

    const summary = await runReminders();
    expect(summary.collapsed).toBeGreaterThan(0);

    const after = await listNotifications(president, {
      subjectType: "OBLIGATION",
      subjectId: obligationId,
      limit: 200,
    });

    // One message per recipient, not one per offset per recipient.
    const recipients = new Set(after.map((n) => n.recipientEmail));
    expect(after.length - before).toEqual(recipients.size);

    // And the folded-in rows are marked sent, so they do not fire tomorrow.
    const still = (await listReminders(president)).filter(
      (r) => ids.includes(r.id) && !r.sentAt,
    );
    expect(still).toEqual([]);
  });

  it("keeps one building's reminders out of another's log", async () => {
    const ivan = await contextFor(PEOPLE.ivanPresident, LISPENARD);
    const theirs = await listNotifications(ivan);
    for (const entry of theirs) {
      expect(entry.buildingId).toEqual(ivan.building.id);
    }
  });

  it("picks up a reminder whose date passed while nobody was running the job", async () => {
    // A building standing the system up in March should still hear about the
    // filing whose reminder date was February, rather than having it silently
    // skipped.
    const expiresOn = addDays(now as never, 60);
    const created = await recordCertificate(president, {
      holderKind: "VENDOR",
      holderName: "Backdated Boiler Service",
      carrier: "Chubb",
      policyNumber: "GL-BACKDATE",
      effectiveOn: now,
      expiresOn,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await withBuildingTx(president.building.id, (tx) =>
      tx.obligationReminder.updateMany({
        where: { obligationId: created.data.obligationId },
        data: { scheduledFor: toDbDate(addDays(now as never, -20)) },
      }),
    );

    const summary = await runReminders();
    expect(summary.sent).toBeGreaterThan(0);
  });
});

describe("the reminder email", () => {
  const props: ObligationReminderProps = {
    buildingName: "The Adelaide",
    title: "Annual boiler inspection",
    dueOn: "31 Dec 2026",
    relative: "in 9 days",
    citation: "NYC Admin Code § 28-303",
    detail: "Have the low-pressure boiler inspected by a licensed inspector.",
    assigneeName: "Nora Whitfield",
    needsVerification: true,
    url: "https://example.test/b/adelaide/compliance/abc",
    overdue: false,
  };

  it("puts the whole message in the subject line", () => {
    // Most people read the subject and nothing else.
    expect(subjectFor(props)).toEqual(
      "Annual boiler inspection due in 9 days — The Adelaide",
    );
    expect(subjectFor({ ...props, overdue: true })).toMatch(/^Overdue:/);
  });

  it("renders as prose in plain text, not as stripped markup", () => {
    const text = obligationReminderText(props);

    expect(text).not.toMatch(/[<>]/);
    expect(text).toContain("Annual boiler inspection");
    expect(text).toContain("Due 31 Dec 2026, in 9 days.");
    expect(text).toContain("Nora Whitfield is down to handle this.");
    expect(text).toContain(props.url);
    expect(text).toContain("NYC Admin Code § 28-303");
    expect(text).toMatch(/not legal advice/i);
  });

  it("says so when the deadline is unverified", () => {
    expect(obligationReminderText(props)).toMatch(/could not confirm this exact/i);
    expect(obligationReminderText({ ...props, needsVerification: false })).not.toMatch(
      /could not confirm/i,
    );
  });

  it("says nobody is assigned rather than leaving a blank", () => {
    const text = obligationReminderText({ ...props, assigneeName: null });
    expect(text).toContain("Nobody is assigned to this yet.");
  });
});

describe("the reminder dedupe key", () => {
  it("is identical for two workers computing it independently", () => {
    const input = {
      obligationId: "o-1",
      offsetDays: 30,
      scheduledFor: "2026-08-02",
      recipientEmail: "nora@example.com",
    };
    expect(reminderDedupeKey(input)).toEqual(reminderDedupeKey({ ...input }));
  });

  it("contains no timestamp, so a retry collides with itself", () => {
    const key = reminderDedupeKey({
      obligationId: "o-1",
      offsetDays: 30,
      scheduledFor: "2026-08-02",
      recipientEmail: "nora@example.com",
    });
    expect(key).toEqual("reminder:o-1:30:2026-08-02:nora@example.com");
  });
});

describe("the Resend delivery webhook", () => {
  // A real Svix secret. Verification uses Svix's own library rather than a
  // hand-rolled HMAC check, so this test exercises the actual algorithm
  // Resend signs with — a verifier written from a guess, tested against a
  // payload written from the same guess, would pass and prove nothing.
  const SECRET = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw";

  let POST: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    process.env["RESEND_WEBHOOK_SECRET"] = SECRET;
    resetEnvCache();
    ({ POST } = await import("~/app/api/webhooks/resend/route"));
  });

  afterAll(() => {
    delete process.env["RESEND_WEBHOOK_SECRET"];
    resetEnvCache();
  });

  function signed(payload: unknown): Request {
    const body = JSON.stringify(payload);
    const id = `msg_${Math.random().toString(36).slice(2)}`;
    const timestamp = new Date();
    const signature = new Webhook(SECRET).sign(id, timestamp, body);

    return new Request("https://example.test/api/webhooks/resend", {
      method: "POST",
      body,
      headers: {
        "svix-id": id,
        "svix-timestamp": String(Math.floor(timestamp.getTime() / 1000)),
        "svix-signature": signature,
      },
    });
  }

  it("refuses an unsigned request", async () => {
    const response = await POST(
      new Request("https://example.test/api/webhooks/resend", {
        method: "POST",
        body: JSON.stringify({ type: "email.delivered" }),
      }),
    );
    expect(response.status).toEqual(400);
  });

  it("refuses a tampered payload", async () => {
    const request = signed({ type: "email.delivered", data: { email_id: "x" } });
    const tampered = new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify({ type: "email.delivered", data: { email_id: "y" } }),
    });

    expect((await POST(tampered)).status).toEqual(400);
  });

  it("records delivery against the right notification", async () => {
    const president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    const log = await listNotifications(president, { limit: 1 });
    const entry = log[0];
    expect(entry?.providerMessageId).toBeTruthy();
    if (!entry?.providerMessageId) return;

    const response = await POST(
      signed({
        type: "email.delivered",
        data: { email_id: entry.providerMessageId },
      }),
    );
    expect(response.status).toEqual(200);

    const after = await withBuildingTx(president.building.id, (tx) =>
      tx.notification.findUnique({
        where: { id: entry.id },
        select: { status: true, deliveredAt: true },
      }),
    );

    // This is what turns the log from "we tried to send this" into "this was
    // delivered", which is the difference between a record and evidence.
    expect(after?.status).toEqual("DELIVERED");
    expect(after?.deliveredAt).toBeTruthy();
  });

  it("records a bounce", async () => {
    const president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    const log = await listNotifications(president, { limit: 5 });
    const entry = log.find((row) => row.status === "SENT");
    if (!entry?.providerMessageId) return;

    await POST(
      signed({ type: "email.bounced", data: { email_id: entry.providerMessageId } }),
    );

    const after = await withBuildingTx(president.building.id, (tx) =>
      tx.notification.findUnique({
        where: { id: entry.id },
        select: { status: true, failedAt: true },
      }),
    );
    expect(after?.status).toEqual("BOUNCED");
    expect(after?.failedAt).toBeTruthy();
  });

  it("acknowledges an event type it does not map, rather than making Resend retry", async () => {
    const response = await POST(
      signed({ type: "email.opened", data: { email_id: "whatever" } }),
    );
    expect(response.status).toEqual(200);
    expect(await response.json()).toMatchObject({ ignored: "email.opened" });
  });

  it("acknowledges a message it has never heard of", async () => {
    const response = await POST(
      signed({ type: "email.delivered", data: { email_id: "not-ours" } }),
    );
    expect(response.status).toEqual(200);
  });
});

describe("the reads a background job needs", () => {
  it("enumerates buildings under the job scope", async () => {
    const buildings = await withJobTx((tx) =>
      tx.building.findMany({ select: { id: true } }),
    );
    expect(buildings.length).toBeGreaterThanOrEqual(2);
  });

  it("sees nothing without it — the job scope is opt-in, not ambient", async () => {
    // The failure this guards against is subtle: if enumerating buildings ever
    // worked without asking for the scope, every untenanted read in the system
    // would silently gain access to the tenant registry.
    const buildings = await withUntenantedTx((tx) =>
      tx.building.findMany({ select: { id: true } }),
    );
    expect(buildings).toEqual([]);
  });
});
