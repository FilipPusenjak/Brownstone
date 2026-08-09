/**
 * Development seed.
 *
 * Two buildings, always — and two that look alike on purpose. Both have a 2F, a
 * 3R and a 4F. Both have maintenance charges in the same range. One person,
 * Marta Oyelaran, is an active member of both, which is rare in life and
 * essential here.
 *
 * A single-building seed hides cross-tenant bugs until production, and a
 * two-building seed with obviously different data hides them almost as well: if
 * building B's rows are all labelled "Test 2", a leak looks like a leak. When
 * the two buildings are plausibly similar, a leak looks like *correct data*,
 * which is exactly the condition under which a real one would ship.
 *
 * Everything is written through `withBuildingTx`, the same wrapper the
 * application uses, so the seed is itself a proof that the scoped write path
 * works under row-level security.
 */
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { evaluate, type BuildingAttributes } from "../../src/lib/compliance/applicability";
import { withBuildingTx, withUntenantedTx } from "../../src/lib/db/tx";
import {
  nextDueDate,
  reminderDates,
} from "../../src/lib/primitives/obligations/recurrence";
import { makeDate, toDbDate, today } from "../../src/lib/time";
import { RULESET } from "./rules/ruleset";

const TODAY = today();

// ---------------------------------------------------------------------------
// Building specifications
// ---------------------------------------------------------------------------

interface UnitSpec {
  label: string;
  floorIndex: number;
  shares: number;
  holder: string;
  line?: string;
}

interface PersonSpec {
  email: string;
  name: string;
  roles: Array<
    "SHAREHOLDER" | "PRESIDENT" | "TREASURER" | "SECRETARY" | "BOARD_MEMBER" | "SUPER" | "OBSERVER"
  >;
  units: string[];
  title?: string;
}

interface BuildingSpec {
  slug: string;
  name: string;
  legalName: string;
  addressLine1: string;
  borough: "MANHATTAN" | "BROOKLYN" | "QUEENS" | "BRONX" | "STATEN_ISLAND";
  zip: string;
  communityDistrict: string;
  floorNaming: "BROWNSTONE" | "NUMERIC";
  stories: number;
  yearBuilt: number;
  grossSquareFeet: number;
  hasElevator: boolean;
  gasService: "NONE" | "COOKING_ONLY" | "HEATING_AND_COOKING" | "UNKNOWN";
  oilTankPresent: boolean;
  sprinklerStatus: "NONE" | "PARTIAL" | "FULL" | "UNKNOWN";
  isLandmarked: boolean;
  hasParapet: boolean;
  units: UnitSpec[];
  people: PersonSpec[];
  /** Rules the board has already confirmed, so the calendar is not empty. */
  confirmedRules: string[];
  /** Rules the board has looked at and dismissed, with a reason. */
  dismissedRules: Array<{ code: string; note: string }>;
}

