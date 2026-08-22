import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import {
  buildingShares,
  getMeeting,
  listMeetings,
  liveProxies,
  outcomeOf,
  quorumFor,
} from "~/lib/db/scoped/meetings";
import {
  adoptMinutes,
  clearAttendance,
  grantProxy,
  recordAttendance,
  recordResolution,
  revokeProxy,
  saveMinutes,
  scheduleMeeting,
  updateMeeting,
} from "~/lib/db/scoped/meeting-writes";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { expect as unwrap } from "~/lib/result";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * Meetings, quorum, proxies and resolutions.
 *
 * The Adelaide's share register is what makes these tests worth writing: six
 * apartments holding 1200 shares between them, unevenly — 260, 240, 210, 180,
 * 160, 150. Four of the six can turn up and still not carry two-thirds of the
 * stock, and two-thirds of 1200 is exactly 800, which is the number a floating
 * point implementation gets wrong.
 *
 * So the claims under test are the ones a shareholder would contest at the
 * meeting: that quorum is measured in shares and not in heads, that a vote
 * landing exactly on the line falls the way the bylaws say, and that a
 * resolution nobody was present to vote on cannot be recorded as carried.
 */

const TOTAL = 1200;

interface Register {
  readonly byLabel: ReadonlyMap<string, string>;
  readonly holdings: ReadonlyArray<{ unitId: string; shares: number }>;
}

/** Apartment labels to ids, so the tests can read like the share register. */
async function registerFor(ctx: BuildingContext): Promise<Register> {
  const units = await listUnitsWithShares(ctx);
  return {
    byLabel: new Map(units.map((unit) => [unit.label, unit.id])),
    holdings: units.map((unit) => ({ unitId: unit.id, shares: unit.shares })),
  };
}

let meetingCount = 0;

/** A fresh meeting per test, so nothing depends on what ran before it. */
async function freshMeeting(
  ctx: BuildingContext,
  options: {
    quorumNumerator?: number;
    quorumDenominator?: number;
    quorumStrict?: boolean;
  } = {},
): Promise<string> {
  meetingCount += 1;
  const result = await scheduleMeeting(ctx, {
    title: `Special meeting ${meetingCount} of ${Date.now().toString(36)}`,
    type: "SPECIAL",
    scheduledFor: new Date(Date.UTC(2027, 4, 12, 23, 30)),
    location: "Parlor floor",
    quorumNumerator: options.quorumNumerator ?? 2,
    quorumDenominator: options.quorumDenominator ?? 3,
    quorumStrict: options.quorumStrict ?? false,
  });
  return unwrap(result).meetingId;
}

async function markPresent(
  ctx: BuildingContext,
  meetingId: string,
  register: Register,
  labels: readonly string[],
): Promise<void> {
  for (const label of labels) {
    const unitId = register.byLabel.get(label);
    if (!unitId) throw new Error(`No apartment ${label} in the register`);
    unwrap(await recordAttendance(ctx, meetingId, { unitId, mode: "IN_PERSON" }));
  }
}

/** Quorum as the page computes it, read back through the real read path. */
async function quorumOf(
  ctx: BuildingContext,
  meetingId: string,
  register: Register,
): Promise<ReturnType<typeof quorumFor>> {
  const meeting = await getMeeting(ctx, meetingId);
  if (!meeting) throw new Error("meeting vanished");
  return quorumFor({
    meeting,
    attendance: meeting.attendance,
    proxies: meeting.proxies,
    holdings: register.holdings,
  });
}

