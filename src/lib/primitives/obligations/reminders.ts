import { render } from "@react-email/render";
import {
  ObligationReminderEmail,
  obligationReminderText,
  subjectFor,
  type ObligationReminderProps,
} from "~/lib/email/templates/obligationReminder";
import { reminderDedupeKey, sendNotice } from "~/lib/email/send";
import { withBuildingTx, withJobTx, withUntenantedTx } from "~/lib/db/tx";
import { env } from "~/lib/env";
import {
  formatDate,
  relativeDays,
  toDbDate,
  toPlainDate,
  today,
  type PlainDate,
} from "~/lib/time";

/**
 * The daily reminder run.
 *
 * Idempotency is the whole design here, and it is enforced in two places
 * rather than one:
 *
 *   `ObligationReminder` has a unique constraint on
 *   (obligation, offset, scheduledFor), so a reminder row exists at most once.
 *
 *   `Notification.dedupeKey` derives from the same triple plus the recipient,
 *   so even if a reminder row were somehow processed twice, the second send
 *   loses the insert race and never reaches the provider.
 *
 * Belt and braces on purpose: a cron that mails a twelve-unit building twice
 * about the same boiler inspection is how a board learns to ignore the emails,
 * and once they do, the product has failed at the only thing it does.
 *
 * Reminders that fell due while nobody was running the job are picked up
 * (`scheduledFor <= today`) rather than skipped. A building standing the system
 * up in March should still hear about the filing whose reminder date was
 * February.
 */

export interface CronRunSummary {
  readonly ranAt: string;
  readonly buildingsChecked: number;
  /** Filings reminded about — not reminder rows, which can collapse. */
  readonly remindersDue: number;
  /** Rows folded into another message for the same filing on the same day. */
  readonly collapsed: number;
  readonly sent: number;
  readonly duplicates: number;
  readonly failed: number;
  readonly errors: string[];
}

interface DueReminder {
  reminderId: string;
  obligationId: string;
  buildingId: string;
  buildingName: string;
  buildingSlug: string;
  timezone: string;
  offsetDays: number;
  scheduledFor: PlainDate;
  title: string;
  detail: string | null;
  dueOn: PlainDate;
  ruleCode: string | null;
  needsVerification: boolean;
  assigneeName: string | null;
  recipients: string[];
  /**
   * Other reminder rows for the same obligation that also came due today, and
   * are covered by this message. Marked sent alongside it.
   */
  supersededIds: string[];
}

/**
 * Everyone who should hear about a filing.
 *
 * The assignee plus every officer who could act on it. Not the whole building:
 * a shareholder does not need eleven emails a year about the boiler, and a
 * product that mails everyone about everything gets filtered to a folder.
 */
const NOTIFY_ROLES = ["PRESIDENT", "TREASURER", "SECRETARY", "BOARD_MEMBER"] as const;

async function collectDue(now: PlainDate): Promise<DueReminder[]> {
  // The tenant registry, read under the job scope — this is one of the two
  // reads in the system that legitimately span every co-op. Each building's
  // reminders are then read inside its own scoped transaction.
  const buildings = await withJobTx((tx) =>
    tx.building.findMany({
      select: { id: true, name: true, slug: true, timezone: true },
    }),
  );

  const out: DueReminder[] = [];

  for (const building of buildings) {
    const localToday = today(building.timezone);

    const reminders = await withBuildingTx(building.id, async (tx) => {
      const rows = await tx.obligationReminder.findMany({
        where: {
          sentAt: null,
          scheduledFor: { lte: toDbDate(localToday) },
          obligation: { state: "OPEN" },
        },
        select: {
          id: true,
          offsetDays: true,
          scheduledFor: true,
          obligation: {
            select: {
              id: true,
              title: true,
              detail: true,
              dueOn: true,
              ruleCode: true,
              needsVerification: true,
              assignee: {
                select: { user: { select: { name: true, email: true } } },
              },
            },
          },
        },
      });

      if (rows.length === 0) return [];

      const officers = await tx.membership.findMany({
        where: { status: "ACTIVE", roles: { hasSome: [...NOTIFY_ROLES] } },
        select: { user: { select: { email: true } } },
      });

      const mapped = rows.map((row) => {
        const assigneeEmail = row.obligation.assignee?.user.email;
        const recipients = [
          ...new Set(
            [assigneeEmail, ...officers.map((o) => o.user.email)].filter(
              (email): email is string => Boolean(email),
            ),
          ),
        ];

        return {
          reminderId: row.id,
          obligationId: row.obligation.id,
          buildingId: building.id,
          buildingName: building.name,
          buildingSlug: building.slug,
          timezone: building.timezone,
          offsetDays: row.offsetDays,
          scheduledFor: toPlainDate(row.scheduledFor),
          title: row.obligation.title,
          detail: row.obligation.detail,
          dueOn: toPlainDate(row.obligation.dueOn),
          ruleCode: row.obligation.ruleCode,
          needsVerification: row.obligation.needsVerification,
          assigneeName: row.obligation.assignee?.user.name ?? null,
          recipients,
          supersededIds: [],
        } satisfies DueReminder;
      });

      // One email per filing per day, not one per reminder offset.
      //
      // A building that goes unrun for a fortnight, or whose offsets bunch up
      // near a deadline, would otherwise get four separate emails about the
      // same boiler inspection on the same morning. That is exactly how a board
      // learns to ignore the emails — the failure the idempotency work exists
      // to prevent, arriving by a different route.
      //
      // The most urgent offset wins, because "due in 1 day" is the more useful
      // message than "due in 60 days", and the rest are marked sent so they do
      // not fire tomorrow.
      const byObligation = new Map<string, DueReminder>();
      for (const reminder of mapped) {
        const existing = byObligation.get(reminder.obligationId);
        if (!existing) {
          byObligation.set(reminder.obligationId, reminder);
          continue;
        }

        const [keep, drop] =
          reminder.offsetDays < existing.offsetDays
            ? [reminder, existing]
            : [existing, reminder];

        keep.supersededIds = [
          ...keep.supersededIds,
          ...drop.supersededIds,
          drop.reminderId,
        ];
        byObligation.set(reminder.obligationId, keep);
      }

      return [...byObligation.values()];
    });

    out.push(...reminders);
    void localToday;
  }

  void now;
  return out;
}