const ADELAIDE: BuildingSpec = {
  slug: "adelaide",
  name: "The Adelaide",
  legalName: "Adelaide Place Owners Corp.",
  addressLine1: "114 Adelaide Place",
  borough: "BROOKLYN",
  zip: "11217",
  communityDistrict: "BK 06",
  floorNaming: "BROWNSTONE",
  stories: 4,
  yearBuilt: 1899,
  grossSquareFeet: 7_800,
  hasElevator: false,
  gasService: "HEATING_AND_COOKING",
  oilTankPresent: false,
  sprinklerStatus: "NONE",
  isLandmarked: true,
  hasParapet: true,
  units: [
    { label: "GARDEN", floorIndex: 0, shares: 180, holder: "Hal Brenner" },
    { label: "1F", floorIndex: 1, shares: 260, holder: "Nora Whitfield", line: "F" },
    { label: "2F", floorIndex: 2, shares: 240, holder: "Desmond Achebe", line: "F" },
    { label: "2R", floorIndex: 2, shares: 150, holder: "Marta Oyelaran", line: "R" },
    { label: "3R", floorIndex: 3, shares: 210, holder: "Priya Raman", line: "R" },
    { label: "4F", floorIndex: 4, shares: 160, holder: "Owen Castellanos", line: "F" },
  ],
  people: [
    {
      email: "nora.whitfield@example.com",
      name: "Nora Whitfield",
      roles: ["SHAREHOLDER", "PRESIDENT"],
      units: ["1F"],
      title: "Board President",
    },
    {
      email: "desmond.achebe@example.com",
      name: "Desmond Achebe",
      roles: ["SHAREHOLDER", "TREASURER"],
      units: ["2F"],
      title: "Treasurer",
    },
    {
      email: "priya.raman@example.com",
      name: "Priya Raman",
      roles: ["SHAREHOLDER", "SECRETARY"],
      units: ["3R"],
      title: "Secretary",
    },
    { email: "hal.brenner@example.com", name: "Hal Brenner", roles: ["SHAREHOLDER"], units: ["GARDEN"] },
    // The shared user. Also a member of Lispenard House, below.
    { email: "marta.oyelaran@example.com", name: "Marta Oyelaran", roles: ["SHAREHOLDER"], units: ["2R"] },
    {
      email: "owen.castellanos@example.com",
      name: "Owen Castellanos",
      roles: ["SHAREHOLDER"],
      units: ["4F"],
    },
    { email: "sal.ferrante@example.com", name: "Sal Ferrante", roles: ["SUPER"], units: [], title: "Superintendent" },
  ],
  confirmedRules: [
    "hpd-property-registration",
    "dob-boiler-annual-inspection",
    "hpd-window-guard-notice",
    "hpd-lead-paint-annual-notice",
    "dob-parapet-observation",
    "dof-coop-condo-abatement",
    "hpd-bedbug-annual-report",
  ],
  dismissedRules: [
    {
      code: "sprinkler-status-notice",
      note: "No sprinkler system, and counsel advised the lease disclosure rule is written for rental leases. Revisit if we ever sprinkler the cellar.",
    },
  ],
};

const LISPENARD: BuildingSpec = {
  slug: "lispenard-house",
  name: "Lispenard House",
  legalName: "Lispenard House Tenants Corp.",
  addressLine1: "27 Lispenard Street",
  borough: "MANHATTAN",
  zip: "10013",
  communityDistrict: "MN 01",
  floorNaming: "NUMERIC",
  stories: 7,
  yearBuilt: 1927,
  grossSquareFeet: 21_400,
  hasElevator: true,
  gasService: "COOKING_ONLY",
  oilTankPresent: true,
  sprinklerStatus: "PARTIAL",
  isLandmarked: false,
  hasParapet: true,
  units: [
    { label: "2F", floorIndex: 2, shares: 190, holder: "June Kobayashi", line: "F" },
    { label: "2R", floorIndex: 2, shares: 185, holder: "Terrence Bell", line: "R" },
    { label: "3F", floorIndex: 3, shares: 200, holder: "Anneke Vos", line: "F" },
    // Same label as a unit in The Adelaide, on purpose.
    { label: "3R", floorIndex: 3, shares: 195, holder: "Marta Oyelaran", line: "R" },
    { label: "4F", floorIndex: 4, shares: 205, holder: "Gideon Marsh", line: "F" },
    { label: "4R", floorIndex: 4, shares: 190, holder: "Constance Idowu", line: "R" },
    { label: "5F", floorIndex: 5, shares: 215, holder: "Ivan Petrosyan", line: "F" },
    { label: "5R", floorIndex: 5, shares: 195, holder: "Rosalind Hyde", line: "R" },
    { label: "6F", floorIndex: 6, shares: 225, holder: "Emmanuel Duarte", line: "F" },
    { label: "6R", floorIndex: 6, shares: 200, holder: "Wendy Okonkwo", line: "R" },
  ],
  people: [
    {
      email: "ivan.petrosyan@example.com",
      name: "Ivan Petrosyan",
      roles: ["SHAREHOLDER", "PRESIDENT"],
      units: ["5F"],
      title: "Board President",
    },
    {
      email: "june.kobayashi@example.com",
      name: "June Kobayashi",
      roles: ["SHAREHOLDER", "TREASURER"],
      units: ["2F"],
      title: "Treasurer",
    },
    {
      email: "anneke.vos@example.com",
      name: "Anneke Vos",
      roles: ["SHAREHOLDER", "BOARD_MEMBER"],
      units: ["3F"],
    },
    // The same person as in The Adelaide, by email.
    { email: "marta.oyelaran@example.com", name: "Marta Oyelaran", roles: ["SHAREHOLDER"], units: ["3R"] },
    { email: "gideon.marsh@example.com", name: "Gideon Marsh", roles: ["SHAREHOLDER"], units: ["4F"] },
    { email: "rosalind.hyde@example.com", name: "Rosalind Hyde", roles: ["OBSERVER"], units: [], title: "Managing agent (advisory)" },
  ],
  confirmedRules: [
    "hpd-property-registration",
    "dob-boiler-annual-inspection",
    "dob-elevator-cat1",
    "dob-elevator-cat5",
    "dob-facade-fisp",
    "dep-ll152-gas-piping",
    "hpd-window-guard-notice",
    "dof-coop-condo-abatement",
  ],
  dismissedRules: [
    {
      code: "hpd-lead-paint-annual-notice",
      note: "Building is post-1960. Confirmed against the certificate of occupancy at the March 2024 meeting.",
    },
  ],
};

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/**
 * Truncation runs as the owner over a direct connection. The runtime role is
 * deliberately not granted DELETE on the ledger or the audit log, and that
 * restriction should not be loosened to make a development script convenient.
 */
