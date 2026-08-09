import { describe, expect, it } from "vitest";
import { evaluate, type BuildingAttributes } from "~/lib/compliance/applicability";
import { capabilitiesFor } from "~/lib/auth/capabilities";
import { unitFilter, visibility } from "~/lib/db/visibility";
import { dollars, formatMoney, money, parseMoney } from "~/lib/money";
import { floorTag, stackByFloor } from "~/lib/building/floors";
import {
  keyBelongsTo,
  safeFilename,
  storageKey,
  validateUpload,
} from "~/lib/storage";
import { reminderDedupeKey } from "~/lib/email/send";
import {
  addMonths,
  daysBetween,
  plainDate,
  relativeDays,
  toPlainDate,
  today,
} from "~/lib/time";

describe("money", () => {
  it("refuses a non-integer, naming the likely mistake", () => {
    expect(() => money(2.5)).toThrow(/dollars/);
  });

  it("converts dollars to cents", () => {
    expect(dollars(1250.5)).toEqual(125_050);
  });

  it("adds without floating point error", () => {
    // 0.1 + 0.2 in dollars is the canonical failure. In cents it is 30.
    expect(dollars(0.1) + dollars(0.2)).toEqual(30);
  });

  it("parses what people actually type", () => {
    expect(parseMoney("$1,250.00")).toEqual(125_000);
    expect(parseMoney("1250")).toEqual(125_000);
    expect(parseMoney(" 1,250.5 ")).toEqual(125_050);
  });

  it("returns null rather than zero on nonsense", () => {
    // Silently posting a zero charge is worse than refusing the input.
    for (const input of ["", "abc", "12.345", "1.2.3", "--5"]) {
      expect(parseMoney(input), input).toBeNull();
    }
  });

  it("formats for display", () => {
    expect(formatMoney(money(125_000))).toEqual("$1,250.00");
  });
});

