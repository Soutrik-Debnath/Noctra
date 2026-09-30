<script lang="ts">
  /**
   * Bottom mini-player bar. Always present; clicking the artwork or the track text expands the
   * full Now Playing view.
   */
  import Icon from "./Icon.svelte";
  import PlayerControls from "./PlayerControls.svelte";
  import ProgressBar from "./ProgressBar.svelte";
  import VolumePill from "./VolumePill.svelte";
  import { player } from "../stores/player.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { ui } from "../stores/ui.svelte";
  import { sleep } from "../stores/sleep.svelte";
  import { openSleepMenu } from "../services/sleepMenu";
  import { toggleMiniWindow } from "../services/windowBridge";

  const isFavorite = $derived(player.current ? favorites.has(player.current.id) : false);
  let pop = $state(false);
  /**
   * The fracture on un-like, matching the fullscreen view and the desktop card.
   *
   * The bar was the only one of the three that just swapped the glyph, which made liking feel like a
   * state write rather than a gesture. Duration comes from `heart-break-*` in app.css (1250ms) and is
   * kept in step the same way the card keeps `BREAK_MS`.
   */
  const BREAK_MS = 1250;
  let breaking = $state(false);
  /**
   * The glyph drawn at rest.
   *
   * The bar deliberately does NOT keep the heart split into two clipped halves the way the sleeve and
   * the card do. `.heart-half` overlaps its halves by 1% so antialiasing can't leave a seam, and on a
   * 150px heart that is 1.5px — invisible. On this 22px glyph it is 0.22px, i.e. a sub-pixel sliver
   * where a filled heart can show a hairline crack down its middle at some zoom levels and device pixel
   * ratios. The split only exists to be animated, so it only renders while breaking; at rest there is
   * one glyph and no seam to get wrong.
   *
   * The bar's liked state stays red rather than going white like the sleeve heart — see the note on
   * `.heart-lit` in app.css: at 18-22px a hue change is the only thing that can carry the state.
   */
  const heartGlyph = $derived(isFavorite ? "heart-filled" : "heart");

  /**
   * The one-shot that plays when "play similar" is switched on.
   *
   * The steady state is already carried by `.orb-on` in app.css — accent ink plus a two-layer bloom —
   * so this is only the transition into it. A mode that changes what you hear next is worth
   * acknowledging at the moment you commit to it.
   */
  const SIMILAR_POP_MS = 560;
  let similarPop = $state(false);
</script>

