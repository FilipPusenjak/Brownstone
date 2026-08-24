/**
 * The annual notices, and what an answer obliges.
 *
 * Every January a New York co-op has to write to every household and ask a
 * short list of questions the city sets: is there a child under eleven here, is
 * there a child under six, would you like stove knob covers. The building is
 * required to send them, to keep what comes back, and — this is the part
 * buildings get wrong — to **act on the apartments that never replied**.
 *
 * Under the window guard rule an owner who receives no response must treat the
 * apartment as though a child lives there: inspect it, and install guards. The
 * common failure is to send the notice, count the replies, and file the silent
 * apartments as "no children", which is precisely the reading the law does not
 * allow. So the number this module puts in front of a board is not "twelve
 * sent, nine replied" — it is **which apartments the building now owes work
 * to**, and silence is in that list.
 *
 * Everything here is pure. What was sent, and when, lives in the notification
 * log; who answered lives in `NoticeDelivery`. This file only knows what the
 * questions are and what the answers mean.
 */

export type NoticeType =
  | "WINDOW_GUARD"
  | "LEAD_PAINT"
  | "STOVE_KNOB_COVER"
  | "SPRINKLER_STATUS"
  | "BEDBUG_HISTORY"
  | "GAS_LEAK_PROCEDURE";

/**
 * How a household answered.
 *
 * `REQUESTED` is its own answer rather than a flavour of `NO`, because the
 * window guard law obliges the building either way: a resident with no children
 * who asks for guards is entitled to them. Folding it into `YES` would lose the
 * distinction the returned form actually makes, and folding it into `NO` would
 * lose the obligation.
 */
export type Answer = "YES" | "NO" | "REQUESTED";

export interface NoticeSpec {
  readonly title: string;
  readonly citation: string;
  /** The compliance rule this notice discharges, where there is one. */
  readonly ruleCode: string | null;
  /** The question the law makes the building ask, in the law's own terms. */
  readonly question: string;
  /** What each answer means, in the words that go on the form. */
  readonly answers: Readonly<Record<Answer, string>>;
  /** What the building owes an apartment that answered yes, or never answered. */
  readonly owed: string;
  /** Why silence counts as yes here — the sentence a board will be asked for. */
  readonly silenceMeans: string;
  /** Days a household has to reply once the notice goes out. */
  readonly respondWithinDays: number;
}

export const NOTICES: Readonly<Record<NoticeType, NoticeSpec>> = {
  WINDOW_GUARD: {
    title: "Window guard annual notice",
    citation: "NYC Health Code art. 131; NYC Admin Code § 27-2043.1",
    ruleCode: "hpd-window-guard-notice",
    question: "Does a child ten years old or younger live in your apartment?",
    answers: {
      YES: "Yes — a child ten or younger lives here",
      NO: "No child ten or younger lives here",
      REQUESTED: "No, but I want window guards installed anyway",
    },
    owed: "Inspect the apartment and install window guards on every window.",
    silenceMeans:
      "An apartment that does not answer is treated as though a child lives there. The owner cannot conclude otherwise from silence, and the guards have to go in.",
    respondWithinDays: 30,
  },
  LEAD_PAINT: {
    title: "Lead paint annual notice",
    citation: "Local Law 1 of 2004; NYC Admin Code § 27-2056.4",
    ruleCode: "hpd-lead-paint-annual-notice",
    question: "Does a child under six years old live in your apartment?",
    answers: {
      YES: "Yes — a child under six lives here",
      NO: "No child under six lives here",
      REQUESTED: "No, but I want the apartment inspected anyway",
    },
    owed: "Inspect the apartment for lead paint hazards and keep the record for ten years.",
    silenceMeans:
      "Where no response comes back the owner must still investigate the apartment. Local Law 1 does not let an unanswered notice stand as a no.",
    respondWithinDays: 30,
  },
  STOVE_KNOB_COVER: {
    title: "Stove knob cover notice",
    citation: "Local Law 117 of 2018; NYC Admin Code § 27-2046.4",
    ruleCode: "hpd-stove-knob-covers",
    question:
      "Does a child under six live in your apartment, or would you like stove knob covers?",
    answers: {
      YES: "Yes — a child under six lives here",
      NO: "No child under six, and I don't want covers",
      REQUESTED: "No child under six, but I want covers anyway",
    },
    owed: "Provide and install stove knob covers on the gas stove.",
    silenceMeans:
      "An apartment that does not answer is treated as one that needs covers, because the building cannot show otherwise.",
    respondWithinDays: 30,
  },
  SPRINKLER_STATUS: {
    title: "Sprinkler status notice",
    citation: "NYC Admin Code § 27-2046.2",
    ruleCode: null,
    question: "Acknowledge the building's sprinkler status.",
    answers: {
      YES: "Acknowledged",
      NO: "Acknowledged",
      REQUESTED: "Acknowledged, and I have a question",
    },
    owed: "Answer the household's question about the sprinkler system.",
    silenceMeans:
      "This notice informs rather than asks. An apartment that does not reply is still on the record as having been told.",
    respondWithinDays: 30,
  },
  BEDBUG_HISTORY: {
    title: "Bedbug infestation history notice",
    citation: "NYC Admin Code § 27-2018.1",
    ruleCode: "hpd-bedbug-annual-report",
    question: "Acknowledge the building's bedbug history for the past year.",
    answers: {
      YES: "Acknowledged, and I have had an infestation",
      NO: "Acknowledged",
      REQUESTED: "Acknowledged, and I want the apartment inspected",
    },
    owed: "Arrange an inspection and record what was found.",
    silenceMeans:
      "This notice informs rather than asks. An apartment that does not reply is still on the record as having been told.",
    respondWithinDays: 30,
  },
  GAS_LEAK_PROCEDURE: {
    title: "Gas leak procedure notice",
    citation: "Local Law 152 of 2016; NYC Admin Code § 28-317.3",
    ruleCode: null,
    question: "Acknowledge what to do if you smell gas.",
    answers: {
      YES: "Acknowledged",
      NO: "Acknowledged",
      REQUESTED: "Acknowledged, and I want to report a smell of gas",
    },
    owed: "Have the line inspected and record what was found.",
    silenceMeans:
      "This notice informs rather than asks. An apartment that does not reply is still on the record as having been told.",
    respondWithinDays: 30,
  },
};

