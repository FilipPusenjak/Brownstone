import { describe, expect, it } from "vitest";
import {
  NOTICES,
  NOTICE_TYPES,
  readResponse,
  reasonToAct,
  silenceObliges,
  standingOf,
  type DeliveryFacts,
} from "~/lib/primitives/notices";

/**
 * What an answer means, and what silence means.
 *
 * The second one is the file. A building that files its unanswered apartments
 * as "no children" has read the law backwards, and it is the commonest way a
 * co-op fails a window guard audit having done all the work of sending the
 * notices.
 */

const answered = (answer: string): DeliveryFacts => ({
  unitId: answer,
  sent: true,
  bounced: false,
  response: readResponse({ answer }),
});

const silent = (unitId: string): DeliveryFacts => ({
  unitId,
  sent: true,
  bounced: false,
  response: null,
});

describe("reading a response", () => {
  it("takes the three answers the form offers", () => {
    expect(readResponse({ answer: "YES" })?.answer).toEqual("YES");
    expect(readResponse({ answer: "NO" })?.answer).toEqual("NO");
    expect(readResponse({ answer: "REQUESTED" })?.answer).toEqual("REQUESTED");
  });

  it("keeps a note, and drops an empty one", () => {
    expect(readResponse({ answer: "YES", note: "Twins, 4 and 7" })?.note).toEqual(
      "Twins, 4 and 7",
    );
    expect(readResponse({ answer: "YES", note: "   " })?.note).toBeNull();
    expect(readResponse({ answer: "YES" })?.note).toBeNull();
  });

  it("reads anything it cannot parse as no answer, never as a no", () => {
    // A row mangled by a bad migration has to fall on the safe side of the
    // line this module exists to draw. "No answer" puts the apartment on the
    // list of work; "no" would quietly take it off.
    for (const value of [null, undefined, {}, "YES", 3, { answer: "MAYBE" }, []]) {
      expect(readResponse(value)).toBeNull();
    }
  });
});

describe("what obliges the building", () => {
  it("a yes does", () => {
    expect(reasonToAct("WINDOW_GUARD", readResponse({ answer: "YES" }), false)).toEqual(
      "answered-yes",
    );
  });

  it("asking for them does, even with no child in the apartment", () => {
    // A resident with no children who wants window guards is entitled to them.
    // Folding this into "no" would lose the obligation entirely.
    expect(
      reasonToAct("WINDOW_GUARD", readResponse({ answer: "REQUESTED" }), false),
    ).toEqual("asked-for-it");
  });

  it("a no does not", () => {
    expect(
      reasonToAct("WINDOW_GUARD", readResponse({ answer: "NO" }), true),
    ).toBeNull();
  });

  it("silence does, once the household's time is up", () => {
    // The whole module in one assertion.
    expect(reasonToAct("WINDOW_GUARD", null, false)).toBeNull();
    expect(reasonToAct("WINDOW_GUARD", null, true)).toEqual("never-answered");
  });

  it("silence does not, for a notice that only informs", () => {
    // A gas leak procedure notice tells a household what to do; it does not ask
    // them anything, so an unanswered one leaves nothing owed.
    expect(silenceObliges("GAS_LEAK_PROCEDURE")).toBe(false);
    expect(reasonToAct("GAS_LEAK_PROCEDURE", null, true)).toBeNull();
    // But a request in reply still does.
    expect(
      reasonToAct("GAS_LEAK_PROCEDURE", readResponse({ answer: "REQUESTED" }), true),
    ).toEqual("asked-for-it");
  });

  it("obliges the building for the three January notices", () => {
    expect(silenceObliges("WINDOW_GUARD")).toBe(true);
    expect(silenceObliges("LEAD_PAINT")).toBe(true);
    expect(silenceObliges("STOVE_KNOB_COVER")).toBe(true);
  });
});

describe("the standing of a campaign", () => {
  const six: DeliveryFacts[] = [
    answered("YES"),
    answered("NO"),
    answered("REQUESTED"),
    silent("3R"),
    silent("4F"),
    { unitId: "GARDEN", sent: false, bounced: false, response: null },
  ];

  it("counts what went out and what came back", () => {
    const before = standingOf("WINDOW_GUARD", six, false);
    expect(before.total).toEqual(6);
    expect(before.notSent).toEqual(1);
    expect(before.sent).toEqual(5);
    expect(before.answered).toEqual(3);
    expect(before.silent).toEqual(3);
    expect(before.everyoneHeard).toBe(false);
  });

  it("does not count silence as work while the household still has time", () => {
    const before = standingOf("WINDOW_GUARD", six, false);
    expect(before.owedWork).toEqual(2); // the yes and the request
  });

  it("counts it the moment the deadline passes", () => {
    // Three more apartments, from doing nothing but waiting. This is the number
    // a reply count hides, and the reason the page leads with it.
    const after = standingOf("WINDOW_GUARD", six, true);
    expect(after.owedWork).toEqual(5);
  });

  it("says whether the notice reached everybody", () => {
    const allSent = six.map((row) => ({ ...row, sent: true }));
    expect(standingOf("WINDOW_GUARD", allSent, false).everyoneHeard).toBe(true);
  });

  it("counts a bounce as sent-but-not-arrived", () => {
    // The record still shows an attempt, which is what the log is for, but a
    // bounced address is exactly the apartment somebody has to walk a paper
    // copy to.
    const rows: DeliveryFacts[] = [
      { unitId: "1F", sent: true, bounced: true, response: null },
    ];
    const standing = standingOf("WINDOW_GUARD", rows, true);
    expect(standing.bounced).toEqual(1);
    expect(standing.owedWork).toEqual(1);
  });

  it("has nothing owed on an empty building", () => {
    expect(standingOf("WINDOW_GUARD", [], true)).toMatchObject({
      total: 0,
      owedWork: 0,
      everyoneHeard: true,
    });
  });
});

describe("the catalogue", () => {
  it("gives every notice a question, a citation and a consequence", () => {
    for (const type of NOTICE_TYPES) {
      const spec = NOTICES[type];
      expect(spec.title).toBeTruthy();
      expect(spec.citation).toBeTruthy();
      expect(spec.question).toMatch(/[?.]$/);
      expect(spec.owed).toBeTruthy();
      expect(spec.silenceMeans).toBeTruthy();
      expect(spec.respondWithinDays).toBeGreaterThan(0);
      // Every answer the form offers has words on it.
      for (const answer of ["YES", "NO", "REQUESTED"] as const) {
        expect(spec.answers[answer]).toBeTruthy();
      }
    }
  });

  it("points the three January notices at the rules that require them", () => {
    // The compliance calendar already carries these deadlines. A notice module
    // that invented its own copy of the law would be a second source of truth
    // for a date the ruleset already owns.
    expect(NOTICES.WINDOW_GUARD.ruleCode).toEqual("hpd-window-guard-notice");
    expect(NOTICES.LEAD_PAINT.ruleCode).toEqual("hpd-lead-paint-annual-notice");
    expect(NOTICES.STOVE_KNOB_COVER.ruleCode).toEqual("hpd-stove-knob-covers");
  });
});