async function truncateAll(): Promise<void> {
  const url = process.env["DIRECT_URL"];
  if (!url) throw new Error("DIRECT_URL is not set.");

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables
       WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
    await client.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}

async function syncRules(): Promise<void> {
  await withUntenantedTx(async (tx) => {
    for (const rule of RULESET) {
      const data = {
        title: rule.title,
        authority: rule.authority,
        citation: rule.citation,
        sourceUrl: rule.sourceUrl ?? null,
        requirement: rule.requirement,
        appliesWhen: rule.appliesWhen,
        applicability: rule.applicability as never,
        recurrenceType: rule.recurrenceType,
        intervalMonths: rule.intervalMonths ?? null,
        cycleYears: rule.cycleYears ?? null,
        cycleAnchorYear: rule.cycleAnchorYear ?? null,
        cycleGroupSource: rule.cycleGroupSource ?? null,
        dueMonth: rule.dueMonth ?? null,
        dueDay: rule.dueDay ?? null,
        windowOpensMonth: rule.windowOpensMonth ?? null,
        windowOpensDay: rule.windowOpensDay ?? null,
        anchorOffsetMonths: rule.anchorOffsetMonths ?? null,
        reminderOffsets: rule.reminderOffsets,
        needsVerification: rule.needsVerification,
        verificationNote: rule.verificationNote ?? null,
      };
      await tx.complianceRule.upsert({
        where: { code: rule.code },
        create: { code: rule.code, ...data },
        update: data,
      });
    }
  });
}

/** Users are not owned by buildings, so they are created once, up front. */
async function upsertUsers(specs: BuildingSpec[]): Promise<Map<string, string>> {
  const byEmail = new Map<string, string>();
  const people = new Map<string, string>();
  for (const spec of specs) {
    for (const person of spec.people) people.set(person.email, person.name);
  }

  await withUntenantedTx(async (tx) => {
    for (const [email, name] of people) {
      const user = await tx.user.upsert({
        where: { email },
        create: { email, name, emailVerified: new Date() },
        update: { name },
        select: { id: true },
      });
      byEmail.set(email, user.id);
    }
  });

  return byEmail;
}

function attributesOf(spec: BuildingSpec): BuildingAttributes {
  return {
    unitCount: spec.units.length,
    stories: spec.stories,
    yearBuilt: spec.yearBuilt,
    grossSquareFeet: spec.grossSquareFeet,
    hasElevator: spec.hasElevator,
    gasService: spec.gasService,
    oilTankPresent: spec.oilTankPresent,
    sprinklerStatus: spec.sprinklerStatus,
    facadeHeightFt: null,
    isLandmarked: spec.isLandmarked,
    hasParapet: spec.hasParapet,
    ownerOccupied: true,
  };
}

