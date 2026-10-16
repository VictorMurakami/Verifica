import { describe, expect, it } from "vitest";
import { layoutBadgeRows } from "./layoutBadgeRows";

describe("layoutBadgeRows", () => {
  it("keeps a single row when everything fits", () => {
    const widths = [40, 50, 30];
    expect(layoutBadgeRows(widths, 200, 10)).toEqual([[0, 1, 2]]);
  });

  it("wraps 5 categories that do not fit in one line into multiple full rows", () => {
    // Mirrors the 5 ExcerptCategory labels at the card's badge font size (approx widths).
    const widths = [140, 90, 160, 120, 130];
    const rows = layoutBadgeRows(widths, 300, 10);

    expect(rows.length).toBeGreaterThan(1);
    // Every index appears exactly once, in order, across all rows.
    expect(rows.flat()).toEqual([0, 1, 2, 3, 4]);
    // No row exceeds the available width.
    for (const row of rows) {
      const rowWidth = row.reduce((sum, i) => sum + widths[i], 0) + (row.length - 1) * 10;
      expect(rowWidth).toBeLessThanOrEqual(300);
    }
  });

  it("puts a single oversized badge alone on its own row instead of dropping it", () => {
    expect(layoutBadgeRows([500], 300, 10)).toEqual([[0]]);
  });

  it("returns an empty array for no badges", () => {
    expect(layoutBadgeRows([], 300, 10)).toEqual([]);
  });
});
