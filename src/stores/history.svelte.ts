/**
 * Listening history: play counts, last-played order, and total time.
 *
 * This is what makes "Most played", "Recently played" and the statistics page possible, and it is
 * also the data a smart shuffle would use — so it starts recording now rather than in the phase
 * that wants to display it, because history cannot be back-filled.
 *
 * Stored in `localStorage` beside the favourites list for the same reason: it is webview-only data,
 * and the Rust library file is typed around tracks.
 */

const KEY = "noctra.history";
/** Bounded so a years-old install cannot grow the entry forever. Oldest-first entries are dropped. */
const MAX_HISTORY = 500;
/** Ceiling on stored "heard together" pairs, for the same reason. */
const MAX_PAIRS = 4000;

type History = {
  plays: Record<string, number>;
  /** Track ids, most recently played last. */
  recent: string[];
  /** Seconds actually listened, summed across sessions. */
  secondsListened: number;
  /** First time each track was ever played, in epoch ms. Powers "recently added" style views. */
  firstPlayed: Record<string, number>;
  /**
   * How often two tracks followed each other in playback, keyed `idA|idB` with the ids sorted so
   * A→B and B→A land on one bucket. This is the local stand-in for "songs from the same mood":
   * nobody needs a recommendation service to tell Noctra that you always queue these two together.
   */
  pairs: Record<string, number>;
};

const EMPTY: History = {
  plays: {},
  recent: [],
  secondsListened: 0,
  firstPlayed: {},
  pairs: {},
};

/** Order-independent key for an unordered pair. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function load(): History {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...EMPTY, ...(JSON.parse(raw) as Partial<History>) } : { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

class HistoryStore {
  private data = load();

  /** Reactive mirror of the counts, replaced wholesale so Svelte 5 sees the change. */
  plays = $state<Record<string, number>>(this.data.plays);
  recent = $state<string[]>(this.data.recent);

  private dirty = false;

  constructor() {
    // One timer for the whole app rather than a write per play event: listening time accrues
    // continuously and `localStorage` writes are synchronous.
    setInterval(() => {
      if (this.dirty) {
        this.dirty = false;
        this.persist();
      }
    }, 5000);
  }

  /** Record that a track started. Idempotent per call, so a re-render cannot double-count. */
  recordStart(id: string) {
    const previous = this.data.recent[this.data.recent.length - 1];
    this.data.plays[id] = (this.data.plays[id] ?? 0) + 1;
    // Only the immediately preceding track counts as "heard together" — a run of ten songs by one
    // artist would otherwise link every pair in it, which turns a sequence into a clique and makes
    // the signal useless.
    if (previous && previous !== id) {
      const key = pairKey(previous, id);
      this.data.pairs[key] = (this.data.pairs[key] ?? 0) + 1;
      const keys = Object.keys(this.data.pairs);
      if (keys.length > MAX_PAIRS) {
        for (const k of keys.slice(0, keys.length - MAX_PAIRS)) delete this.data.pairs[k];
      }
    }
    this.data.recent = [...this.data.recent.filter((r) => r !== id), id].slice(-MAX_HISTORY);
    this.data.firstPlayed[id] ??= Date.now();
    this.plays = { ...this.data.plays };
    this.recent = [...this.data.recent];
    this.dirty = true;
  }

  /** Times these two tracks have followed each other. Zero if never. */
  together(a: string, b: string): number {
    return this.data.pairs[pairKey(a, b)] ?? 0;
  }

  addSeconds(s: number) {
    if (s > 0 && s < 120) {
      this.data.secondsListened += s;
      this.dirty = true;
    }
  }

  count(id: string): number {
    return this.plays[id] ?? 0;
  }

  get secondsListened(): number {
    return this.data.secondsListened;
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* Quota or a disabled store: history stops recording, nothing else breaks. */
    }
  }

  clear() {
    // Built fresh rather than spreading EMPTY: those object literals are shared references, and a
    // later recordStart would mutate the same object EMPTY still points at.
    this.data = { plays: {}, recent: [], firstPlayed: {}, secondsListened: 0, pairs: {} };
    this.plays = {};
    this.recent = [];
    this.persist();
  }
}

export const history = new HistoryStore();
