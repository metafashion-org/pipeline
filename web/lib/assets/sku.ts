/**
 * Builds the next asset SKU in the sequence the pipeline actually uses.
 *
 * Live SKUs are `MF-<year>-<4 digits>` (34 of them) plus older `MF-<ulid>` values created by the intake form. The previous generator produced `SKU-ADMIN-<timestamp>`, which matched neither, so anything created from the admin UI sorted and read differently from every other asset.
 *
 * Input: the SKUs already in use and the year to issue under. Output: the next unused sequential SKU for that year.
 * Only `MF-<year>-` SKUs are considered when finding the highest number, so the ULID-style ones never inflate the counter.
 */
export function nextSequentialSku(existingSkus: string[], year: number): string {
  const prefix = `MF-${year}-`;
  let highest = 0;

  for (const sku of existingSkus) {
    if (!sku.startsWith(prefix)) continue;
    const suffix = sku.slice(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;
    highest = Math.max(highest, Number(suffix));
  }

  return `${prefix}${String(highest + 1).padStart(4, "0")}`;
}
