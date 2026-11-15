import { fail } from "./errors";

export function orderKey(time: number, creationTime: number, id: string) {
  return `${time.toFixed(6).padStart(24, "0")}:${creationTime.toFixed(6).padStart(24, "0")}:${id}`;
}

export async function visiblePage<T extends { orderKey?: string }>(
  cursor: string | null,
  limit: number,
  fetch: (after: string | null, size: number) => Promise<T[]>,
  visible: (item: T) => Promise<boolean>,
) {
  const items: T[] = [];
  let after = cursor;
  for (let scanned = 0; scanned < 512; scanned += 64) {
    const batch = await fetch(after, 65);
    for (const item of batch.slice(0, 64)) {
      if (!item.orderKey) fail("LIMIT_REACHED", "Content ordering is unavailable", true);
      after = item.orderKey;
      if (await visible(item)) items.push(item);
      if (items.length > limit) return { items: items.slice(0, limit), hasMore: true };
    }
    if (batch.length <= 64) return { items, hasMore: false };
  }
  return fail("LIMIT_REACHED", "This page exceeds its visibility budget", true);
}
