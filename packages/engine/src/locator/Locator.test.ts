import { describe, expect, it } from "vitest";
import { Locator } from "./Locator.js";

describe("Locator", () => {
  it("wraps and exposes its CFI string", () => {
    const locator = new Locator("epubcfi(/6/4!/4/2/2/1:0)");

    expect(locator.cfi).toBe("epubcfi(/6/4!/4/2/2/1:0)");
    expect(locator.toString()).toBe("epubcfi(/6/4!/4/2/2/1:0)");
  });
});
