import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { StatusChip, UnverifiedChip } from "~/components/patterns/StatusChip";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { getComplianceRule } from "~/lib/compliance/rules";
import { getObligation } from "~/lib/db/scoped/compliance";
import { dueStatus } from "~/lib/primitives/obligations/recurrence";
import {
  formatDate,
  formatDateLong,
  formatInstant,
  pluralDays,
  relativeDays,
  today,
  toPlainDate,
} from "~/lib/time";
import { ObligationActions } from "../ObligationActions";

export default async function ObligationPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; obligationId: string }>;
}) {
  const { buildingSlug, obligationId } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const obligation = await getObligation(ctx, obligationId);
  if (!obligation) notFound();

  const due = toPlainDate(obligation.dueOn);
  const status = dueStatus({ state: obligation.state, dueOn: due }, now);
  const rule = obligation.ruleCode
    ? await getComplianceRule(obligation.ruleCode)
    : null;

  const pendingReminders = obligation.reminders.filter((r) => !r.sentAt);
  const sentReminders = obligation.reminders.filter((r) => r.sentAt);

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link
              href={`/b/${buildingSlug}/compliance`}
              className="underline underline-offset-4"
            >
              Compliance calendar
            </Link>
            {authoritySuffix(rule?.authority)}
          </>
        }
        title={obligation.title}
        lede={obligation.detail ?? undefined}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusChip status={status} />
        {obligation.needsVerification ? (
          <UnverifiedChip title={rule?.verificationNote ?? undefined} />
        ) : null}
        <span className="text-ironwork font-mono text-sm">
          Due {formatDateLong(due)}
        </span>
        {obligation.state === "OPEN" ? (
          <span className="text-ironwork-soft text-sm">{relativeDays(now, due)}</span>
        ) : null}
      </div>

      {obligation.needsVerification && rule?.verificationNote ? (
        <p className="border-brass bg-paper text-ironwork-soft mb-6 border-l-2 px-3 py-2 text-sm">
          <strong className="text-ironwork font-medium">Unverified.</strong>{" "}
          {rule.verificationNote}
        </p>
      ) : null}

      <ObligationActions
        buildingSlug={buildingSlug}
        obligationId={obligation.id}
        state={obligation.state}
        canComplete={can(ctx, "compliance.markComplete")}
        canManage={can(ctx, "compliance.manage")}
        today={now}
      />

      <dl className="border-limestone mt-8 grid gap-x-8 gap-y-4 border-t pt-6 sm:grid-cols-2">
        {rule ? (
          <>
            <Row label="Authority" value={rule.authority} mono />
            <Row label="Citation" value={rule.citation} mono />
          </>
        ) : null}
        <Row
          label="Assigned to"
          value={
            obligation.assignee?.user.name ??
            obligation.assignee?.user.email ??
            "Nobody yet"
          }
        />
        <Row label="Repeats" value={describeRecurrence(obligation)} />
        {obligation.completedOn ? (
          <>
            <Row
              label="Filed"
              value={formatDate(toPlainDate(obligation.completedOn))}
              mono
            />
            <Row
              label="Filed by"
              value={
                obligation.completedBy?.user.name ??
                obligation.completedBy?.user.email ??
                "—"
              }
            />
          </>
        ) : null}
        {obligation.waivedAt ? (
          <Row
            label="Removed"
            value={formatInstant(obligation.waivedAt, ctx.building.timezone)}
          />
        ) : null}
      </dl>

      {obligation.completionNote ? (
        <section className="mt-6">
          <h2 className="eyebrow mb-1.5">Note on filing</h2>
          <p className="text-ironwork-soft text-sm">{obligation.completionNote}</p>
        </section>
      ) : null}

      {obligation.waivedReason ? (
        <section className="mt-6">
          <h2 className="eyebrow mb-1.5">Why it came off the calendar</h2>
          <p className="text-ironwork-soft text-sm">{obligation.waivedReason}</p>
        </section>
      ) : null}

      {rule ? (
        <section className="border-limestone mt-8 border-t pt-6">
          <h2 className="eyebrow mb-1.5">What the law says</h2>
          <p className="text-ironwork-soft text-sm">{rule.requirement}</p>
          <p className="text-ironwork-faint mt-2 font-mono text-xs">
            {rule.citation}
            {rule.sourceUrl ? (
              <>
                {" · "}
                <a
                  href={rule.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-verdigris underline underline-offset-4"
                >
                  Read it at {new URL(rule.sourceUrl).host}
                </a>
              </>
            ) : null}
          </p>
        </section>
      ) : null}

      <section className="border-limestone mt-8 border-t pt-6">
        <h2 className="eyebrow mb-2">Reminders</h2>
        {obligation.reminders.length === 0 ? (
          <p className="text-ironwork-soft text-sm">
            No reminders are scheduled for this one.
          </p>
        ) : (
          <ul className="space-y-1">
            {sentReminders.map((reminder) => (
              <li key={reminder.id} className="text-ironwork-faint font-mono text-xs">
                {formatDate(toPlainDate(reminder.scheduledFor))} — sent
              </li>
            ))}
            {pendingReminders.map((reminder) => (
              <li key={reminder.id} className="text-ironwork-soft font-mono text-xs">
                {formatDate(toPlainDate(reminder.scheduledFor))} —{" "}
                {pluralDays(reminder.offsetDays)} before
              </li>
            ))}
          </ul>
        )}
      </section>

      {obligation.children.length > 0 || obligation.parent ? (
        <section className="border-limestone mt-8 border-t pt-6">
          <h2 className="eyebrow mb-2">This filing over time</h2>
          <ul className="space-y-1">
            {obligation.parent ? (
              <li className="text-sm">
                <Link
                  href={`/b/${buildingSlug}/compliance/${obligation.parent.id}`}
                  className="text-verdigris underline underline-offset-4"
                >
                  Previous: due {formatDate(toPlainDate(obligation.parent.dueOn))}
                </Link>
              </li>
            ) : null}
            {obligation.children.map((child) => (
              <li key={child.id} className="text-sm">
                <Link
                  href={`/b/${buildingSlug}/compliance/${child.id}`}
                  className="text-verdigris underline underline-offset-4"
                >
                  Next: due {formatDate(toPlainDate(child.dueOn))}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="eyebrow mb-0.5">{label}</dt>
      <dd className={`text-ironwork text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

/** In the words a board member would use, not the enum name. */
function describeRecurrence(obligation: {
  recurrenceType: string;
  intervalMonths: number | null;
  cycleYears: number | null;
  anchorOffsetMonths?: number | null;
}): string {
  switch (obligation.recurrenceType) {
    case "FIXED_INTERVAL":
      return obligation.intervalMonths === 12
        ? "Every year"
        : `Every ${obligation.intervalMonths ?? "?"} months`;
    case "CYCLICAL_BY_YEAR":
      return `Every ${obligation.cycleYears ?? "?"} years, on the city's cycle`;
    case "ANCHORED_TO_COMPLETION":
      return `${(obligation.anchorOffsetMonths ?? 0) / 12} years after the last one passed`;
    default:
      return "One-off";
  }
}

function authoritySuffix(authority: string | undefined): string {
  return authority ? ` · ${authority}` : "";
}