async function citationFor(ruleCode: string | null): Promise<string | null> {
  if (!ruleCode) return null;
  const rule = await withUntenantedTx((tx) =>
    tx.complianceRule.findUnique({
      where: { code: ruleCode },
      select: { citation: true },
    }),
  );
  return rule?.citation ?? null;
}

export async function runReminders(): Promise<CronRunSummary> {
  const ranAt = new Date().toISOString();
  const now = today();
  const due = await collectDue(now);

  let sent = 0;
  let duplicates = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const reminder of due) {
    const citation = await citationFor(reminder.ruleCode);
    const localToday = today(reminder.timezone);
    const overdue = reminder.dueOn < localToday;

    const props: ObligationReminderProps = {
      buildingName: reminder.buildingName,
      title: reminder.title,
      dueOn: formatDate(reminder.dueOn),
      relative: relativeDays(localToday, reminder.dueOn),
      citation,
      detail: reminder.detail,
      assigneeName: reminder.assigneeName,
      needsVerification: reminder.needsVerification,
      url: `${env().AUTH_URL}/b/${reminder.buildingSlug}/compliance/${reminder.obligationId}`,
      overdue,
    };

    const html = await render(ObligationReminderEmail(props));
    const text = obligationReminderText(props);
    const subject = subjectFor(props);

    let anySent = false;

    for (const recipient of reminder.recipients) {
      const outcome = await sendNotice({
        buildingId: reminder.buildingId,
        to: recipient,
        template: "obligation-reminder",
        subject,
        html,
        text,
        payload: {
          obligationId: reminder.obligationId,
          offsetDays: reminder.offsetDays,
          scheduledFor: reminder.scheduledFor,
          overdue,
        },
        dedupeKey: reminderDedupeKey({
          obligationId: reminder.obligationId,
          offsetDays: reminder.offsetDays,
          scheduledFor: reminder.scheduledFor,
          recipientEmail: recipient,
        }),
        subjectType: "OBLIGATION",
        subjectId: reminder.obligationId,
      });

      if (outcome.status === "sent") {
        sent += 1;
        anySent = true;
      } else if (outcome.status === "duplicate") {
        duplicates += 1;
      } else {
        failed += 1;
        errors.push(`${reminder.title} → ${recipient}: ${outcome.error}`);
      }
    }

    // Marked sent when anything went out, or when every recipient was already
    // covered by a previous run. Leaving it unmarked after a genuine failure
    // means the next run retries it, which is the behaviour a transient
    // provider outage deserves.
    if (anySent || (duplicates > 0 && failed === 0)) {
      await withBuildingTx(reminder.buildingId, (tx) =>
        tx.obligationReminder.updateMany({
          where: { id: { in: [reminder.reminderId, ...reminder.supersededIds] } },
          data: { sentAt: new Date() },
        }),
      );
    }
  }

  return {
    ranAt,
    buildingsChecked: new Set(due.map((r) => r.buildingId)).size,
    remindersDue: due.length,
    collapsed: due.reduce((sum, r) => sum + r.supersededIds.length, 0),
    sent,
    duplicates,
    failed,
    errors,
  };
}
