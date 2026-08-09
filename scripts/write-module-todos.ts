/**
 * Writes each scaffolded module's TODO.md from the `MISSING` list its page
 * exports.
 *
 * One source, two readers: the banner on the page and the file in the
 * repository say the same thing, because they are the same array. A TODO.md
 * maintained by hand goes stale the first time someone builds half a module.
 *
 *   pnpm tsx scripts/write-module-todos.ts
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

interface ModuleSpec {
  dir: string;
  title: string;
  /** What the module is for, in the words a board member would use. */
  purpose: string;
  /** What already exists that the next developer should build on. */
  standing: string[];
  missing: string[];
}

const MODULES: ModuleSpec[] = [
  {
    dir: "notices",
    title: "Annual Notices",
    purpose:
      "Generate, send and *prove delivery of* the notices the law requires every year — window guard, lead paint, stove knob covers.",
    standing: [
      "`NoticeCampaign` and `NoticeDelivery` tables, seeded with a real campaign",
      "The notification log (`src/lib/db/scoped/notifications.ts`) — write the record before dispatch, update after",
      "`sendNotice` in `src/lib/email/send.ts`, with dedupe built in",
      "Obligations for the notice deadlines already come off the compliance ruleset",
    ],
    missing: [
      "Generating each notice from a React Email template",
      "Sending, through the notification log",
      "Recording responses, and chasing the households that don't reply",
      "Proof of delivery: the signed card, the photo under the door",
    ],
  },
  {
    dir: "meetings",
    title: "Meetings & Proxies",
    purpose:
      "Share-weighted quorum, digital proxies, minutes and resolutions — so a meeting's record survives the board that held it.",
    standing: [
      "`src/lib/primitives/shares.ts` — quorum, thresholds as exact fractions, vote tallies. Fully tested",
      "`Meeting`, `MeetingAttendance`, `Proxy`, `Resolution` tables",
      "`Meeting.quorumNumerator/Denominator/Strict` stores the bylaw fraction exactly",
      "The building elevation is designed to double as the live quorum display",
    ],
    missing: [
      "Digital proxy collection, and revoking one",
      "Live quorum as attendance is recorded",
      "Minutes: drafting, adoption, and the document link",
      "Resolutions and share-weighted voting",
    ],
  },
  {
    dir: "sublets",
    title: "Sublet Register",
    purpose:
      "Approved sublets with their terms and fees, and the building-wide cap most proprietary leases impose.",
    standing: [
      "`SubletRegistration` table, with an optional link to an `ApprovalRequest`",
      "The approval workflow (`src/lib/primitives/approvals.ts`) — already carries `SUBLET` as a kind",
      "`Building.subletCapPercent` for the house rule",
      "The ledger, for fees",
    ],
    missing: [
      "Applying to sublet, through the approval workflow",
      "Enforcing the building-wide cap at approval",
      "Sublet fees posted to the ledger",
      "Renewal, and the expiry reminder",
    ],
  },
  {
    dir: "arrears",
    title: "Arrears",
    purpose:
      "Maintenance charge aging and payment records. Payments are *recorded*, never collected.",
    standing: [
      "`src/lib/primitives/ledger.ts` — aging, balances, reversal handling. Fully tested",
      "`Charge` and `Payment`, append-only below the application: the runtime role has no UPDATE or DELETE",
      "The aging table on this page already works against real data",
      "`arrears.viewAll` is held by the treasurer and president only",
    ],
    missing: [
      "Posting a charge, and recording a payment",
      "Reversing entries through the interface",
      "Payment plans",
      "Late fee rules",
      "The arrears letter, sent through the notification log",
    ],
  },
  {
    dir: "bookings",
    title: "Bookings",
    purpose:
      "Freight elevator and move-in scheduling, gated on a deposit and a valid certificate of insurance.",
    standing: [
      "`src/lib/primitives/prerequisites.ts` — a registry of checkers, fully tested. Adding the roof deck is a row, not code",
      "`Resource`, `ResourcePrerequisite`, `Booking`, `BookingPrerequisiteCheck`",
      "Prerequisite descriptions on this page are derived from the data, not typed out",
    ],
    missing: [
      "Requesting a slot, and the calendar to pick it from",
      "Running the prerequisite checks at confirmation",
      "Cancellation, and returning the deposit",
    ],
  },
  {
    dir: "tickets",
    title: "Repair Tickets",
    purpose:
      "Photo-based work orders, triaged, with a written shareholder-vs-co-op responsibility determination.",
    standing: [
      "`Ticket` table, with `responsibility` and an optional `ApprovalRequest`",
      "The approval workflow already carries `TICKET_RESPONSIBILITY` as a kind",
      "The document store handles photos; `canAttachTo` already covers `TICKET`",
      "Tickets with no unit are building-wide and visible to everyone — see `optionalUnitFilter`",
    ],
    missing: [
      "Reporting a ticket, with photos",
      "Triage: assigning to the super or a vendor",
      "The responsibility determination, through the approval workflow",
      "Resolution and the record of what was done",
    ],
  },
  {
    dir: "duty",
    title: "Duty Rotation",
    purpose:
      "Trash and recycling set-out rotation, with reminders and a log of what it cost when nobody did it.",
    standing: [
      "`DutyRotation`, `DutyAssignment`, `DsnyFine`",
      "`DutyAssignment.obligationId` links a turn to the obligations engine, so reminders come free",
      "The obligations engine and the daily cron already exist",
    ],
    missing: [
      "Generating the rotation as obligations, so reminders go out",
      "Swapping turns between neighbours",
      "Logging a DSNY fine against whoever had the week",
    ],
  },
];

const HEADER = `<!-- Generated by scripts/write-module-todos.ts. Edit the MISSING list in
     this module's page.tsx and the spec in that script, then re-run it. -->`;

function render(spec: ModuleSpec): string {
  return [
    `# ${spec.title} — scaffold`,
    "",
    HEADER,
    "",
    spec.purpose,
    "",
    "This module has real tables, real scoped queries, and a list view showing",
    "real seeded data. It does not write anything yet.",
    "",
    "## What's already here",
    "",
    ...spec.standing.map((item) => `- ${item}`),
    "",
    "## What's missing",
    "",
    ...spec.missing.map((item) => `- [ ] ${item}`),
    "",
    "## Building it",
    "",
    "Nothing about tenancy, capabilities or the primitives needs to change.",
    "Follow the two reference modules:",
    "",
    "- **Reads** go in `src/lib/db/scoped/`, taking a `BuildingContext` first.",
    "  Move this module's queries out of `scoped/modules.ts` into their own file.",
    "- **Writes** go in a `*-writes.ts` module returning `Result<T>`, doing the",
    "  change and its audit record in one `withBuildingTx`.",
    "- **Server Actions** resolve their own context from the session and the URL",
    "  slug — never from a posted `buildingId`.",
    "- **Tests** go in `tests/<module>/`, against the real database.",
    "",
    "See `src/lib/db/scoped/compliance-writes.ts` and",
    "`src/lib/db/scoped/alteration-writes.ts` for the shape.",
    "",
  ].join("\n");
}

const root = join(process.cwd(), "src", "app", "b", "[buildingSlug]");

for (const spec of MODULES) {
  const path = join(root, spec.dir, "TODO.md");
  writeFileSync(path, render(spec), "utf8");
  console.info(`wrote ${path}`);
}