async function seedBuilding(
  spec: BuildingSpec,
  usersByEmail: Map<string, string>,
): Promise<void> {
  const buildingId = randomUUID();
  const attributes = attributesOf(spec);

  await withBuildingTx(buildingId, async (tx) => {
    await tx.building.create({
      data: {
        id: buildingId,
        slug: spec.slug,
        name: spec.name,
        legalName: spec.legalName,
        addressLine1: spec.addressLine1,
        borough: spec.borough,
        zip: spec.zip,
        communityDistrict: spec.communityDistrict,
        floorNaming: spec.floorNaming,
        unitCount: spec.units.length,
        stories: spec.stories,
        yearBuilt: spec.yearBuilt,
        grossSquareFeet: spec.grossSquareFeet,
        hasElevator: spec.hasElevator,
        gasService: spec.gasService,
        oilTankPresent: spec.oilTankPresent,
        sprinklerStatus: spec.sprinklerStatus,
        isLandmarked: spec.isLandmarked,
        hasParapet: spec.hasParapet,
        attributeSource: "MANUAL",
        attributesConfirmedAt: new Date(),
        subletCapPercent: spec.slug === "adelaide" ? 20 : 25,
      },
    });

    // --- Units, shares and holders ---------------------------------------
    const unitIds = new Map<string, string>();
    for (const unit of spec.units) {
      const created = await tx.unit.create({
        data: {
          buildingId,
          label: unit.label,
          floorIndex: unit.floorIndex,
          line: unit.line ?? null,
          unitType: "RESIDENTIAL",
        },
        select: { id: true },
      });
      unitIds.set(unit.label, created.id);

      await tx.shareAllocation.create({
        data: {
          buildingId,
          unitId: created.id,
          shares: unit.shares,
          effectiveFrom: toDbDate(makeDate(spec.yearBuilt + 80, 1, 1)),
          note: "Original allocation under the offering plan",
        },
      });

      await tx.unitHolding.create({
        data: {
          buildingId,
          unitId: created.id,
          holderName: unit.holder,
          effectiveFrom: toDbDate(makeDate(2015, 6, 1)),
          certificateNo: `${spec.slug.slice(0, 3).toUpperCase()}-${unit.label}-001`,
        },
      });
    }

    // --- Memberships ------------------------------------------------------
    const membershipIds = new Map<string, string>();
    for (const person of spec.people) {
      const userId = usersByEmail.get(person.email);
      if (!userId) throw new Error(`No user for ${person.email}`);

      const membership = await tx.membership.create({
        data: {
          buildingId,
          userId,
          roles: person.roles,
          status: "ACTIVE",
          title: person.title ?? null,
          joinedOn: toDbDate(makeDate(2019, 4, 1)),
        },
        select: { id: true },
      });
      membershipIds.set(person.email, membership.id);

      for (const label of person.units) {
        const unitId = unitIds.get(label);
        if (!unitId) throw new Error(`No unit ${label} in ${spec.slug}`);
        await tx.membershipUnit.create({
          data: { buildingId, membershipId: membership.id, unitId, relation: "OWNER" },
        });
      }

      // Holdings point at the membership where the holder is also a user.
      const holdingUnit = person.units[0];
      if (holdingUnit) {
        await tx.unitHolding.updateMany({
          where: { unitId: unitIds.get(holdingUnit), holderName: person.name },
          data: { membershipId: membership.id },
        });
      }
    }

    const president = [...spec.people].find((p) => p.roles.includes("PRESIDENT"));
    const treasurer = [...spec.people].find((p) => p.roles.includes("TREASURER"));
    const presidentMembership = membershipIds.get(president?.email ?? "");
    const treasurerMembership = membershipIds.get(treasurer?.email ?? "");
    if (!presidentMembership || !treasurerMembership) {
      throw new Error(`${spec.slug} needs a president and a treasurer`);
    }

    // --- Compliance: assessments, then obligations ------------------------
    for (const rule of RULESET) {
      const verdict = evaluate(rule.applicability, attributes);
      const confirmed = spec.confirmedRules.includes(rule.code);
      const dismissal = spec.dismissedRules.find((d) => d.code === rule.code);

      const decision = confirmed ? "CONFIRMED" : dismissal ? "DISMISSED" : "PROPOSED";

      const assessment = await tx.buildingRuleAssessment.create({
        data: {
          buildingId,
          ruleCode: rule.code,
          engineVerdict: verdict.applies,
          engineReason: verdict.reason,
          engineInputs: verdict.inputs as never,
          decision,
          ...(decision === "PROPOSED"
            ? {}
            : {
                decidedAt: new Date(),
                decidedById: presidentMembership,
                decisionNote: dismissal?.note ?? null,
              }),
        },
        select: { id: true },
      });

      if (decision !== "CONFIRMED" || !verdict.applies) continue;

      // The board confirmed it, so it goes on the calendar.
      const result = nextDueDate(rule, {
        from: TODAY,
        // Give the anchored rules a plausible history, otherwise the elevator
        // Category 5 test is permanently indeterminate in a demo.
        lastCompletedOn:
          rule.recurrenceType === "ANCHORED_TO_COMPLETION"
            ? makeDate(Number(TODAY.slice(0, 4)) - 3, 6, 12)
            : null,
        ...(rule.recurrenceType === "CYCLICAL_BY_YEAR"
          ? {}
          : {}),
      });

      if (result.kind !== "due") continue;

      const obligation = await tx.obligation.create({
        data: {
          buildingId,
          kind: rule.code.includes("notice") ? "NOTICE" : "COMPLIANCE",
          title: rule.title,
          detail: rule.requirement,
          assessmentId: assessment.id,
          ruleCode: rule.code,
          dueOn: toDbDate(result.dueOn),
          recurrenceType: rule.recurrenceType,
          intervalMonths: rule.intervalMonths ?? null,
          cycleYears: rule.cycleYears ?? null,
          dueMonth: rule.dueMonth ?? null,
          dueDay: rule.dueDay ?? null,
          anchorOffsetMonths: rule.anchorOffsetMonths ?? null,
          reminderOffsets: rule.reminderOffsets,
          needsVerification: rule.needsVerification,
          assigneeId:
            rule.authority === "DOF" ? treasurerMembership : presidentMembership,
          state: "OPEN",
        },
        select: { id: true },
      });

      for (const reminder of reminderDates(result.dueOn, rule.reminderOffsets, TODAY)) {
        await tx.obligationReminder.create({
          data: {
            buildingId,
            obligationId: obligation.id,
            offsetDays: reminder.offsetDays,
            scheduledFor: toDbDate(reminder.scheduledFor),
          },
        });
      }
    }

    // A completed obligation from last year, so the calendar has history and
    // the "completed" state is visible without anyone clicking anything.
    await tx.obligation.create({
      data: {
        buildingId,
        kind: "COMPLIANCE",
        title: "HPD property registration",
        detail: "Registration renewed for the prior cycle.",
        ruleCode: "hpd-property-registration",
        dueOn: toDbDate(makeDate(Number(TODAY.slice(0, 4)) - 1, 9, 1)),
        completedOn: toDbDate(makeDate(Number(TODAY.slice(0, 4)) - 1, 8, 22)),
        completedById: presidentMembership,
        completionNote: "Filed online. Confirmation number on file.",
        state: "COMPLETED",
        recurrenceType: "FIXED_INTERVAL",
        intervalMonths: 12,
        dueMonth: 9,
        dueDay: 1,
        reminderOffsets: [60, 30, 7, 1],
      },
    });

    await seedBuildingExtras(tx, {
      buildingId,
      spec,
      unitIds,
      membershipIds,
      presidentMembership,
      treasurerMembership,
    });
  });

  console.info(`  ${spec.name} (${spec.slug}) — ${spec.units.length} units`);
}

