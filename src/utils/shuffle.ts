/**
 * The one shuffle in the app, and it is Fisher-Yates on purpose.
 *
 * `list.sort(() => Math.random() - 0.5)` is the reflex version and it is wrong: that comparator is
 * inconsistent (it can claim a<b and b<a for the same pair), so the sort never explores the same
 * set of permutations evenly and the result is biased toward keeping the original order. It is
 * cheap to get right and easy to get subtly wrong, so it lives here rather than inlined at each
 * call site.
 */
export function fisherYates<T>(list: T[]): T[] {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** A uniform random element. Returns `undefined` for an empty list. */
export function pickRandom<T>(list: T[]): T | undefined {
  if (list.length === 0) return undefined;
  return list[Math.floor(Math.random() * list.length)];
}
