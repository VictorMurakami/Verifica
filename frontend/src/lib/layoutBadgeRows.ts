/**
 * Greedily packs badge widths into rows that fit within maxWidth, so callers
 * can reserve the right height instead of cutting off wrapped rows.
 */
export function layoutBadgeRows(widths: number[], maxWidth: number, gap: number): number[][] {
  const rows: number[][] = [];
  let currentRow: number[] = [];
  let currentWidth = 0;

  widths.forEach((width, index) => {
    const additional = currentRow.length === 0 ? width : gap + width;
    if (currentRow.length > 0 && currentWidth + additional > maxWidth) {
      rows.push(currentRow);
      currentRow = [index];
      currentWidth = width;
    } else {
      currentRow.push(index);
      currentWidth += additional;
    }
  });

  if (currentRow.length > 0) rows.push(currentRow);
  return rows;
}
