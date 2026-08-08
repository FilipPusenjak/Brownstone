import type { Predicate } from "../../../src/lib/compliance/applicability";

/**
 * The compliance ruleset.
 *
 * Rules are reference data shared by every co-op in the city, upserted by
 * `code` through `pnpm rules:sync`, so a citation can be corrected in
 * production without touching a single building's records.
 *
 * Three rules govern what goes in this file:
 *
 * 1. **Nothing without a citation.** Every entry names the law it comes from.
 *
 * 2. **`needsVerification` is not a formality.** Where the obligation certainly
 *    exists but a detail could not be confirmed — the exact filing date, an
 *    exemption boundary, a phase-in year — the rule is flagged and the note
 *    says precisely what is unconfirmed. The UI shows it as unverified. A
 *    confidently wrong deadline in a compliance product is worse than a missing
 *    one, because a missing one gets researched and a wrong one gets trusted.
 *
 * 3. **Rules that don't apply still belong here.** The benchmarking laws never
 *    touch a twelve-unit brownstone, and seeing "does not apply: gross floor
 *    area is under 25,000 sq ft" is worth more to a board than silence.
 *
 * Co-operator is a tracking tool, not legal advice. Boards remain responsible
 * for their own filings, and this file is a starting point for a conversation
 * with their attorney, not a substitute for one.
 */

export interface RuleSeed {
  code: string;
  title: string;
  authority: "DOB" | "HPD" | "FDNY" | "DEP" | "DSNY" | "DOHMH" | "DOF" | "OTHER";
  citation: string;
  sourceUrl?: string;
  requirement: string;
  appliesWhen: string;
  applicability: Predicate;
  recurrenceType: "NONE" | "FIXED_INTERVAL" | "CYCLICAL_BY_YEAR" | "ANCHORED_TO_COMPLETION";
  intervalMonths?: number;
  cycleYears?: number;
  cycleAnchorYear?: number;
  cycleGroupSource?: string;
  dueMonth?: number;
  dueDay?: number;
  windowOpensMonth?: number;
  windowOpensDay?: number;
  anchorOffsetMonths?: number;
  reminderOffsets: number[];
  needsVerification: boolean;
  verificationNote?: string;
}

/** Three or more dwelling units — the multiple-dwelling line most rules turn on. */
const MULTIPLE_DWELLING: Predicate = { attr: "unitCount", op: "gte", value: 3 };

