/**
 * Sleep timer.
 *
 * Deliberately holds no reference to the player: it counts down and calls whatever `onExpire` the
 * app registered. The player imports this store, not the other way round, which keeps the cycle
 * closed and lets "stop after this song" live in the player's own end-of-track path where the
 * decision is actually made.
 */
const KEY = "noctra.sleep";

export const PRESET_MINUTES = [15, 30, 45, 60] as const;

class SleepStore {
  /** Epoch ms when playback should stop, or 0 when the timer is off. */
  endsAt = $state(0);
  /** Pause at the end of the current track instead of continuing into the next one. */
  stopAfterCurrent = $state(false);
  /** Remaining whole seconds, kept fresh by the tick below so the label counts down. */
  remaining = $state(0);

  onExpire: (() => void) | null = null;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { endsAt?: number; stopAfterCurrent?: boolean };
        // A timer that expired while the app was closed must not fire the instant it reopens.
        if (saved.endsAt && saved.endsAt > Date.now()) this.endsAt = saved.endsAt;
        this.stopAfterCurrent = !!saved.stopAfterCurrent;
      }
    } catch {
      // A corrupt entry just means no timer.
    }
  }

  get active(): boolean {
    return this.endsAt > 0 || this.stopAfterCurrent;
  }

  /** `minutes` of 0 turns the countdown off without touching the stop-after-song flag. */
  setMinutes(minutes: number): void {
    this.endsAt = minutes > 0 ? Date.now() + minutes * 60_000 : 0;
    this.remaining = minutes * 60;
    this.persist();
  }

  setStopAfterCurrent(on: boolean): void {
    this.stopAfterCurrent = on;
    this.persist();
  }

  clear(): void {
    this.endsAt = 0;
    this.stopAfterCurrent = false;
    this.remaining = 0;
    this.persist();
  }

  /** Human label, e.g. "23:41 left" or "after this song". */
  get label(): string {
    if (this.endsAt > 0) {
      const m = Math.floor(this.remaining / 60);
      const s = this.remaining % 60;
      return `${m}:${String(s).padStart(2, "0")} left`;
    }
    if (this.stopAfterCurrent) return "After this song";
    return "";
  }

  /** Call once a second from an effect. Returns nothing; fires `onExpire` exactly once. */
  tick(): void {
    if (this.endsAt === 0) {
      if (this.remaining !== 0) this.remaining = 0;
      return;
    }
    const left = Math.max(0, Math.round((this.endsAt - Date.now()) / 1000));
    this.remaining = left;
    if (left === 0) {
      this.endsAt = 0;
      this.persist();
      this.onExpire?.();
    }
  }

  private persist(): void {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ endsAt: this.endsAt, stopAfterCurrent: this.stopAfterCurrent }),
      );
    } catch {
      // Quota or a disabled store: the timer still works for this session.
    }
  }
}

export const sleep = new SleepStore();