interface ExtrasContext {
  buildingId: string;
  spec: BuildingSpec;
  unitIds: Map<string, string>;
  membershipIds: Map<string, string>;
  presidentMembership: string;
  treasurerMembership: string;
}

/**
 * Everything the scaffolded modules need in order to show something true, plus
 * the alteration and COI records module 4 is built against.
 */
async function seedBuildingExtras(
  tx: Parameters<Parameters<typeof withBuildingTx>[1]>[0],
  ctx: ExtrasContext,
): Promise<void> {
  const { buildingId, spec, unitIds, membershipIds, presidentMembership } = ctx;
  const year = Number(TODAY.slice(0, 4));
  const units = [...unitIds.entries()];
  const firstUnit = units[0]?.[1];
  const secondUnit = units[1]?.[1];
  if (!firstUnit || !secondUnit) return;

  const submitter =
    membershipIds.get(spec.people[3]?.email ?? "") ?? presidentMembership;

  // --- Alterations & COIs (module 4) ------------------------------------
  const approval = await tx.approvalRequest.create({
    data: {
      buildingId,
      kind: "ALTERATION",
      status: "UNDER_REVIEW",
      submittedById: submitter,
      assigneeId: presidentMembership,
      submittedAt: new Date(Date.now() - 9 * 86_400_000),
    },
    select: { id: true },
  });

  const alteration = await tx.alterationRequest.create({
    data: {
      buildingId,
      unitId: secondUnit,
      approvalRequestId: approval.id,
      title: "Kitchen renovation",
      scope:
        "Replace cabinets and counters, move the sink 60cm along the same wall, new dishwasher on the existing supply.",
      contractorName: "Bergen Street Builders",
      contractorLicense: "HIC-2041188",
      contractorPhone: "718-555-0142",
      wetOverDry: false,
      affectsStructure: false,
      affectsRiser: true,
      requiresDobPermit: true,
      dobJobNumber: "B00742193-I1",
      plannedStart: toDbDate(makeDate(year, 9, 15)),
      plannedEnd: toDbDate(makeDate(year, 11, 1)),
    },
    select: { id: true },
  });

  await tx.approvalComment.createMany({
    data: [
      {
        buildingId,
        requestId: approval.id,
        authorId: submitter,
        body: "Plans and the contractor's licence are attached. Happy to answer anything at the next meeting.",
        visibility: "SHARED",
      },
      {
        buildingId,
        requestId: approval.id,
        authorId: presidentMembership,
        body: "Moving the sink touches the riser, so we need the plumber's licence and a COI naming the corporation before this goes to a vote.",
        visibility: "BOARD_ONLY",
      },
    ],
  });

  const coiDoc = await tx.document.create({
    data: {
      buildingId,
      type: "CERTIFICATE_OF_INSURANCE",
      title: "Bergen Street Builders — general liability",
      storageKey: `buildings/${buildingId}/certificate_of_insurance/${randomUUID()}/bergen-street-coi.pdf`,
      contentType: "application/pdf",
      sizeBytes: 184_320,
      uploadedById: submitter,
      issuedOn: toDbDate(makeDate(year, 1, 8)),
      expiresOn: toDbDate(makeDate(year, 12, 31)),
    },
    select: { id: true },
  });

  await tx.documentLink.create({
    data: {
      buildingId,
      documentId: coiDoc.id,
      entityType: "ALTERATION_REQUEST",
      entityId: alteration.id,
    },
  });

  await tx.certificateOfInsurance.createMany({
    data: [
      {
        buildingId,
        documentId: coiDoc.id,
        holderKind: "CONTRACTOR",
        holderName: "Bergen Street Builders",
        unitId: secondUnit,
        alterationRequestId: alteration.id,
        carrier: "Hartford Casualty",
        policyNumber: "GL-4471902",
        coverageCents: 200_000_000,
        effectiveOn: toDbDate(makeDate(year, 1, 8)),
        expiresOn: toDbDate(makeDate(year, 12, 31)),
        additionalInsuredVerified: true,
        verifiedById: presidentMembership,
        verifiedAt: new Date(),
      },
      {
        // Expiring soon on purpose: the COI expiry alert is the entire value of
        // tracking these, so the seed should demonstrate one.
        buildingId,
        holderKind: "MOVER",
        holderName: "Vanguard Moving & Storage",
        unitId: firstUnit,
        carrier: "Travelers",
        policyNumber: "CMP-8830145",
        coverageCents: 100_000_000,
        effectiveOn: toDbDate(makeDate(year - 1, 9, 1)),
        expiresOn: toDbDate(makeDate(year, Number(TODAY.slice(5, 7)), 28)),
        additionalInsuredVerified: false,
      },
    ],
  });

  // --- Ledger (module 6) -------------------------------------------------
  // Similar amounts in both buildings, so a cross-tenant leak would look like
  // ordinary data rather than announcing itself.
  for (const [label, unitId] of units) {
    const base = 90_000 + label.length * 1_500;
    for (let monthsBack = 3; monthsBack >= 0; monthsBack -= 1) {
      const month = new Date(Date.UTC(year, new Date().getUTCMonth() - monthsBack, 1));
      const due = makeDate(month.getUTCFullYear(), month.getUTCMonth() + 1, 1);

      await tx.charge.create({
        data: {
          buildingId,
          unitId,
          kind: "MAINTENANCE",
          amountCents: base,
          dueOn: toDbDate(due),
          postedOn: toDbDate(due),
          memo: "Monthly maintenance",
          createdById: ctx.treasurerMembership,
        },
      });

      // One unit falls behind, so the aging view has something to show.
      const behind = label === "3R" && monthsBack <= 1;
      if (!behind) {
        await tx.payment.create({
          data: {
            buildingId,
            unitId,
            amountCents: base,
            receivedOn: toDbDate(due),
            method: "CHECK",
            reference: `${1200 + monthsBack}`,
            recordedById: ctx.treasurerMembership,
          },
        });
      }
    }
  }

  // --- Meetings (module 3) ----------------------------------------------
  const meeting = await tx.meeting.create({
    data: {
      buildingId,
      title: `${year} annual shareholders meeting`,
      type: "ANNUAL",
      scheduledFor: new Date(Date.UTC(year, 10, 12, 0, 30)),
      location: spec.slug === "adelaide" ? "Parlor floor, 1F" : "Lobby",
      // Two-thirds, exactly — the most common co-op bylaw threshold.
      quorumNumerator: 2,
      quorumDenominator: 3,
      quorumStrict: false,
    },
    select: { id: true },
  });

  await tx.resolution.create({
    data: {
      buildingId,
      meetingId: meeting.id,
      title: "Repoint the rear facade",
      text: "Resolved, that the corporation engage a mason to repoint the rear facade, at a cost not to exceed $48,000, funded from reserves.",
    },
  });

  // --- Bookings (module 7) ----------------------------------------------
  const resource = await tx.resource.create({
    data: {
      buildingId,
      name: spec.hasElevator ? "Freight elevator" : "Stoop and hallway (moves)",
      kind: spec.hasElevator ? "FREIGHT_ELEVATOR" : "COMMON_ROOM",
      slotMinutes: 240,
    },
    select: { id: true },
  });

  await tx.resourcePrerequisite.createMany({
    data: [
      { buildingId, resourceId: resource.id, type: "DEPOSIT_PAID", config: { amountCents: 50_000 } },
      { buildingId, resourceId: resource.id, type: "VALID_COI", config: { minimumCoverageCents: 100_000_000, requireAdditionalInsured: true } },
    ],
  });

  // --- Sublets (module 5) ------------------------------------------------
  const subletApproval = await tx.approvalRequest.create({
    data: {
      buildingId,
      kind: "SUBLET",
      status: "APPROVED",
      submittedById: submitter,
      submittedAt: new Date(Date.UTC(year, 2, 3)),
      decidedAt: new Date(Date.UTC(year, 2, 18)),
      decidedById: presidentMembership,
      decisionNote: "Approved for one year, renewable once under the house rules.",
    },
    select: { id: true },
  });

  await tx.subletRegistration.create({
    data: {
      buildingId,
      unitId: units[units.length - 1]?.[1] ?? firstUnit,
      approvalRequestId: subletApproval.id,
      subtenantName: spec.slug === "adelaide" ? "Delphine Okaro" : "Tomas Reyes",
      termStart: toDbDate(makeDate(year, 4, 1)),
      termEnd: toDbDate(makeDate(year + 1, 3, 31)),
      feeCents: 120_000,
    },
  });

  // --- Bookings (module 7) ------------------------------------------------
  await tx.booking.create({
    data: {
      buildingId,
      resourceId: resource.id,
      unitId: secondUnit,
      requestedById: submitter,
      startsAt: new Date(Date.UTC(year, new Date().getUTCMonth(), 22, 13, 0)),
      endsAt: new Date(Date.UTC(year, new Date().getUTCMonth(), 22, 17, 0)),
      status: "HELD",
      note: "Move-in. Deposit not yet recorded.",
    },
  });

  // --- Tickets (module 8) -----------------------------------------------
  await tx.ticket.createMany({
    data: [
      {
        buildingId,
        unitId: null,
        reportedById: submitter,
        title: "Front door latch not catching",
        detail: "The door bounces back unless you pull it hard. Getting worse in the damp.",
        area: "Entry",
        status: "TRIAGED",
        priority: "URGENT",
        responsibility: "COOPERATIVE",
      },
      {
        buildingId,
        unitId: firstUnit,
        reportedById: submitter,
        title: "Radiator knocking overnight",
        detail: "Loud banging from about 5am when the heat comes up.",
        area: "Heating",
        status: "OPEN",
        priority: "NORMAL",
        responsibility: "UNDETERMINED",
      },
    ],
  });

  // --- Duty rotation (module 9) -----------------------------------------
  const rotation = await tx.dutyRotation.create({
    data: {
      buildingId,
      name: "Trash and recycling set-out",
      kind: "TRASH_SET_OUT",
      unitOrder: units.map(([, id]) => id),
      startsOn: toDbDate(makeDate(year, 1, 6)),
      periodDays: 7,
    },
    select: { id: true },
  });

  await tx.dutyAssignment.create({
    data: {
      buildingId,
      rotationId: rotation.id,
      unitId: firstUnit,
      periodStart: toDbDate(TODAY),
      periodEnd: toDbDate(makeDate(Number(TODAY.slice(0, 4)), Number(TODAY.slice(5, 7)), 28)),
    },
  });

  await tx.dsnyFine.create({
    data: {
      buildingId,
      unitId: secondUnit,
      ticketNumber: spec.slug === "adelaide" ? "0093441882" : "0093441883",
      issuedOn: toDbDate(makeDate(year, Math.max(1, new Date().getUTCMonth()), 14)),
      violation: "Receptacle set out before 6pm",
      amountCents: 5_000,
    },
  });

  // --- Notices (module 2) ------------------------------------------------
  const campaign = await tx.noticeCampaign.create({
    data: {
      buildingId,
      noticeType: "WINDOW_GUARD",
      year,
      dueOn: toDbDate(makeDate(year, 1, 15)),
      sentAt: new Date(Date.UTC(year, 0, 4)),
    },
    select: { id: true },
  });

  for (const [label, unitId] of units) {
    const spec_ = spec.units.find((u) => u.label === label);
    await tx.noticeDelivery.create({
      data: {
        buildingId,
        campaignId: campaign.id,
        unitId,
        recipientName: spec_?.holder ?? label,
        respondedAt: label === "3R" ? null : new Date(Date.UTC(year, 0, 22)),
      },
    });
  }

  // --- Audit trail -------------------------------------------------------
  await tx.auditLog.create({
    data: {
      buildingId,
      actorMembershipId: presidentMembership,
      action: "building.create",
      entityType: "BUILDING",
      entityId: buildingId,
      summary: `${spec.name} added to Co-operator`,
    },
  });
}

async function main(): Promise<void> {
  console.info("Clearing existing data…");
  await truncateAll();

  console.info("Syncing compliance ruleset…");
  await syncRules();

  console.info("Creating users…");
  const users = await upsertUsers([ADELAIDE, LISPENARD]);

  console.info("Seeding buildings:");
  await seedBuilding(ADELAIDE, users);
  await seedBuilding(LISPENARD, users);

  console.info(
    [
      "",
      "Done. Two buildings, deliberately similar:",
      "  /b/adelaide         The Adelaide — 6 units, 1899, Brooklyn",
      "  /b/lispenard-house  Lispenard House — 10 units, 1927, Manhattan",
      "",
      "Both have a 2F, a 3R and a 4F. marta.oyelaran@example.com is an active",
      "member of both — sign in as her to exercise the building switcher, and",
      "note that she must never see one building's records inside the other.",
      "",
    ].join("\n"),
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