describe("dates", () => {
  it("reads a @db.Date column without shifting the day", () => {
    // Postgres hands back UTC midnight. Local getters in New York would return
    // the previous day for five months of the year.
    const fromDb = new Date("2026-03-01T00:00:00.000Z");
    expect(toPlainDate(fromDb)).toEqual("2026-03-01");
  });

  it("survives the day the clocks change", () => {
    // 1 November 2026 is the Sunday the US falls back.
    const before = plainDate("2026-10-31");
    const after = plainDate("2026-11-02");
    expect(daysBetween(before, after)).toEqual(2);
  });

  it("clamps month arithmetic rather than rolling over", () => {
    expect(addMonths(plainDate("2026-01-31"), 1)).toEqual("2026-02-28");
    expect(addMonths(plainDate("2028-01-31"), 1)).toEqual("2028-02-29");
  });

  it("counts relative days exactly", () => {
    const from = plainDate("2026-08-09");
    expect(relativeDays(from, plainDate("2026-09-01"))).toEqual("in 23 days");
    expect(relativeDays(from, plainDate("2026-08-09"))).toEqual("today");
    expect(relativeDays(from, plainDate("2026-08-10"))).toEqual("tomorrow");
    expect(relativeDays(from, plainDate("2026-08-02"))).toEqual("7 days ago");
  });

  it("returns today in the building's timezone", () => {
    expect(today("America/New_York")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("compliance applicability", () => {
  const brownstone: BuildingAttributes = {
    unitCount: 6,
    stories: 4,
    yearBuilt: 1899,
    grossSquareFeet: 7_800,
    hasElevator: false,
    gasService: "HEATING_AND_COOKING",
    oilTankPresent: false,
    sprinklerStatus: "NONE",
    facadeHeightFt: null,
    isLandmarked: true,
    hasParapet: true,
    ownerOccupied: true,
  };

  it("applies a rule whose threshold is met, and says why", () => {
    const verdict = evaluate({ attr: "unitCount", op: "gte", value: 3 }, brownstone);
    expect(verdict.applies).toBe(true);
    expect(verdict.reason).toContain("6");
    expect(verdict.inputs.unitCount).toEqual(6);
  });

  it("exempts a four-storey brownstone from the facade cycle", () => {
    // FISP is more than six storeys. This is the case a hardcoded conditional
    // would get right once and then drift on.
    const verdict = evaluate({ attr: "stories", op: "gt", value: 6 }, brownstone);
    expect(verdict.applies).toBe(false);
    expect(verdict.reason).toMatch(/does not apply/i);
  });

  it("never concludes exempt from a missing attribute", () => {
    // A building with no recorded floor area is not exempt from benchmarking —
    // it is unknown, and treating null as zero is how a compliance product
    // produces a confident wrong answer.
    const unknown = { ...brownstone, grossSquareFeet: null };
    const verdict = evaluate(
      { attr: "grossSquareFeet", op: "gte", value: 25_000 },
      unknown,
    );
    expect(verdict.applies).toBe(false);
    expect(verdict.reason).toMatch(/not recorded/i);
  });

  it("combines clauses with all, any and not", () => {
    expect(
      evaluate(
        {
          all: [
            { attr: "unitCount", op: "gte", value: 3 },
            { attr: "gasService", op: "ne", value: "NONE" },
          ],
        },
        brownstone,
      ).applies,
    ).toBe(true);

    expect(
      evaluate(
        {
          any: [
            { attr: "hasElevator", op: "eq", value: true },
            { attr: "oilTankPresent", op: "eq", value: true },
          ],
        },
        brownstone,
      ).applies,
    ).toBe(false);

    expect(
      evaluate({ not: { attr: "hasElevator", op: "eq", value: true } }, brownstone).applies,
    ).toBe(true);
  });

  it("explains a failure by the clause that failed, not every clause", () => {
    const verdict = evaluate(
      {
        all: [
          { attr: "unitCount", op: "gte", value: 3 },
          { attr: "hasElevator", op: "eq", value: true },
        ],
      },
      brownstone,
    );
    expect(verdict.applies).toBe(false);
    expect(verdict.reason).toContain("elevator");
    expect(verdict.reason).not.toContain("unit count");
  });

  it("applies an always rule to every building", () => {
    expect(evaluate({ always: true }, brownstone).applies).toBe(true);
  });
});

describe("capabilities", () => {
  it("gives a plain shareholder their own unit and nothing wider", () => {
    const caps = capabilitiesFor(["SHAREHOLDER"]);
    expect(caps.has("arrears.viewOwnUnit")).toBe(true);
    expect(caps.has("arrears.viewAll")).toBe(false);
    expect(caps.has("alteration.decide")).toBe(false);
    expect(caps.has("alteration.commentInternal")).toBe(false);
  });

  it("gives building-wide arrears to the treasurer and president only", () => {
    for (const role of ["TREASURER", "PRESIDENT"] as const) {
      expect(capabilitiesFor([role]).has("arrears.viewAll"), role).toBe(true);
    }
    for (const role of ["SECRETARY", "BOARD_MEMBER", "SUPER", "OBSERVER"] as const) {
      expect(capabilitiesFor([role]).has("arrears.viewAll"), role).toBe(false);
    }
  });

  it("unions the capabilities of a combined role set", () => {
    const caps = capabilitiesFor(["SHAREHOLDER", "TREASURER"]);
    expect(caps.has("arrears.viewOwnUnit")).toBe(true);
    expect(caps.has("arrears.recordPayment")).toBe(true);
  });

  it("keeps the super away from money and governance", () => {
    const caps = capabilitiesFor(["SUPER"]);
    expect(caps.has("ticket.triage")).toBe(true);
    expect(caps.has("arrears.viewAll")).toBe(false);
    expect(caps.has("arrears.viewOwnUnit")).toBe(false);
    expect(caps.has("meeting.view")).toBe(false);
  });

  it("lets an observer read and change nothing", () => {
    const caps = capabilitiesFor(["OBSERVER"]);
    expect(caps.has("compliance.view")).toBe(true);
    for (const capability of [
      "compliance.markComplete",
      "alteration.decide",
      "arrears.viewAll",
      "member.invite",
    ] as const) {
      expect(caps.has(capability), capability).toBe(false);
    }
  });
});

describe("unit visibility", () => {
  const ctx = (roles: Parameters<typeof capabilitiesFor>[0], unitIds: string[]) => ({
    capabilities: capabilitiesFor(roles),
    unitIds,
  });

  it("does not filter for someone with the building-wide capability", () => {
    expect(unitFilter(ctx(["TREASURER"], ["2f"]), "arrears")).toEqual({});
  });

  it("restricts a shareholder to their own units", () => {
    expect(unitFilter(ctx(["SHAREHOLDER"], ["3r"]), "arrears")).toEqual({
      unitId: { in: ["3r"] },
    });
  });

  it("matches nothing — not everything — when someone has neither capability", () => {
    // Returning {} here would show the whole building's ledger to an observer.
    // The easy mistake is the catastrophic one.
    const observer = ctx(["OBSERVER"], []);
    expect(visibility(observer, "arrears").scope).toEqual("none");
    expect(unitFilter(observer, "arrears")).toEqual({ unitId: { in: [] } });
  });

  it("matches nothing for a shareholder who holds no unit", () => {
    expect(unitFilter(ctx(["SHAREHOLDER"], []), "arrears")).toEqual({ unitId: { in: [] } });
  });
});

describe("floors", () => {
  it("uses the building's own vocabulary", () => {
    expect(floorTag(0, "BROWNSTONE")).toEqual("GDN");
    expect(floorTag(1, "BROWNSTONE")).toEqual("PARL");
    expect(floorTag(2, "BROWNSTONE")).toEqual("2ND");
    expect(floorTag(3, "BROWNSTONE")).toEqual("3RD");
    expect(floorTag(4, "BROWNSTONE")).toEqual("4TH");
  });

  it("numbers a walk-up plainly", () => {
    expect(floorTag(0, "NUMERIC")).toEqual("G");
    expect(floorTag(5, "NUMERIC")).toEqual("5");
  });

  it("stacks floors highest first, the way a building stands", () => {
    const stack = stackByFloor([
      { floorIndex: 0, label: "GARDEN" },
      { floorIndex: 2, label: "2R" },
      { floorIndex: 2, label: "2F" },
    ]);

    expect(stack.map((f) => f.floorIndex)).toEqual([2, 0]);
    expect(stack[0]?.units.map((u) => u.label)).toEqual(["2F", "2R"]);
  });
});

describe("storage keys", () => {
  it("namespaces every key by building", () => {
    const key = storageKey({
      buildingId: "b-1",
      entity: "CERTIFICATE_OF_INSURANCE",
      entityId: "c-1",
      filename: "coi.pdf",
    });
    expect(key).toEqual("buildings/b-1/certificate_of_insurance/c-1/coi.pdf");
    expect(keyBelongsTo(key, "b-1")).toBe(true);
    expect(keyBelongsTo(key, "b-2")).toBe(false);
  });

  it("strips path traversal out of filenames", () => {
    expect(safeFilename("../../etc/passwd")).toEqual("passwd");
    expect(safeFilename("a/b/c.pdf")).toEqual("c.pdf");
    expect(safeFilename(".hidden")).toEqual("hidden");
    expect(safeFilename("..")).toBeNull();
  });

  it("cannot be made to escape its building's prefix", () => {
    const key = storageKey({
      buildingId: "b-1",
      entity: "document",
      entityId: "d-1",
      filename: "../../../b-2/steal.pdf",
    });
    expect(keyBelongsTo(key, "b-1")).toBe(true);
    expect(key).not.toContain("..");
  });
});

describe("upload validation", () => {
  const valid = { filename: "coi.pdf", contentType: "application/pdf", sizeBytes: 1024 };

  it("accepts a PDF and a photo", () => {
    expect(validateUpload(valid).ok).toBe(true);
    expect(validateUpload({ ...valid, contentType: "image/jpeg" }).ok).toBe(true);
  });

  it("refuses types a co-op does not upload", () => {
    for (const contentType of [
      "application/x-msdownload",
      "text/html",
      "image/svg+xml",
      "application/zip",
    ]) {
      expect(validateUpload({ ...valid, contentType }).ok, contentType).toBe(false);
    }
  });

  it("refuses an empty or oversized file", () => {
    expect(validateUpload({ ...valid, sizeBytes: 0 }).ok).toBe(false);
    expect(validateUpload({ ...valid, sizeBytes: 40 * 1024 * 1024 }).ok).toBe(false);
  });

  it("tells someone what to do about a file that is too big", () => {
    const result = validateUpload({ ...valid, sizeBytes: 40 * 1024 * 1024 });
    if (result.ok) throw new Error("expected a refusal");
    expect(result.message).toMatch(/photograph|split/i);
  });
});

describe("reminder dedupe key", () => {
  const base = {
    obligationId: "o-1",
    offsetDays: 30,
    scheduledFor: "2026-08-02",
    recipientEmail: "Nora@Example.com",
  };

  it("is stable for the same reminder", () => {
    expect(reminderDedupeKey(base)).toEqual(reminderDedupeKey({ ...base }));
  });

  it("ignores address casing, so a retry cannot slip past", () => {
    expect(reminderDedupeKey(base)).toEqual(
      reminderDedupeKey({ ...base, recipientEmail: "nora@example.com" }),
    );
  });

  it("differs across offsets, dates, obligations and recipients", () => {
    const keys = new Set([
      reminderDedupeKey(base),
      reminderDedupeKey({ ...base, offsetDays: 7 }),
      reminderDedupeKey({ ...base, scheduledFor: "2026-08-25" }),
      reminderDedupeKey({ ...base, obligationId: "o-2" }),
      reminderDedupeKey({ ...base, recipientEmail: "hal@example.com" }),
    ]);
    expect(keys.size).toEqual(5);
  });
});