export const RULESET: RuleSeed[] = [
  // -------------------------------------------------------------------------
  // HPD
  // -------------------------------------------------------------------------
  {
    code: "hpd-property-registration",
    title: "HPD property registration",
    authority: "HPD",
    citation: "NYC Admin Code § 27-2097",
    sourceUrl: "https://www.nyc.gov/site/hpd/services-and-information/register-your-property.page",
    requirement:
      "Register the building with HPD and renew the registration every year. The registration names the managing agent and an officer who can be reached about emergencies.",
    appliesWhen: "The building has three or more dwelling units.",
    applicability: MULTIPLE_DWELLING,
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 9,
    dueDay: 1,
    reminderOffsets: [60, 30, 7, 1],
    needsVerification: false,
  },
  {
    code: "hpd-window-guard-notice",
    title: "Window guard annual notice",
    authority: "HPD",
    citation: "NYC Health Code art. 131; NYC Admin Code § 27-2043.1",
    sourceUrl: "https://www.nyc.gov/site/hpd/services-and-information/window-guards.page",
    requirement:
      "Send every household the annual window guard notice, asking whether a child under 11 lives in the apartment, and keep the returned forms. Install guards wherever a child under 11 lives or a resident asks for them.",
    appliesWhen: "The building has three or more dwelling units.",
    applicability: MULTIPLE_DWELLING,
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 1,
    dueDay: 15,
    windowOpensMonth: 1,
    windowOpensDay: 1,
    reminderOffsets: [30, 14, 3],
    needsVerification: true,
    verificationNote:
      "The annual notice must go out in the first half of January and residents respond by mid-February, but confirm the exact delivery and response dates with HPD's current form before relying on this date.",
  },
  {
    code: "hpd-lead-paint-annual-notice",
    title: "Lead paint annual notice and inspection",
    authority: "HPD",
    citation: "Local Law 1 of 2004; NYC Admin Code § 27-2056.4",
    sourceUrl: "https://www.nyc.gov/site/hpd/services-and-information/lead-based-paint.page",
    requirement:
      "Send the annual notice asking whether a child under six lives in the apartment, inspect any apartment where one does, and keep the records for ten years.",
    appliesWhen:
      "The building has three or more dwelling units and was built before 1960.",
    applicability: {
      all: [MULTIPLE_DWELLING, { attr: "yearBuilt", op: "lt", value: 1960 }],
    },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 1,
    dueDay: 15,
    windowOpensMonth: 1,
    windowOpensDay: 1,
    reminderOffsets: [30, 14, 3],
    needsVerification: true,
    verificationNote:
      "Buildings built between 1960 and 1978 are also covered where the owner knows lead paint is present, which is not something this rule can infer from building attributes. Confirm the exact annual notice date with HPD's current form.",
  },
  {
    code: "hpd-bedbug-annual-report",
    title: "Bedbug annual report",
    authority: "HPD",
    citation: "Local Law 69 of 2017; NYC Admin Code § 27-2018.1",
    sourceUrl: "https://www.nyc.gov/site/hpd/services-and-information/bedbugs.page",
    requirement:
      "File the building's bedbug infestation history with HPD each year and give a copy to every household and to new shareholders before they sign.",
    appliesWhen: "The building has three or more dwelling units.",
    applicability: MULTIPLE_DWELLING,
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 12,
    dueDay: 31,
    reminderOffsets: [45, 14, 3],
    needsVerification: true,
    verificationNote:
      "The report is filed annually alongside the HPD registration cycle, but the filing window has moved since the law was introduced. Confirm this year's window on HPD's site before treating the date as fixed.",
  },
  {
    code: "hpd-indoor-allergen-inspection",
    title: "Indoor allergen hazard inspection",
    authority: "HPD",
    citation: "Local Law 55 of 2018 (Asthma Free Housing Act); NYC Admin Code § 27-2017 et seq.",
    sourceUrl: "https://www.nyc.gov/site/hpd/services-and-information/indoor-allergen-hazards.page",
    requirement:
      "Inspect every apartment once a year for mould, pests and the conditions that cause them, fix what you find, and keep the records.",
    appliesWhen: "The building has three or more dwelling units.",
    applicability: MULTIPLE_DWELLING,
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    reminderOffsets: [30, 7],
    needsVerification: true,
    verificationNote:
      "The annual inspection is required but the law sets no single citywide date — buildings choose their own cycle. Set the due date to whatever this building actually does, and record it.",
  },
  {
    code: "hpd-stove-knob-covers",
    title: "Stove knob cover notice",
    authority: "HPD",
    citation: "Local Law 117 of 2018; NYC Admin Code § 27-2046.4",
    requirement:
      "Ask every household each year whether a child under six lives there or a resident wants stove knob covers, and provide covers for gas stoves where the answer is yes.",
    appliesWhen:
      "The building has three or more dwelling units and gas service for cooking.",
    applicability: {
      all: [
        MULTIPLE_DWELLING,
        { attr: "gasService", op: "in", value: ["COOKING_ONLY", "HEATING_AND_COOKING"] },
      ],
    },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 1,
    dueDay: 15,
    reminderOffsets: [30, 7],
    needsVerification: true,
    verificationNote:
      "Usually sent with the January window guard and lead paint notices. Confirm whether your building must send it separately and on what date.",
  },

  // -------------------------------------------------------------------------
  // DOB
  // -------------------------------------------------------------------------
  {
    code: "dob-boiler-annual-inspection",
    title: "Annual boiler inspection",
    authority: "DOB",
    citation: "NYC Admin Code § 28-303",
    sourceUrl: "https://www.nyc.gov/site/buildings/safety/boilers.page",
    requirement:
      "Have the low-pressure boiler inspected by a licensed inspector once a year and file the report with the Department of Buildings.",
    appliesWhen:
      "The building has three or more dwelling units and a central boiler running on gas or oil.",
    applicability: {
      all: [
        MULTIPLE_DWELLING,
        {
          any: [
            { attr: "gasService", op: "eq", value: "HEATING_AND_COOKING" },
            { attr: "oilTankPresent", op: "eq", value: true },
          ],
        },
      ],
    },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 12,
    dueDay: 31,
    reminderOffsets: [90, 30, 14, 3],
    needsVerification: true,
    verificationNote:
      "The inspection runs on a calendar-year cycle and the report is filed within a set number of days of the inspection, not on a fixed citywide date. Confirm the current filing window with DOB, and note that the report — not the inspection — is what carries the penalty.",
  },
  {
    code: "dob-elevator-cat1",
    title: "Elevator Category 1 inspection",
    authority: "DOB",
    citation: "NYC Admin Code § 28-304",
    sourceUrl: "https://www.nyc.gov/site/buildings/safety/elevators.page",
    requirement:
      "Have each elevator given its Category 1 periodic inspection and test every year, and file the report with DOB.",
    appliesWhen: "The building has an elevator.",
    applicability: { attr: "hasElevator", op: "eq", value: true },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 12,
    dueDay: 31,
    reminderOffsets: [90, 30, 14, 3],
    needsVerification: true,
    verificationNote:
      "Confirm the current filing deadline and the separate deadline for filing proof that any defects were corrected — the second one is the deadline buildings usually miss.",
  },
  {
    code: "dob-elevator-cat5",
    title: "Elevator Category 5 test",
    authority: "DOB",
    citation: "NYC Admin Code § 28-304",
    sourceUrl: "https://www.nyc.gov/site/buildings/safety/elevators.page",
    requirement:
      "Have each elevator given its Category 5 test every five years, timed from the last one that passed.",
    appliesWhen: "The building has an elevator.",
    applicability: { attr: "hasElevator", op: "eq", value: true },
    // Anchored, not fixed: the next test is due five years after the last one
    // passed, which is not a date any calendar can know in advance.
    recurrenceType: "ANCHORED_TO_COMPLETION",
    anchorOffsetMonths: 60,
    reminderOffsets: [180, 90, 30, 7],
    needsVerification: true,
    verificationNote:
      "Confirm the exact cycle and filing deadline with DOB. Record the date of the last passing test so the next one anchors correctly.",
  },
  {
    code: "dob-facade-fisp",
    title: "Facade inspection (FISP)",
    authority: "DOB",
    citation: "Local Law 11 of 1998; NYC Admin Code § 28-302",
    sourceUrl: "https://www.nyc.gov/site/buildings/safety/facades.page",
    requirement:
      "Have the facade inspected by a qualified engineer or architect on the city's five-year cycle and file the report.",
    appliesWhen: "The building is more than six stories tall.",
    applicability: { attr: "stories", op: "gt", value: 6 },
    recurrenceType: "CYCLICAL_BY_YEAR",
    cycleYears: 5,
    cycleGroupSource: "block",
    reminderOffsets: [365, 180, 90, 30],
    needsVerification: true,
    verificationNote:
      "The city staggers filing windows across three sub-cycles by block number, so the year this is due depends on where the building sits. Confirm the building's sub-cycle and window with DOB.",
  },
  {
    code: "dob-parapet-observation",
    title: "Annual parapet observation",
    authority: "DOB",
    citation: "Local Law 126 of 2021; NYC Admin Code § 28-301.1; 1 RCNY 103-15",
    sourceUrl: "https://www.nyc.gov/site/buildings/safety/facades.page",
    requirement:
      "Have the parapet walls facing the street observed once a year, write down what was found, and keep the record. This one is new, and most small buildings have never heard of it.",
    appliesWhen:
      "The building has a parapet facing a public right of way and three or more dwelling units.",
    applicability: {
      all: [{ attr: "hasParapet", op: "eq", value: true }, MULTIPLE_DWELLING],
    },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    reminderOffsets: [60, 14],
    needsVerification: true,
    verificationNote:
      "Confirm which buildings are exempt — detached one- and two-family homes are, and there are conditions about parapets not fronting the public right of way. Also confirm who is qualified to perform the observation, which is looser than for a full facade inspection.",
  },
  {
    code: "dep-ll152-gas-piping",
    title: "Gas piping system inspection",
    authority: "DOB",
    citation: "Local Law 152 of 2016; NYC Admin Code § 28-318",
    sourceUrl: "https://www.nyc.gov/site/buildings/safety/gas-piping-inspections.page",
    requirement:
      "Have the exposed gas piping inspected by a licensed master plumber on the city's four-year cycle and file the certification.",
    appliesWhen:
      "The building has gas service and three or more dwelling units.",
    applicability: {
      all: [MULTIPLE_DWELLING, { attr: "gasService", op: "ne", value: "NONE" }],
    },
    recurrenceType: "CYCLICAL_BY_YEAR",
    cycleYears: 4,
    cycleGroupSource: "communityDistrict",
    reminderOffsets: [180, 90, 30, 7],
    needsVerification: true,
    verificationNote:
      "The due year depends on the building's community district — the city inspects the districts on a rotating four-year schedule. Confirm this building's district and its year before relying on the date.",
  },
  {
    code: "dob-energy-benchmarking",
    title: "Energy and water benchmarking",
    authority: "DOB",
    citation: "Local Law 84 of 2009; NYC Admin Code § 28-309",
    sourceUrl: "https://www.nyc.gov/site/buildings/codes/benchmarking.page",
    requirement:
      "Report the building's annual energy and water use to the city.",
    appliesWhen: "The building is larger than 25,000 square feet.",
    applicability: { attr: "grossSquareFeet", op: "gte", value: 25_000 },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 5,
    dueDay: 1,
    reminderOffsets: [60, 30, 7],
    needsVerification: false,
  },
  {
    code: "dob-ll97-emissions",
    title: "Building emissions report",
    authority: "DOB",
    citation: "Local Law 97 of 2019; NYC Admin Code § 28-320",
    sourceUrl: "https://www.nyc.gov/site/buildings/codes/local-law-97.page",
    requirement:
      "File an annual emissions report certified by a registered design professional, and stay under the building's emissions limit.",
    appliesWhen: "The building is larger than 25,000 square feet.",
    applicability: { attr: "grossSquareFeet", op: "gte", value: 25_000 },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 5,
    dueDay: 1,
    reminderOffsets: [90, 30, 7],
    needsVerification: true,
    verificationNote:
      "Confirm the current reporting deadline and which compliance period the building is in. The limits tighten over time and the filing dates have shifted since the law passed.",
  },

  // -------------------------------------------------------------------------
  // Other agencies
  // -------------------------------------------------------------------------
  {
    code: "dof-coop-condo-abatement",
    title: "Co-op property tax abatement renewal",
    authority: "DOF",
    citation: "NYC Admin Code § 11-245.1-a",
    sourceUrl: "https://www.nyc.gov/site/finance/property/landlords-coop-condo-abatement.page",
    requirement:
      "File the annual renewal with the Department of Finance so shareholders keep the co-op and condo property tax abatement, including any changes in which units are primary residences.",
    appliesWhen: "Every co-op.",
    applicability: { always: true },
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 2,
    dueDay: 15,
    reminderOffsets: [60, 30, 7, 1],
    needsVerification: true,
    verificationNote:
      "Confirm this year's filing deadline and which form applies to a self-managed building with no managing agent. Missing it costs every shareholder money, so it is worth checking rather than assuming.",
  },
  {
    code: "dohmh-smoke-co-annual-notice",
    title: "Smoke and carbon monoxide detector annual notice",
    authority: "HPD",
    citation: "NYC Admin Code §§ 27-2045, 27-2046.1",
    requirement:
      "Give every household the annual notice about their duty to keep smoke and carbon monoxide detectors working, and keep the records of installation and replacement.",
    appliesWhen: "The building has three or more dwelling units.",
    applicability: MULTIPLE_DWELLING,
    recurrenceType: "FIXED_INTERVAL",
    intervalMonths: 12,
    dueMonth: 1,
    dueDay: 15,
    reminderOffsets: [30, 7],
    needsVerification: true,
    verificationNote:
      "Usually delivered with the January annual notices. Confirm the current requirement and whether a separate notice is needed — the smoke and carbon monoxide rules have separate sections and have been amended repeatedly.",
  },
  {
    code: "sprinkler-status-notice",
    title: "Sprinkler system status notice",
    authority: "OTHER",
    citation: "NY Real Property Law § 231-b",
    requirement:
      "Tell residents in writing whether the building has a sprinkler system, and if so when it was last maintained and inspected.",
    appliesWhen: "Every building, subject to the note below.",
    applicability: { always: true },
    recurrenceType: "NONE",
    reminderOffsets: [30],
    needsVerification: true,
    verificationNote:
      "This requirement is written for residential leases, and how it applies to a co-op proprietary lease is genuinely unsettled. Ask the building's attorney before treating it as an obligation — it is listed here so the board knows the question exists, not because Co-operator has concluded it applies.",
  },
];
