/** Fresh discovery replaces prior rows; pagination updates labels without duplicates.
 * Selection IDs are maintained separately and never inferred from these labels.
 * @param {any[]} previous @param {any[]} page @param {boolean} append */
export function mergeDiscoveredSources(previous, page, append) {
  const rows = new Map((append ? previous : []).map((row) => [row.id, row]));
  for (const row of page) rows.set(row.id, row);
  return [...rows.values()];
}