export const NOTICE_TYPES = Object.keys(NOTICES) as NoticeType[];

/** Notices where an unanswered apartment obliges the building to act anyway. */
const SILENCE_OBLIGES: ReadonlySet<NoticeType> = new Set<NoticeType>([
  "WINDOW_GUARD",
  "LEAD_PAINT",
  "STOVE_KNOB_COVER",
]);

export function silenceObliges(type: NoticeType): boolean {
  return SILENCE_OBLIGES.has(type);
}

export interface NoticeResponse {
  readonly answer: Answer;
  readonly note: string | null;
}

const ANSWERS: ReadonlySet<string> = new Set(["YES", "NO", "REQUESTED"]);

/**
 * Reads a stored response back, or null if there is not one.
 *
 * The column is JSON because different notices ask different questions, and
 * the row is a legal record of what a household actually said. Anything that
 * does not parse reads as *no answer* rather than as a no — the whole point of
 * this module is that those are not the same thing, and a corrupt row must fall
 * on the safe side of that line.
 */
export function readResponse(value: unknown): NoticeResponse | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as { answer?: unknown; note?: unknown };
  if (typeof raw.answer !== "string" || !ANSWERS.has(raw.answer)) return null;
  return {
    answer: raw.answer as Answer,
    note: typeof raw.note === "string" && raw.note.trim() ? raw.note : null,
  };
}

/** Why the building owes this apartment work, or null if it does not. */
export type ActionReason = "answered-yes" | "asked-for-it" | "never-answered";

export function reasonToAct(
  type: NoticeType,
  response: NoticeResponse | null,
  deadlinePassed: boolean,
): ActionReason | null {
  if (response) {
    if (response.answer === "YES") return "answered-yes";
    if (response.answer === "REQUESTED") return "asked-for-it";
    return null;
  }
  // No answer. Only obliges the building once the household's time is up, and
  // only for the notices where the law says so.
  if (!deadlinePassed) return null;
  return silenceObliges(type) ? "never-answered" : null;
}

export function describeReason(type: NoticeType, reason: ActionReason): string {
  switch (reason) {
    case "answered-yes":
      return `Answered yes. ${NOTICES[type].owed}`;
    case "asked-for-it":
      return `Asked for it. ${NOTICES[type].owed}`;
    case "never-answered":
      return `Never answered. ${NOTICES[type].silenceMeans}`;
  }
}

export interface DeliveryFacts {
  readonly unitId: string;
  readonly sent: boolean;
  readonly bounced: boolean;
  readonly response: NoticeResponse | null;
}

export interface Standing {
  readonly total: number;
  /** Apartments the notice has not gone to at all. */
  readonly notSent: number;
  readonly sent: number;
  readonly bounced: number;
  readonly answered: number;
  readonly silent: number;
  /**
   * Apartments the building owes work to: answered yes, asked for it, or —
   * once the deadline has passed — never answered at all. The number a board
   * actually has to act on, and the one a reply count hides.
   */
  readonly owedWork: number;
  /** Every apartment has had the notice, and nobody is still owed an answer. */
  readonly everyoneHeard: boolean;
}

export function standingOf(
  type: NoticeType,
  deliveries: readonly DeliveryFacts[],
  deadlinePassed: boolean,
): Standing {
  const total = deliveries.length;
  const notSent = deliveries.filter((row) => !row.sent).length;
  const bounced = deliveries.filter((row) => row.bounced).length;
  const answered = deliveries.filter((row) => row.response !== null).length;

  const owedWork = deliveries.filter(
    (row) => reasonToAct(type, row.response, deadlinePassed) !== null,
  ).length;

  return {
    total,
    notSent,
    sent: total - notSent,
    bounced,
    answered,
    silent: total - answered,
    owedWork,
    everyoneHeard: notSent === 0,
  };
}
