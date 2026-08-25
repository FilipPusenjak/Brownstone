import { describe, expect, it } from "vitest";
import {
  boroughCode,
  communityDistrict,
  normaliseBbl,
  plutoAddress,
} from "~/lib/nyc/address";

/**
 * Matching an address against the city's records.
 *
 * Every expectation here was checked against PLUTO itself rather than reasoned
 * about, because the dataset's conventions are not the ones an address parser
 * would guess. The counts quoted in the comments are what the live dataset
 * returned when these rules were written; they are there to record that the
 * rule came from evidence, not to be re-verified on every run — a unit suite
 * that calls a city API is a suite that fails when the city has an outage.
 *
 * The stakes are quiet but real. A miss here is not an error message; it is a
 * founder being told the city has no record of a building that is plainly
 * there, and then typing twelve attributes by hand, several of them wrong.
 */

describe("normalising an address for PLUTO", () => {
  it("expands a street type at the end", () => {
    expect(plutoAddress("150 Bergen St")).toEqual("150 BERGEN STREET");
    expect(plutoAddress("114 Adelaide Pl")).toEqual("114 ADELAIDE PLACE");
    expect(plutoAddress("30 Ocean Pkwy")).toEqual("30 OCEAN PARKWAY");
  });

  it("leaves a saint alone", () => {
    // The rule that earns its keep. PLUTO holds 288 lots on ST MARKS PLACE and
    // four on SAINT MARKS PLACE — expanding ST wherever it appears turns this
    // into STREET MARKS PLACE and matches nothing at all.
    expect(plutoAddress("20 St Marks Place")).toEqual("20 ST MARKS PLACE");
    expect(plutoAddress("112 St Johns Pl")).toEqual("112 ST JOHNS PLACE");
  });

  it("spells out compass directions", () => {
    // 175 lots on EAST 10 STREET in Manhattan; none on E 10 STREET.
    expect(plutoAddress("47 E 10th St")).toEqual("47 EAST 10 STREET");
    expect(plutoAddress("310 W 88 Street")).toEqual("310 WEST 88 STREET");
  });

  it("drops the ordinal from a numbered street", () => {
    // 517 lots on 5 AVENUE; three on 5TH AVENUE, which is the data being
    // untidy rather than a second convention.
    expect(plutoAddress("998 5th Avenue")).toEqual("998 5 AVENUE");
    expect(plutoAddress("1 W 72nd St")).toEqual("1 WEST 72 STREET");
  });

  it("keeps a Queens house number whole", () => {
    // 84-74 is the house number, not a range, and hyphens survive on purpose.
    expect(plutoAddress("84-74 257 Street")).toEqual("84-74 257 STREET");
  });

  it("never rewrites the leading token", () => {
    // A house number can look like anything a rule would want to change: an
    // ordinal, or a compass point. Both would be silent misses.
    expect(plutoAddress("10 East 10 Street")).toEqual("10 EAST 10 STREET");
    expect(plutoAddress("1st Place")).toEqual("1ST PLACE");
  });

  it("takes punctuation and stray spacing out", () => {
    expect(plutoAddress("  150   Bergen St.  ")).toEqual("150 BERGEN STREET");
    expect(plutoAddress("150 Bergen St., Apt 2")).toEqual("150 BERGEN ST APT 2");
  });

  it("gives an empty address back rather than something to query with", () => {
    expect(plutoAddress("   ")).toEqual("");
  });
});

describe("borough codes", () => {
  it("are PLUTO's two letters", () => {
    expect(boroughCode("BROOKLYN")).toEqual("BK");
    expect(boroughCode("MANHATTAN")).toEqual("MN");
    expect(boroughCode("STATEN_ISLAND")).toEqual("SI");
  });
});

describe("community districts", () => {
  it("unpack the borough digit", () => {
    // 302 is Brooklyn 02 — the same shape the seed writes, "BK 06".
    expect(communityDistrict("302")).toEqual("BK 02");
    expect(communityDistrict("413")).toEqual("QN 13");
    expect(communityDistrict("101")).toEqual("MN 01");
  });

  it("refuse anything that isn't three digits", () => {
    expect(communityDistrict("")).toBeNull();
    expect(communityDistrict(null)).toBeNull();
    expect(communityDistrict("3")).toBeNull();
    expect(communityDistrict("903")).toBeNull();
  });
});

describe("BBLs", () => {
  it("lose the float the export leaves on them", () => {
    expect(normaliseBbl("3003860014.00000000")).toEqual("3003860014");
  });

  it("are ten digits or nothing", () => {
    expect(normaliseBbl("30038600")).toBeNull();
    expect(normaliseBbl(null)).toBeNull();
    expect(normaliseBbl("not a bbl")).toBeNull();
  });
});
