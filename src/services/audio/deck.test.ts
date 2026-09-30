import { test } from "node:test";
import assert from "node:assert/strict";
import { Deck, type MediaLike } from "./deck.ts";

/** Stands in for HTMLAudioElement. Records calls so the gate can be observed. */
class FakeMedia implements MediaLike {
  src = "";
  preload = "";
  volume = 1;
  muted = false;
  currentTime = 0;
  duration = 100;
  readyState = 0;
  error = null as { code: number } | null;
  loads = 0;
  plays = 0;
  pauses = 0;
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {
    /* not needed by these tests */
  }
  load() { this.loads += 1; this.readyState = 0; }
  play() { this.plays += 1; return Promise.resolve(); }
  pause() { this.pauses += 1; }
  dispatch(type: string) {
    const list = this.listeners.get(type);
    if (!list?.length) throw new Error(`FakeMedia: no listener registered for "${type}"`);
    for (const fn of list) fn();
  }
}

function makeDeck() {
  const media = new FakeMedia();
  const seen: string[] = [];
  /** Payloads in forwarding order — lets `error` be checked for actually carrying its code. */
  const payloads: unknown[] = [];
  const deck = new Deck(() => media, (event, payload) => {
    seen.push(event);
    payloads.push(payload);
  });
  return { media, deck, seen, payloads };
}

test("a new deck is idle, not authoritative, and at full gain", () => {
  const { deck } = makeDeck();
  assert.equal(deck.role, "idle");
  assert.equal(deck.authoritative, false);
  assert.equal(deck.ramp, 1);
});

test("only the active deck's events reach the store - spec §4.2", () => {
  const { media, deck, seen } = makeDeck();
  deck.role = "active";
  media.dispatch("play");
  media.dispatch("waiting");
  media.dispatch("ended");
  assert.deepEqual(seen, ["playing", "waiting", "ended"]);
});

test("a fading-out deck emits nothing, so ended cannot advance the run twice", () => {
  const { media, deck, seen } = makeDeck();
  deck.role = "active";
  deck.role = "fading-out";
  media.dispatch("ended");
  media.dispatch("pause");
  media.dispatch("durationchange");
  assert.deepEqual(seen, []);
});

test("an arming deck emits nothing either, but tracks readiness internally", () => {
  const { media, deck, seen } = makeDeck();
  deck.role = "arming";
  media.readyState = 4;
  media.dispatch("canplay");
  assert.deepEqual(seen, []);
  assert.equal(deck.ready, true);
});

test("errors are always forwarded, including from a deck nobody can hear", () => {
  const { media, deck, seen, payloads } = makeDeck();
  media.error = { code: 4 };
  deck.role = "arming";
  media.dispatch("error");
  assert.deepEqual(seen, ["error"]);
  // `media` is private, so the code has to ride on the event or the user only ever gets a
  // generic message — the "asset protocol is not permitted to read it" case from spec §7.
  assert.deepEqual(payloads, [4]);
  media.error = null;
  media.dispatch("error");
  assert.deepEqual(payloads, [4, null]);
});

test("arming the same source twice does not reload it", () => {
  const { media, deck } = makeDeck();
  deck.arm("http://noctra-audio.localhost/a.flac");
  const first = media.loads;
  deck.arm("http://noctra-audio.localhost/a.flac");
  assert.equal(media.loads, first);
  assert.equal(deck.role, "arming");
});

test("a different source does reload, and clears the ready flag", () => {
  const { media, deck } = makeDeck();
  deck.arm("http://noctra-audio.localhost/a.flac");
  media.readyState = 4;
  deck.arm("http://noctra-audio.localhost/b.flac");
  assert.equal(deck.ready, false);
  assert.equal(media.src, "http://noctra-audio.localhost/b.flac");
});

test("release returns the deck to silence and frees the stream", () => {
  const { media, deck } = makeDeck();
  deck.role = "fading-out";
  deck.ramp = 0.3;
  deck.release();
  assert.equal(deck.role, "idle");
  assert.equal(deck.ramp, 1);
  assert.equal(media.pauses, 1);
  assert.equal(media.src, "");
});

test("volume is user gain times the deck ramp, clamped, and mute survives the ramp", () => {
  const { media, deck } = makeDeck();
  deck.ramp = 0.5;
  deck.applyVolume(0.8, false);
  assert.equal(Number(media.volume.toFixed(3)), 0.4);
  deck.applyVolume(0.8, true);
  assert.equal(media.muted, true);
  deck.ramp = 2;
  deck.applyVolume(1, false);
  assert.equal(media.volume, 1);
});

test("startAtZero puts the deck at the top of the track and plays it", async () => {
  const { media, deck } = makeDeck();
  deck.role = "arming";
  media.currentTime = 40;
  await deck.startAtZero();
  assert.equal(media.currentTime, 0);
  assert.equal(media.plays, 1);
});

test("seekTo moves the playhead without playing, and refuses a broken value", () => {
  const { media, deck } = makeDeck();
  deck.role = "active";
  deck.seekTo(37.5);
  assert.equal(media.currentTime, 37.5);
  // Seeking must never start sound: a paused deck stays paused wherever the playhead lands.
  assert.equal(media.plays, 0);
  // `currentTime` is a WebIDL double: handing it NaN throws a TypeError on a real element, taking
  // the whole seek down with it. Clamping to the end of the track is the engine's job.
  deck.seekTo(Number.NaN);
  assert.equal(media.currentTime, 37.5);
  deck.seekTo(-4);
  assert.equal(media.currentTime, 0);
});