<footer class="bar glass">
  <button class="meta" onclick={() => ui.openFullscreen()} title="Open fullscreen player">
    <img class="thumb" src={player.current.artwork} alt="" draggable="false" />
    <span class="text">
      <span class="title">{player.current.title}</span>
      <span class="artist">{player.current.artist}</span>
    </span>
    <span class="chev" aria-hidden="true"><Icon name="chevron" size={16} /></span>
  </button>

  <div class="centre">
    <PlayerControls compact />
    <ProgressBar position={player.position} duration={player.duration} showTimes={false} />
  </div>

  <div class="right">
    {#if player.isBuffering}
      <span class="status">{player.hasStarted ? "buffering…" : "starting audio…"}</span>
    {:else if player.error}
      <!-- Show the real sentence, not "playback error". The wording is what distinguishes a
           rejected source from a decode failure, and until now nobody could see it. -->
      <span class="status bad" role="alert" title={player.error}>{player.error}</span>
    {/if}

    <button
      class="orb orb-bare"
      class:orb-love={isFavorite}
      class:heart-pop={pop}
      class:heart-breaking={breaking}
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFavorite}
      onclick={() => {
        const id = player.current?.id;
        if (!id) return;
        // Only pulse on the way *in*. A pop on un-like reads as a reward for removing it.
        if (!isFavorite) {
          pop = true;
          setTimeout(() => (pop = false), 460);
        } else {
          breaking = true;
          setTimeout(() => (breaking = false), BREAK_MS);
        }
        favorites.toggle(id);
      }}
    >
      {#if breaking}
        <!-- Filled unconditionally: `isFavorite` has already flipped to false by the time the break
             runs, and a stroke heart splitting in two reads as a glitch. -->
        <span class="heart-half left"><Icon name="heart-filled" size={22} /></span>
        <span class="heart-half right"><Icon name="heart-filled" size={22} /></span>
      {:else}
        <Icon name={heartGlyph} size={22} />
      {/if}
    </button>
    <button
      class="orb orb-bare similar"
      class:orb-on={player.similar}
      class:similar-pop={similarPop}
      title={
        player.similar
          ? "Play similar is on — what comes next is picked from songs like this one"
          : "Play similar — keep the run in this song's neighbourhood instead of the whole library"
      }
      aria-label="Play similar"
      aria-pressed={player.similar}
      onclick={() => {
        player.similar = !player.similar;
        // Only the way in animates, matching the favourite: a flourish on the way out reads as the
        // app being sorry to see the mode go.
        if (player.similar) {
          similarPop = true;
          setTimeout(() => (similarPop = false), SIMILAR_POP_MS);
        }
      }}
    >
      <Icon name="sparkle" size={20} />
    </button>
    <button
      class="orb orb-bare"
      class:lit={ui.queueOpen}
      title="Queue"
      aria-label="Queue"
      aria-pressed={ui.queueOpen}
      onclick={() => ui.toggleQueue()}
    >
      <Icon name="queue" size={22} />
    </button>
    <button
      class="orb orb-bare sleep"
      class:lit={sleep.active}
      title={sleep.active ? `Sleep timer — ${sleep.label}` : "Sleep timer"}
      aria-label="Sleep timer"
      aria-pressed={sleep.active}
      onclick={(e) => openSleepMenu(e)}
    >
      <Icon name="clock" size={22} />
      {#if sleep.active}<span class="count">{sleep.label}</span>{/if}
    </button>
    <button
      class="orb orb-bare"
      class:orb-on={ui.miniOpen}
      title={ui.miniOpen ? "Close the desktop mini-player" : "Desktop mini-player"}
      aria-label="Desktop mini-player"
      aria-pressed={ui.miniOpen}
      onclick={() => void toggleMiniWindow()}
    >
      <Icon name="pip" size={22} />
    </button>
    <span class="vol">
      <VolumePill
        orientation="horizontal"
        width={112}
        height={22}
        value={player.volume}
        muted={player.muted}
        oninput={(v) => player.setVolume(v)}
        onmute={() => player.setMuted(!player.muted)}
      />
      <!-- Reads 0% while muted, matching the capsule, whose fill already collapses via
           `level = muted ? 0 : value`. Mute is a switch rather than a volume change, so un-muting
           returns the stored level — the readout reports what you actually hear, not what the slider
           remembers. -->
      <span class="pct" title={player.muted ? "Muted" : "Volume"}>
        {player.muted ? 0 : Math.round(player.volume * 100)}%
      </span>
    </span>
  </div>
</footer>

<style>
  /* The queue button doubles as an open/closed toggle, so it has to look engaged while the panel is
     up. Without this the only cue that the queue is open is the panel itself. */
  /* Queue and sleep report their state through `.lit` rather than `.orb-on`, so the two read as one set
     of controls. The bloom is no longer copied here — it comes from `--orb-lit-glow`, which is the only
     way these two stayed identical without someone remembering to edit both. The off state comes from
     `.orb-bare[aria-pressed="false"]` in app.css. */
  .orb-bare.lit {
    color: var(--accent-lit);
    filter: var(--orb-lit-glow);
  }

  /*
     Committing to "play similar" gets one acknowledgement.

     This is the only mark in the bar that changes what you hear *next* rather than what happens now,
     so the moment of deciding is worth marking. The steady state is already `.orb-on`'s accent ink and
     two-layer bloom; this is only the transition into it — a quarter revolution up from small, with
     the bloom arriving alongside rather than already being there.

     560ms is SIMILAR_POP_MS. The two have to agree or the class is removed mid-animation and the last
     third of the curve never renders, which shows up as a mark that snaps to size instead of settling.
  */
  .orb-bare.similar-pop :global(svg) {
    animation: similar-on 560ms var(--ease-out);
  }

  @keyframes similar-on {
    0% {
      transform: scale(0.68) rotate(-72deg);
      opacity: 0.35;
    }
    55% {
      transform: scale(1.16) rotate(8deg);
      opacity: 1;
    }
    100% {
      transform: scale(1) rotate(0deg);
    }
  }

  /* The countdown sits beside the clock only while a timer is running, so the bar does not carry a
     permanent label for a feature that is usually off.

     `width: auto` is what lets it grow for that label, and it was also quietly breaking the row: an
     auto box on a 22px glyph with 9px of padding measures 42px while its four neighbours measure 38, so
     the pitch read 38, 38, 40, 40 — the exact irregularity the equal-box rule above exists to prevent.
     The padding therefore only arrives with the label, and the resting box is pinned to the shared
     `--orb-size`. */
  .sleep {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: auto;
    min-width: var(--orb-size, 38px);
    gap: 6px;
  }

  .sleep:has(.count) {
    padding: 0 9px;
  }

  .count {
    font-size: var(--fs-xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.2px;
  }

  /* Volume plus a numeric readout. The percentage is the only way to see the exact level, and
     tabular figures stop it jittering width as the number changes.

     The left margin is a group break, not padding. The five marks before it are momentary commands and
     this is a continuous control, so giving them the same 0 gap the icons use flattened the row into one
     undifferentiated line. 16px of box separation reads as ~24px of air from the last glyph, which is
     enough to say "different kind of thing" without opening a hole in the bar. */
  .vol {
    display: flex;
    align-items: center;
    gap: 9px;
    margin-left: 16px;
  }

  .pct {
    min-width: 34px;
    font-size: var(--fs-xs);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    color: var(--text-dim);
    text-align: right;
  }

  .bar {
    position: absolute;
    /* Full window width, like the reference. It used to stop short at the rail's edge, which left a
       dead gap of background in the bottom-left corner and made the pill look like a widget parked in
       the middle of the screen rather than the base layer of it. The rail clears this — it stops at
       `--bar-h + --float-inset` from the bottom — so the two never overlap. */
    left: var(--float-inset);
    right: var(--float-inset);
    bottom: var(--float-inset-bottom);
    z-index: 20;
    height: var(--miniplayer-h);
    display: grid;
    /* The transport is centred by construction: the middle track is exactly its own width and the two
       side tracks split what remains equally. `1fr 2fr 1fr` only looked centred — the right cluster is
       ~365px of content in a 290px track, so it spilled left through the column gap and came within 15px
       of the transport, which is the crowding this row kept reading as.
       The right track's floor is that content width, so the cluster can never spill into the transport
       again; when the window does get tight it is the title column that gives, since it truncates.

       The middle track used to be `auto`, which starved the seek bar: `.bar-row` is `width: 100%` of
       that column, and a 100%-wide child of an auto-sized column resolves against the column's own
       intrinsic width — for a flex row whose track is `flex: 1`, that minimum collapses. The seek was
       252px on a 1252px bar while each side track hoovered up 454px. Giving the middle the largest
       share fixes both halves of the complaint at once: the seek gets real length and the now-playing
       block stops eating the row. */
    grid-template-columns: minmax(160px, 1fr) minmax(0, 2.4fr) minmax(380px, 1fr);
    align-items: center;
    gap: 20px;
    padding: 0 26px;
    /* The reference's now-playing surface is a detached stadium, not a bar welded to the bottom
       edge. `glass` supplies the fill, blur, rim and bloom; only the shape is local. */
    border-radius: var(--radius-pill);
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 13px;
    min-width: 0;
    padding: 7px 9px;
    border-radius: 11px;
    text-align: left;
    transition: background-color 180ms var(--ease-out);
  }

  .meta:hover {
    background: var(--surface-1);
  }

  .thumb {
    width: 60px;
    height: 60px;
    border-radius: 13px;
    object-fit: cover;
    flex: none;
    box-shadow:
      0 6px 18px -8px rgba(0, 0, 0, 0.8),
      inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }

  .text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    gap: 3px;
  }

  .title {
    font-size: var(--fs-base);
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artist {
    font-size: var(--fs-sm);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .chev {
    margin-left: auto;
    color: var(--text-faint);
    flex: none;
  }

  .centre {
    display: flex;
    flex-direction: column;
    align-items: center;
    /* The visible distance from the 52px play disc to the scrubber is this plus the 4px of hit box
       that sits above the rail, so 6px here reads as 12px. It was 4px, which is 10px of air — tight
       against the 17px the scrubber now gets from the floor, and the reason the centre column still
       read as one clumped row. */
    gap: 6px;
    /* The column is centred in the bar, so the 52px disc sat 11px from the top edge while the
       artwork and the right-hand icons both centred at 50 — the transport read as 13px too high
       next to them. This padding pushes the disc down inside the column; the gap gives 2px back so
       the stack does not simply grow and undo the shift. */
    padding-top: 10px;
    min-width: 0;
  }

  /* Was 460px, which became the binding constraint the moment the middle track stopped being `auto` —
     the column could give the seek more than that and the cap silently threw it away. Kept as a
     ceiling only so the bar does not run under the transport on an ultrawide window. */
  .centre :global(.bar-row) {
    max-width: 760px;
  }

  .right {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 0;
  }

  /*
     One hit box for the whole cluster.

     The heart and queue were 52px discs and the sleep timer 38px, each around the same 18px glyph, so
     the declared 6px gap rendered as 40px, then 40px, then 33px. A row whose spacing changes by 7px for
     no visible reason is what reads as cheap — the eye cannot find the rhythm even though the numbers
     say it is regular. Optical spacing between two bare glyphs is `gap + (box − glyph)` of the pair, so
     equal boxes are the only way to get equal gaps.

     38px box, zero gap, 22px glyph: the glyphs sit 16px apart on a 38px pitch. It was a 42px box with a
     4px gap, which is 24px of air between two marks that do the same kind of job — five controls drifting
     apart into the empty left half of the bar, trailing away from the volume they belong with. 38px is
     still a comfortable click target.
  */
  .right :global(.orb) {
    --orb-size: 38px;
  }

  /*
     The bar's own floor, and why the cluster has to shrink rather than slide.

     `.right` is a `minmax(200px, 1fr)` track, but its content is `5 boxes + 5 gaps + rail` = 385px.
     A grid track does not grow to fit an overflowing flex row, so the surplus walks left out of the
     track and into the transport: measured against the real sheet, the volume rail lands 90px on top
     of the shuffle glyph at 1100px wide and 165px on top of it at the window's own 900px minimum.
     Everything is fine above ~1200px, which is why it was never caught — the default size hides it.

     So the third column takes its content width and the two left columns give up their fixed floors,
     and the cluster tightens to pay for it: 38px is `.orb-sm`, an established box in this set, and the
     numeric readout is the one element whose information the capsule already shows as a fill level.
     No control is dropped at any width.
  */
  @media (max-width: 1200px) {
    .bar {
      padding: 0 18px;
      gap: 14px;
      grid-template-columns: minmax(170px, 1fr) minmax(250px, 2fr) auto;
    }

    .right {
      gap: 3px;
    }

    .right :global(.orb) {
      --orb-size: 38px;
    }

    .pct {
      display: none;
    }
  }

  /*
     The two fracture halves have to be exactly as wide as the glyph they carry.

     `.heart-half` clips at `inset(0 49% 0 0)` / `inset(0 0 0 49%)`, and a percentage clip resolves
     against the *span's* box, not the artwork inside it. On the sleeve and the card the host is sized
     to the heart, so 49% is the heart's own centre line. Here the orb is a 42px hit box around a 22px
     glyph, so the shared percentages cut outside the glyph and the two halves recombined as two
     misaligned hearts instead of one. Pinning the halves to the glyph size puts the seam back where it
     belongs.
  */
  .right :global(.heart-half) {
    width: 22px;
    height: 22px;
  }

  .status {
    font-size: var(--fs-xs);
    letter-spacing: 0.3px;
    text-transform: uppercase;
    color: var(--text-faint);
    white-space: nowrap;
    margin-right: 6px;
  }

  .status.bad {
    color: #ffb3b8;
    /* Real error sentences are long; the bar must not reflow around one. */
    max-width: 230px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-transform: none;
    letter-spacing: 0;
    font-size: var(--fs-sm);
  }

</style>