describe("meetings", () => {
  let secretary: BuildingContext;
  let president: BuildingContext;
  let hal: BuildingContext;
  let marta: BuildingContext;
  let otherBuilding: BuildingContext;
  let register: Register;

  beforeAll(async () => {
    secretary = await contextFor(PEOPLE.priyaSecretary, ADELAIDE);
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    marta = await contextFor(PEOPLE.martaBoth, ADELAIDE);
    otherBuilding = await contextFor(PEOPLE.ivanPresident, LISPENARD);
    register = await registerFor(secretary);
  });

  it("has the share register the rest of these tests assume", () => {
    // Every number below is read off this. If the seed changes, these tests
    // should fail here rather than somewhere subtler.
    expect(
      buildingShares(
        register.holdings.map((h) => ({ id: h.unitId, shares: h.shares })),
      ),
    ).toEqual(TOTAL);
    expect([...register.byLabel.keys()].sort()).toEqual([
      "1F",
      "2F",
      "2R",
      "3R",
      "4F",
      "GARDEN",
    ]);
  });

  describe("calling one", () => {
    it("stores the bylaw fraction exactly, not as a percentage", async () => {
      const meetingId = await freshMeeting(secretary, {
        quorumNumerator: 2,
        quorumDenominator: 3,
        quorumStrict: false,
      });

      const meeting = await getMeeting(secretary, meetingId);
      // 0.667 would be a different rule. 2/3 of 1200 is exactly 800; 6667
      // basis points demands 801, and the meeting with precisely two-thirds
      // present would be recorded as inquorate.
      expect(meeting?.quorumNumerator).toEqual(2);
      expect(meeting?.quorumDenominator).toEqual(3);
      expect(meeting?.quorumStrict).toBe(false);
    });

    it("refuses a plain shareholder", async () => {
      await expect(
        scheduleMeeting(hal, {
          title: "Meeting to remove the board",
          type: "SPECIAL",
          scheduledFor: new Date(Date.UTC(2027, 1, 1)),
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("refuses a threshold nobody could ever meet", async () => {
      const result = await scheduleMeeting(secretary, {
        title: "Impossible meeting",
        type: "SPECIAL",
        scheduledFor: new Date(Date.UTC(2027, 1, 1)),
        quorumNumerator: 4,
        quorumDenominator: 3,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("shows up in the building's list", async () => {
      const meetingId = await freshMeeting(secretary);
      const meetings = await listMeetings(secretary);
      expect(meetings.map((m) => m.id)).toContain(meetingId);
    });
  });

  describe("quorum", () => {
    it("counts shares, not apartments", async () => {
      const meetingId = await freshMeeting(secretary);

      // Four of six apartments — a clear majority of the room — but they are
      // the four smallest holders. 150 + 160 + 180 + 210 = 700 of 1200.
      await markPresent(secretary, meetingId, register, ["2R", "4F", "GARDEN", "3R"]);

      const quorum = await quorumOf(secretary, meetingId, register);
      expect(quorum.presentShares).toEqual(700);
      expect(quorum.requiredShares).toEqual(800);
      expect(quorum.met).toBe(false);
      expect(quorum.shortBy).toEqual(100);
    });

    it("carries on exactly two-thirds when the bylaw is not strict", async () => {
      const meetingId = await freshMeeting(secretary, { quorumStrict: false });

      // 260 + 210 + 180 + 150 = 800, which is two-thirds of 1200 to the share.
      await markPresent(secretary, meetingId, register, ["1F", "3R", "GARDEN", "2R"]);

      const quorum = await quorumOf(secretary, meetingId, register);
      expect(quorum.presentShares).toEqual(800);
      expect(quorum.met).toBe(true);
    });

    it("fails on exactly two-thirds when the bylaw says more than", async () => {
      const meetingId = await freshMeeting(secretary, { quorumStrict: true });
      await markPresent(secretary, meetingId, register, ["1F", "3R", "GARDEN", "2R"]);

      const quorum = await quorumOf(secretary, meetingId, register);
      expect(quorum.presentShares).toEqual(800);
      // Same shares, same fraction, opposite outcome. This is the difference
      // that decides contested votes.
      expect(quorum.met).toBe(false);
      expect(quorum.shortBy).toEqual(1);
    });

    it("counts an apartment once when it is both present and represented", async () => {
      const meetingId = await freshMeeting(secretary);
      const garden = register.byLabel.get("GARDEN")!;

      unwrap(
        await grantProxy(hal, meetingId, {
          unitId: garden,
          holderName: "Nora Whitfield",
        }),
      );
      // Hal sends a proxy, then turns up anyway.
      unwrap(
        await recordAttendance(secretary, meetingId, {
          unitId: garden,
          mode: "IN_PERSON",
        }),
      );

      const quorum = await quorumOf(secretary, meetingId, register);
      expect(quorum.presentShares).toEqual(180);
      expect(quorum.inPersonShares).toEqual(180);
      expect(quorum.proxyShares).toEqual(0);
    });
  });

  describe("proxies", () => {
    it("lets a shareholder give away their own apartment's vote", async () => {
      const meetingId = await freshMeeting(secretary);
      const garden = register.byLabel.get("GARDEN")!;

      const result = await grantProxy(hal, meetingId, {
        unitId: garden,
        holderName: "Nora Whitfield",
        evidence: "Signed proxy form, handed to the secretary",
      });

      expect(result.ok).toBe(true);
      const meeting = await getMeeting(hal, meetingId);
      expect(liveProxies(meeting!.proxies)).toHaveLength(1);
      expect(liveProxies(meeting!.proxies)[0]?.holderName).toEqual("Nora Whitfield");
    });

    it("counts a proxied apartment toward quorum", async () => {
      const meetingId = await freshMeeting(secretary);
      unwrap(
        await grantProxy(hal, meetingId, {
          unitId: register.byLabel.get("GARDEN")!,
          holderName: "Nora Whitfield",
        }),
      );

      const quorum = await quorumOf(secretary, meetingId, register);
      expect(quorum.proxyShares).toEqual(180);
      expect(quorum.presentShares).toEqual(180);
    });

    it("refuses a shareholder giving away a neighbour's vote", async () => {
      const meetingId = await freshMeeting(secretary);

      // Hal holds the garden apartment, not 2R.
      await expect(
        grantProxy(hal, meetingId, {
          unitId: register.byLabel.get("2R")!,
          holderName: "Hal Brenner",
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("supersedes an earlier grant without erasing it", async () => {
      const meetingId = await freshMeeting(secretary);
      const garden = register.byLabel.get("GARDEN")!;

      unwrap(
        await grantProxy(hal, meetingId, {
          unitId: garden,
          holderName: "Nora Whitfield",
        }),
      );
      unwrap(
        await grantProxy(hal, meetingId, { unitId: garden, holderName: "Priya Raman" }),
      );

      const meeting = await getMeeting(hal, meetingId);
      // Both grants survive: "who held my proxy that night" has to be
      // answerable, and only one of them can be live. Asserted against the
      // stored rows rather than the derived view, because the derived view
      // would look right even if the database held two live grants.
      expect(meeting!.proxies).toHaveLength(2);
      const stored = meeting!.proxies.filter((p) => p.revokedAt === null);
      expect(stored).toHaveLength(1);
      expect(stored[0]?.holderName).toEqual("Priya Raman");

      const earlier = meeting!.proxies.find((p) => p.holderName === "Nora Whitfield");
      expect(earlier?.revokedAt).not.toBeNull();

      const live = liveProxies(meeting!.proxies);
      expect(live).toHaveLength(1);
      expect(live[0]?.holderName).toEqual("Priya Raman");
    });

    it("lets the granting apartment revoke, and stops counting it", async () => {
      const meetingId = await freshMeeting(secretary);
      const garden = register.byLabel.get("GARDEN")!;

      const granted = unwrap(
        await grantProxy(hal, meetingId, {
          unitId: garden,
          holderName: "Nora Whitfield",
        }),
      );
      expect((await quorumOf(secretary, meetingId, register)).presentShares).toEqual(
        180,
      );

      unwrap(await revokeProxy(hal, granted.proxyId));

      expect((await quorumOf(secretary, meetingId, register)).presentShares).toEqual(0);
    });

    it("refuses a shareholder revoking a neighbour's proxy", async () => {
      const meetingId = await freshMeeting(secretary);
      const granted = unwrap(
        await grantProxy(marta, meetingId, {
          unitId: register.byLabel.get("2R")!,
          holderName: "Priya Raman",
        }),
      );

      const result = await revokeProxy(hal, granted.proxyId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("forbidden");
    });
  });

  describe("resolutions", () => {
    /** Present: GARDEN, 1F, 2F, 2R, 3R — 1040 shares, comfortably quorate. */
    async function quorateMeeting(
      options: {
        quorumStrict?: boolean;
      } = {},
    ): Promise<string> {
      const meetingId = await freshMeeting(secretary, options);
      await markPresent(secretary, meetingId, register, [
        "GARDEN",
        "1F",
        "2F",
        "2R",
        "3R",
      ]);
      return meetingId;
    }

    it("refuses to record one at an inquorate meeting", async () => {
      const meetingId = await freshMeeting(secretary);
      // 700 of the 800 shares needed.
      await markPresent(secretary, meetingId, register, ["2R", "4F", "GARDEN", "3R"]);

      const result = await recordResolution(secretary, meetingId, {
        title: "Repoint the rear facade",
        text: "Resolved, that the corporation engage a mason to repoint the rear facade.",
        votes: [
          { unitId: register.byLabel.get("2R")!, choice: "FOR" },
          { unitId: register.byLabel.get("3R")!, choice: "FOR" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
      expect(result.message).toMatch(/100 shares short of quorum/);
    });

    it("refuses a vote from an apartment nobody recorded as present", async () => {
      const meetingId = await quorateMeeting();

      const result = await recordResolution(secretary, meetingId, {
        title: "Repoint the rear facade",
        text: "Resolved, that the corporation engage a mason to repoint the rear facade.",
        votes: [
          { unitId: register.byLabel.get("1F")!, choice: "FOR" },
          // 4F was never marked present.
          { unitId: register.byLabel.get("4F")!, choice: "FOR" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/4F is not recorded as present/);
    });

    it("refuses a vote claimed as cast by a proxy that does not exist", async () => {
      const meetingId = await quorateMeeting();

      const result = await recordResolution(secretary, meetingId, {
        title: "Repoint the rear facade",
        text: "Resolved, that the corporation engage a mason to repoint the rear facade.",
        votes: [{ unitId: register.byLabel.get("1F")!, choice: "FOR", byProxy: true }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/no live proxy/);
    });

    it("tallies by shares, and freezes them onto each vote", async () => {
      const meetingId = await quorateMeeting();

      const recorded = unwrap(
        await recordResolution(secretary, meetingId, {
          title: "Repoint the rear facade",
          text: "Resolved, that the corporation engage a mason to repoint the rear facade, at a cost not to exceed $48,000.",
          votes: [
            { unitId: register.byLabel.get("3R")!, choice: "FOR" }, // 210
            { unitId: register.byLabel.get("2R")!, choice: "FOR" }, // 150
            { unitId: register.byLabel.get("GARDEN")!, choice: "AGAINST" }, // 180
            { unitId: register.byLabel.get("1F")!, choice: "ABSTAIN" }, // 260
            { unitId: register.byLabel.get("2F")!, choice: "ABSTAIN" }, // 240
          ],
        }),
      );

      // Two apartments for and one against — but 360 shares for and 180
      // against. Counting hands and counting shares disagree here by design.
      expect(recorded.sharesFor).toEqual(360);
      expect(recorded.sharesAgainst).toEqual(180);
      expect(recorded.sharesAbstain).toEqual(500);

      const meeting = await getMeeting(secretary, meetingId);
      const resolution = meeting!.resolutions.find(
        (r) => r.id === recorded.resolutionId,
      );
      expect(resolution?.votes).toHaveLength(5);
      // The share count is copied onto the row, not joined at read time.
      const garden = resolution?.votes.find(
        (v) => v.unitId === register.byLabel.get("GARDEN"),
      );
      expect(garden?.shares).toEqual(180);
      expect(garden?.choice).toEqual("AGAINST");
    });

    it("carries on exactly two-thirds of the shares voted", async () => {
      const meetingId = await quorateMeeting();

      // 360 for, 180 against: 540 voted, and 360 is two-thirds of 540 exactly.
      const recorded = unwrap(
        await recordResolution(secretary, meetingId, {
          title: "Amend the house rules",
          text: "Resolved, that the house rules be amended to require a certificate of insurance for all alterations.",
          votes: [
            { unitId: register.byLabel.get("3R")!, choice: "FOR" },
            { unitId: register.byLabel.get("2R")!, choice: "FOR" },
            { unitId: register.byLabel.get("GARDEN")!, choice: "AGAINST" },
            { unitId: register.byLabel.get("1F")!, choice: "ABSTAIN" },
            { unitId: register.byLabel.get("2F")!, choice: "ABSTAIN" },
          ],
          thresholdNumerator: 2,
          thresholdDenominator: 3,
          thresholdStrict: false,
        }),
      );

      expect(recorded.passed).toBe(true);
    });

    it("fails on exactly two-thirds when the bylaw says more than two-thirds", async () => {
      const meetingId = await quorateMeeting();

      const recorded = unwrap(
        await recordResolution(secretary, meetingId, {
          title: "Amend the bylaws",
          text: "Resolved, that Article VI of the bylaws be amended as circulated with the notice of this meeting.",
          votes: [
            { unitId: register.byLabel.get("3R")!, choice: "FOR" },
            { unitId: register.byLabel.get("2R")!, choice: "FOR" },
            { unitId: register.byLabel.get("GARDEN")!, choice: "AGAINST" },
            { unitId: register.byLabel.get("1F")!, choice: "ABSTAIN" },
            { unitId: register.byLabel.get("2F")!, choice: "ABSTAIN" },
          ],
          thresholdNumerator: 2,
          thresholdDenominator: 3,
          thresholdStrict: true,
        }),
      );

      // Identical votes to the test above. The word "more" in the bylaws is
      // the whole difference.
      expect(recorded.passed).toBe(false);
    });

    it("counts abstentions against when the bylaw measures shares present", async () => {
      const meetingId = await quorateMeeting();

      const recorded = unwrap(
        await recordResolution(secretary, meetingId, {
          title: "Assess for the roof",
          text: "Resolved, that the corporation levy a special assessment of $60,000 for the roof.",
          votes: [
            { unitId: register.byLabel.get("3R")!, choice: "FOR" },
            { unitId: register.byLabel.get("2R")!, choice: "FOR" },
            { unitId: register.byLabel.get("GARDEN")!, choice: "AGAINST" },
            { unitId: register.byLabel.get("1F")!, choice: "ABSTAIN" },
            { unitId: register.byLabel.get("2F")!, choice: "ABSTAIN" },
          ],
          thresholdNumerator: 2,
          thresholdDenominator: 3,
          thresholdStrict: false,
          basis: "PRESENT",
        }),
      );

      // Same 360 for, but measured against all 1040 shares in the room.
      expect(recorded.passed).toBe(false);
    });

    it("shows the same outcome when the page recomputes it", async () => {
      const meetingId = await quorateMeeting();
      const recorded = unwrap(
        await recordResolution(secretary, meetingId, {
          title: "Repoint the rear facade",
          text: "Resolved, that the corporation engage a mason to repoint the rear facade.",
          votes: [
            { unitId: register.byLabel.get("3R")!, choice: "FOR" },
            { unitId: register.byLabel.get("2R")!, choice: "FOR" },
            { unitId: register.byLabel.get("GARDEN")!, choice: "AGAINST" },
          ],
          thresholdNumerator: 2,
          thresholdDenominator: 3,
          thresholdStrict: false,
        }),
      );

      const meeting = await getMeeting(secretary, meetingId);
      const resolution = meeting!.resolutions.find(
        (r) => r.id === recorded.resolutionId,
      )!;

      // The stored boolean and the arithmetic the page runs have to agree, or
      // the page is showing a number that contradicts its own verdict.
      expect(outcomeOf(resolution, TOTAL).passed).toEqual(resolution.passed);
      expect(outcomeOf(resolution, TOTAL).denominator).toEqual(540);
      expect(outcomeOf(resolution, TOTAL).needed).toEqual(360);
    });

    it("refuses an apartment voting twice", async () => {
      const meetingId = await quorateMeeting();

      const result = await recordResolution(secretary, meetingId, {
        title: "Repoint the rear facade",
        text: "Resolved, that the corporation engage a mason to repoint the rear facade.",
        votes: [
          { unitId: register.byLabel.get("3R")!, choice: "FOR" },
          { unitId: register.byLabel.get("3R")!, choice: "AGAINST" },
        ],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/cannot vote twice/);
    });

    it("refuses a plain shareholder recording one", async () => {
      const meetingId = await quorateMeeting();

      await expect(
        recordResolution(hal, meetingId, {
          title: "Give Hal the roof deck",
          text: "Resolved, that the roof be given over to the garden apartment in perpetuity.",
          votes: [{ unitId: register.byLabel.get("GARDEN")!, choice: "FOR" }],
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("will not let an apartment that voted be marked absent afterwards", async () => {
      const meetingId = await quorateMeeting();
      unwrap(
        await recordResolution(secretary, meetingId, {
          title: "Repoint the rear facade",
          text: "Resolved, that the corporation engage a mason to repoint the rear facade.",
          votes: [{ unitId: register.byLabel.get("3R")!, choice: "FOR" }],
        }),
      );

      const result = await clearAttendance(
        secretary,
        meetingId,
        register.byLabel.get("3R")!,
      );

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/already voted/);
    });
  });

  describe("minutes", () => {
    const TEXT =
      "The president called the meeting to order at 7.05pm. Quorum was confirmed at 1,040 shares.";

    it("drafts, then adopts", async () => {
      const meetingId = await freshMeeting(secretary);

      unwrap(await saveMinutes(secretary, meetingId, TEXT));
      expect((await getMeeting(secretary, meetingId))?.minutes).toEqual(TEXT);

      unwrap(await adoptMinutes(secretary, meetingId));
      const adopted = await getMeeting(secretary, meetingId);
      expect(adopted?.minutesAdoptedAt).not.toBeNull();
      // Adoption implies the meeting happened, even if nobody ticked the box.
      expect(adopted?.heldAt).not.toBeNull();
    });

    it("refuses to adopt minutes nobody has written", async () => {
      const meetingId = await freshMeeting(secretary);

      const result = await adoptMinutes(secretary, meetingId);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("closes the record once adopted", async () => {
      const meetingId = await freshMeeting(secretary);
      await markPresent(secretary, meetingId, register, ["1F", "2F", "3R", "GARDEN"]);
      unwrap(await saveMinutes(secretary, meetingId, TEXT));
      unwrap(await adoptMinutes(secretary, meetingId));

      // Everything that would change what the meeting says it did.
      const attempts = await Promise.all([
        saveMinutes(secretary, meetingId, `${TEXT} And then everyone agreed.`),
        adoptMinutes(secretary, meetingId),
        recordAttendance(secretary, meetingId, {
          unitId: register.byLabel.get("4F")!,
          mode: "IN_PERSON",
        }),
        grantProxy(hal, meetingId, {
          unitId: register.byLabel.get("GARDEN")!,
          holderName: "Nora Whitfield",
        }),
        recordResolution(secretary, meetingId, {
          title: "One more thing",
          text: "Resolved, that we also do this other thing nobody voted on.",
          votes: [{ unitId: register.byLabel.get("1F")!, choice: "FOR" }],
        }),
        updateMeeting(secretary, meetingId, { title: "A different meeting" }),
      ]);

      for (const attempt of attempts) {
        expect(attempt.ok).toBe(false);
        if (attempt.ok) continue;
        expect(attempt.code).toEqual("conflict");
      }

      expect((await getMeeting(secretary, meetingId))?.minutes).toEqual(TEXT);
    });
  });

  describe("tenancy", () => {
    it("keeps one building's meetings out of another's", async () => {
      const meetingId = await freshMeeting(president);

      expect(await getMeeting(otherBuilding, meetingId)).toBeNull();
      expect((await listMeetings(otherBuilding)).map((m) => m.id)).not.toContain(
        meetingId,
      );
    });

    it("refuses a resolution vote from an apartment in another building", async () => {
      const meetingId = await freshMeeting(secretary);
      await markPresent(secretary, meetingId, register, ["1F", "2F", "3R", "GARDEN"]);

      const theirs = await registerFor(otherBuilding);
      const result = await recordResolution(secretary, meetingId, {
        title: "Vote from next door",
        text: "Resolved, that an apartment in another corporation may vote here.",
        votes: [{ unitId: theirs.byLabel.get("5F")!, choice: "FOR" }],
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("not_found");
    });
  });
});
