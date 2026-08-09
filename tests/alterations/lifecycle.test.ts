import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import {
  actOnAlteration,
  commentOnAlteration,
  recordCertificate,
  submitAlteration,
  verifyCertificate,
} from "~/lib/db/scoped/alteration-writes";
import { getAlteration, listAlterations } from "~/lib/db/scoped/alterations";
import { listCertificates } from "~/lib/db/scoped/documents";
import { listObligations } from "~/lib/db/scoped/compliance";
import { requestDownload, requestUpload } from "~/lib/db/scoped/document-writes";
import { addDays, today, toPlainDate } from "~/lib/time";
import { ADELAIDE, PEOPLE, contextFor } from "../helpers/context";

/**
 * Alterations and certificates, against the real database.
 *
 * Like the compliance suite, this mutates the seeded building rather than using
 * fixtures, so it exercises the real scoped write path under row-level
 * security. Nothing here may assert on absolute row counts.
 */

describe("alterations", () => {
  let president: BuildingContext;
  let shareholder: BuildingContext;
  let neighbour: BuildingContext;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    // A plain shareholder, deliberately: Priya is the secretary, and an officer
    // can legitimately comment on any request in the building.
    neighbour = await contextFor("owen.castellanos@example.com", ADELAIDE);
  });

  describe("filing a request", () => {
    it("files against the shareholder's own apartment", async () => {
      const unitId = shareholder.unitIds[0];
      expect(unitId).toBeDefined();
      if (!unitId) return;

      const result = await submitAlteration(shareholder, {
        unitId,
        title: "Bathroom refit",
        scope:
          "Replace the tub with a walk-in shower in the same footprint, retile, no change to the stack.",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const alteration = await getAlteration(shareholder, result.data.alterationId);
      expect(alteration?.approval.status).toEqual("SUBMITTED");
      expect(alteration?.unitId).toEqual(unitId);
    });

    it("refuses a shareholder filing against someone else's apartment", async () => {
      const someoneElse = neighbour.unitIds[0];
      expect(someoneElse).toBeDefined();
      if (!someoneElse) return;
      expect(shareholder.unitIds).not.toContain(someoneElse);

      const result = await submitAlteration(shareholder, {
        unitId: someoneElse,
        title: "Kitchen",
        scope: "Something in a neighbour's apartment that is none of my business.",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toEqual("forbidden");
    });

    it("asks for a real description rather than accepting two words", async () => {
      const unitId = shareholder.unitIds[0];
      if (!unitId) return;

      const result = await submitAlteration(shareholder, {
        unitId,
        title: "Kitchen",
        scope: "new sink",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields?.["scope"]).toBeDefined();
    });

    it("refuses an end date before the start date", async () => {
      const unitId = shareholder.unitIds[0];
      if (!unitId) return;

      const result = await submitAlteration(shareholder, {
        unitId,
        title: "Windows",
        scope: "Replace the four front windows with landmark-approved replicas.",
        plannedStart: "2027-05-01",
        plannedEnd: "2027-04-01",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields?.["plannedEnd"]).toBeDefined();
    });
  });

  describe("deciding", () => {
    let alterationId: string;

    beforeAll(async () => {
      const unitId = shareholder.unitIds[0];
      if (!unitId) throw new Error("seed has no unit for the shareholder");

      const result = await submitAlteration(shareholder, {
        unitId,
        title: "Floor refinishing",
        scope: "Sand and refinish the parlour floor boards, no structural work at all.",
      });
      if (!result.ok) throw new Error(result.message);
      alterationId = result.data.alterationId;
    });

    it("does not let the shareholder approve their own request", async () => {
      const result = await actOnAlteration(shareholder, {
        alterationId,
        action: "approve",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/permission/i);
    });

    it("requires conditions when approving with conditions", async () => {
      const result = await actOnAlteration(president, {
        alterationId,
        action: "approveWithConditions",
        conditions: "  ",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields?.["conditions"]).toBeDefined();
    });

    it("records the decision with the officer's name and the conditions", async () => {
      const result = await actOnAlteration(president, {
        alterationId,
        action: "approveWithConditions",
        conditions: "Weekdays 9 to 5. Protect the stair runner.",
        note: "No objection from the board.",
      });

      expect(result.ok).toBe(true);

      const alteration = await getAlteration(president, alterationId);
      expect(alteration?.approval.status).toEqual("APPROVED_WITH_CONDITIONS");
      expect(alteration?.approval.conditions).toContain("Weekdays 9 to 5");
      expect(alteration?.approval.decidedBy?.user.email).toEqual(PEOPLE.noraPresident);
      expect(alteration?.approval.decidedAt).toBeTruthy();
    });

    it("will not re-decide a decided request", async () => {
      // A decision is a record, not a setting. Changing one would put the
      // minutes and the system into disagreement about what was approved.
      const result = await actOnAlteration(president, {
        alterationId,
        action: "deny",
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.message).toMatch(/already been decided/i);
    });

    it("will not let the shareholder withdraw after a decision", async () => {
      const result = await actOnAlteration(shareholder, {
        alterationId,
        action: "withdraw",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("the comment thread", () => {
    let alterationId: string;

    beforeAll(async () => {
      const unitId = shareholder.unitIds[0];
      if (!unitId) throw new Error("seed has no unit for the shareholder");
      const result = await submitAlteration(shareholder, {
        unitId,
        title: "Radiator covers",
        scope: "Fit covers on the four parlour radiators, no plumbing work involved.",
      });
      if (!result.ok) throw new Error(result.message);
      alterationId = result.data.alterationId;
    });

    it("lets the shareholder and the board talk", async () => {
      const posted = await commentOnAlteration(shareholder, {
        alterationId,
        body: "Happy to answer anything at the next meeting.",
      });
      expect(posted.ok).toBe(true);

      const alteration = await getAlteration(shareholder, alterationId);
      expect(alteration?.approval.comments.length).toBeGreaterThan(0);
    });

    it("hides board-only comments from the shareholder who filed it", async () => {
      const posted = await commentOnAlteration(president, {
        alterationId,
        body: "Check whether the covers block the thermostatic valves.",
        boardOnly: true,
      });
      expect(posted.ok).toBe(true);

      const boardView = await getAlteration(president, alterationId);
      const memberView = await getAlteration(shareholder, alterationId);

      expect(
        boardView?.approval.comments.some((c) => c.visibility === "BOARD_ONLY"),
      ).toBe(true);
      // Filtered in the query, not the view. A comment thread that leaks
      // through an API response leaks whether or not a component renders it.
      expect(
        memberView?.approval.comments.every((c) => c.visibility === "SHARED"),
      ).toBe(true);
    });

    it("refuses a board-only comment from a shareholder", async () => {
      await expect(
        commentOnAlteration(shareholder, {
          alterationId,
          body: "Trying to post into the private thread.",
          boardOnly: true,
        }),
      ).rejects.toThrow(CapabilityError);
    });

    it("refuses a comment on a neighbour's request", async () => {
      const result = await commentOnAlteration(neighbour, {
        alterationId,
        body: "Not my request.",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toEqual("forbidden");
    });
  });

  describe("visibility", () => {
    it("shows a shareholder only their own unit's requests", async () => {
      const theirs = await listAlterations(shareholder);
      for (const alteration of theirs) {
        expect(shareholder.unitIds).toContain(alteration.unitId);
      }
    });

    it("shows an officer every request", async () => {
      const all = await listAlterations(president);
      const theirs = await listAlterations(shareholder);
      expect(all.length).toBeGreaterThan(theirs.length);
    });

    it("returns null rather than another unit's request", async () => {
      const all = await listAlterations(president);
      const foreign = all.find((a) => !shareholder.unitIds.includes(a.unitId));
      expect(foreign).toBeDefined();
      if (!foreign) return;

      expect(await getAlteration(shareholder, foreign.id)).toBeNull();
    });
  });
});

describe("certificates of insurance", () => {
  let president: BuildingContext;
  let shareholder: BuildingContext;
  let now: string;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    now = today(president.building.timezone);
  });

  it("puts the expiry on the compliance calendar", async () => {
    const expiresOn = addDays(now as never, 200);

    const result = await recordCertificate(president, {
      holderKind: "MOVER",
      holderName: "Atlantic Avenue Movers",
      carrier: "Travelers",
      policyNumber: "CMP-9910233",
      coverageCents: 100_000_000,
      effectiveOn: now,
      expiresOn,
      additionalInsuredVerified: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The whole value of tracking a certificate is being told before it lapses,
    // so the expiry lives on the same calendar as everything else rather than
    // in a separate notion of alerts nobody checks.
    const obligations = await listObligations(president);
    const generated = obligations.find((o) => o.id === result.data.obligationId);

    expect(generated?.kind).toEqual("COI_EXPIRY");
    expect(generated && toPlainDate(generated.dueOn)).toEqual(expiresOn);
    expect(generated?.subjectId).toEqual(result.data.certificateId);
  });

  it("schedules reminders before it lapses", async () => {
    const { listReminders } = await import("~/lib/db/scoped/compliance");
    const obligations = await listObligations(president);
    const coi = obligations.find((o) => o.kind === "COI_EXPIRY");
    expect(coi).toBeDefined();
    if (!coi) return;

    const reminders = (await listReminders(president)).filter(
      (r) => r.obligationId === coi.id,
    );
    expect(reminders.map((r) => r.offsetDays).sort((a, b) => b - a)).toEqual([45, 14, 3]);
  });

  it("refuses a certificate that expires before it takes effect", async () => {
    const result = await recordCertificate(president, {
      holderKind: "CONTRACTOR",
      holderName: "Backwards Builders",
      carrier: "Chubb",
      policyNumber: "GL-1",
      effectiveOn: "2027-06-01",
      expiresOn: "2027-01-01",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fields?.["expiresOn"]).toBeDefined();
  });

  it("tracks the additional insured endorsement as its own fact", async () => {
    const result = await recordCertificate(president, {
      holderKind: "CONTRACTOR",
      holderName: "Unverified Contracting",
      carrier: "Chubb",
      policyNumber: "GL-7781",
      effectiveOn: now,
      expiresOn: addDays(now as never, 300),
      additionalInsuredVerified: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const before = (await listCertificates(president)).find(
      (c) => c.id === result.data.certificateId,
    );
    expect(before?.additionalInsuredVerified).toBe(false);
    expect(before?.verifiedAt).toBeNull();

    const verified = await verifyCertificate(president, {
      certificateId: result.data.certificateId,
      verified: true,
    });
    expect(verified.ok).toBe(true);

    const after = (await listCertificates(president)).find(
      (c) => c.id === result.data.certificateId,
    );
    // "We looked at it" and "we checked the endorsement" are different claims,
    // so the second one carries a name and a timestamp.
    expect(after?.additionalInsuredVerified).toBe(true);
    expect(after?.verifiedBy?.user.email).toEqual(PEOPLE.noraPresident);
    expect(after?.verifiedAt).toBeTruthy();
  });

  it("keeps recording certificates away from a plain shareholder", async () => {
    await expect(
      recordCertificate(shareholder, {
        holderKind: "CONTRACTOR",
        holderName: "Anyone",
        carrier: "Anywhere",
        policyNumber: "X",
        effectiveOn: now,
        expiresOn: addDays(now as never, 100),
      }),
    ).rejects.toThrow(CapabilityError);
  });

  it("still lets a shareholder see what's insured in the building", async () => {
    // A lapsed mover's certificate on the freight elevator is everyone's
    // exposure. The record carries a name and a policy number, not anyone's
    // finances.
    const certificates = await listCertificates(shareholder);
    expect(certificates.length).toBeGreaterThan(0);
  });
});

describe("document access", () => {
  let president: BuildingContext;
  let shareholder: BuildingContext;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
  });

  it("refuses to sign an upload for a record you can't see", async () => {
    const all = await listAlterations(president);
    const foreign = all.find((a) => !shareholder.unitIds.includes(a.unitId));
    expect(foreign).toBeDefined();
    if (!foreign) return;

    const result = await requestUpload(shareholder, {
      entityType: "ALTERATION_REQUEST",
      entityId: foreign.id,
      filename: "plans.pdf",
      contentType: "application/pdf",
      sizeBytes: 1024,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toEqual("forbidden");
  });

  it("refuses a file type a co-op does not upload", async () => {
    const mine = (await listAlterations(shareholder))[0];
    expect(mine).toBeDefined();
    if (!mine) return;

    const result = await requestUpload(shareholder, {
      entityType: "ALTERATION_REQUEST",
      entityId: mine.id,
      filename: "payload.html",
      contentType: "text/html",
      sizeBytes: 1024,
    });

    expect(result.ok).toBe(false);
  });

  it("namespaces the upload key by building", async () => {
    const mine = (await listAlterations(shareholder))[0];
    if (!mine) return;

    const result = await requestUpload(shareholder, {
      entityType: "ALTERATION_REQUEST",
      entityId: mine.id,
      filename: "plans.pdf",
      contentType: "application/pdf",
      sizeBytes: 2048,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.key.startsWith(`buildings/${shareholder.building.id}/`)).toBe(
      true,
    );
  });

  it("refuses a download for a document that isn't there", async () => {
    const result = await requestDownload(
      shareholder,
      "00000000-0000-4000-8000-000000000000",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toEqual("not_found");
  });
});
