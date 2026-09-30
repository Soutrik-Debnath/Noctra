<script lang="ts">
  /**
   * Home.
   *
   * Structured the way Noctis builds its home screen, because the previous version here was just a
   * flat track list — which made Home and Library the same page twice. The order is: a Continue
   * listening hero, Top Artists as circles, Most Played and Last Played side by side, then Albums.
   *
   * Everything is derived from the scanned library and the listening history. There is no
   * server-side "mix" because there is no server: the only honest signal available offline is what
   * you have actually played.
   */
  import Icon from "../components/Icon.svelte";
  import MediaCard from "../components/MediaCard.svelte";
  import { player } from "../stores/player.svelte";
  import { library } from "../stores/library.svelte";
  import { history } from "../stores/history.svelte";
  import { favorites } from "../stores/favorites.svelte";
  import { ui } from "../stores/ui.svelte";
  import { formatTime } from "../utils/format";
  import { groupAlbums } from "../services/collections";
  import { menu } from "../stores/menu.svelte";
  import { trackMenu } from "../services/trackMenu";
  import { type Track, leadArtist } from "../data/track";

  /** Artwork for a library track, resolved through the audio scheme. */
  const artOf = (id: string) => player.tracks.find((t) => t.id === id)?.artwork ?? "";
  const trackById = (id: string): Track | undefined => player.tracks.find((t) => t.id === id);

  const hero = $derived(
    player.current ?? player.tracks[0],
  );

  const topArtists = $derived.by(() => {
    const tally = new Map<string, { artist: string; plays: number; art: string }>();
    for (const t of player.tracks) {
      const artist = leadArtist(t.artist) || "Unknown artist";
      const plays = history.count(t.id);
      const seen = tally.get(artist);
      if (!seen) tally.set(artist, { artist, plays, art: t.artwork });
      else {
        seen.plays += plays;
        if (!seen.art) seen.art = t.artwork;
      }
    }
    return [...tally.values()]
      .filter((a) => a.art)
      .sort((a, b) => b.plays - a.plays || a.artist.localeCompare(b.artist))
      .slice(0, 8);
  });

  const mostPlayed = $derived(
    player.tracks
      .filter((t) => history.count(t.id) > 0)
      .sort((a, b) => history.count(b.id) - history.count(a.id))
      .slice(0, 6),
  );

  const lastPlayed = $derived(
    history.recent
      .slice()
      .reverse()
      .map((id) => trackById(id))
      .filter((t): t is Track => !!t)
      .slice(0, 6),
  );

  // Grouped through the shared helper so the grid, the album page and Stats all agree on what "one
  // album" is. Keying on `album||artist` here used to fragment a various-artists soundtrack into
  // one entry per track artist.
  const albums = $derived(groupAlbums(player.tracks).filter((a) => a.artwork).slice(0, 12));

  const hasAnything = $derived(player.tracks.length > 0);

  function playArtist(name: string) {
    ui.openArtist(name);
  }

  function playAlbum(key: string) {
    ui.openAlbum(key);
  }
</script>

<div class="home">
  {#if !hasAnything}
    <div class="empty card">
      <span class="empty-ico"><Icon name="library" size={26} /></span>
      <h2>Your library is empty</h2>
      <p>Point Noctra at a folder and it reads the tags and cover art out of the files themselves,
        in the background, so nothing freezes.</p>
      <button class="btn btn-primary" onclick={() => void library.pickAndScan()}>
        Choose music folder
      </button>
    </div>
  {:else}
    <!-- ---------------- hero ---------------- -->
    <section class="hero card rise">
      <img class="hero-art" src={hero.artwork} alt="" draggable="false" />
      <div class="hero-body">
        <p class="micro">Continue listening</p>
        <h2>{hero.title}</h2>
        <p class="hero-meta">{hero.artist}{#if hero.album} · {hero.album}{/if}</p>
      </div>
      <div class="hero-actions">
        <button class="btn btn-primary" onclick={() => void player.toggle()}>
          <Icon name={player.isPlaying ? "pause" : "play"} size={14} />
          {player.isPlaying ? "Pause" : "Resume"}
        </button>
        <button class="btn" onclick={() => ui.set("library")}>Browse library</button>
      </div>
    </section>

    <!-- ---------------- shuffle strip ---------------- -->
    <section class="strip rise">
      <div class="strip-row">
        <button class="btn btn-shuffle" onclick={() => player.shuffleAll()} title="Play a random track and keep shuffling">
          <Icon name="shuffle" size={15} />
          Shuffle
        </button>
        <span class="chip">{library.tracks.length} tracks</span>
        {#if favorites.count() > 0}
          <button class="chip chip-btn" onclick={() => ui.set("favorites")}>{favorites.count()} liked</button>
        {/if}
      </div>
      <div class="strip-row">
        <button class="btn" onclick={() => player.playSimilar()} title="Queue tracks like this one">
          <Icon name="sparkle" size={15} />
          Play similar
        </button>
      </div>
    </section>

    <!-- ---------------- top artists ---------------- -->
    {#if topArtists.length}
      <section class="block">
        <h3 class="section-title">Top artists</h3>
        <div class="artists stagger">
          {#each topArtists as a (a.artist)}
            <MediaCard
              round
              showPlay={false}
              art={a.art}
              title={a.artist}
              chip={a.plays > 0 ? `${a.plays} plays` : ""}
              onclick={() => playArtist(a.artist)}
            />
          {/each}
        </div>
      </section>
    {/if}

    <!-- ---------------- charts ---------------- -->
    <div class="charts">
      <section class="block rise">
        <h3 class="section-title">Most played</h3>
        {#if mostPlayed.length}
          <ol class="chart">
            {#each mostPlayed as t, i (t.id)}
              <li>
                <button
                  class="row"
                  class:active={player.current?.id === t.id}
                  onclick={() => void player.playFrom(t.id)}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    menu.show(e, trackMenu(t));
                  }}
                >
                  <span class="rank">{i + 1}</span>
                  <img class="row-thumb chart-thumb" src={t.artwork} alt="" loading="lazy" />
                  <span class="chart-text">
                    <span class="row-title">{t.title}</span>
                    <span class="row-sub">{t.artist}</span>
                  </span>
                  <span class="chip">{history.count(t.id)} plays</span>
                  <span class="dur">{formatTime(t.duration)}</span>
                </button>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="hint">Play a few tracks and your most-listened-to songs will collect here.</p>
        {/if}
      </section>

      <section class="block rise">
        <h3 class="section-title">Last played</h3>
        {#if lastPlayed.length}
          <ol class="chart">
            {#each lastPlayed as t, i (t.id)}
              <li>
                <button
                  class="row"
                  class:active={player.current?.id === t.id}
                  onclick={() => void player.playFrom(t.id)}
                  oncontextmenu={(e) => {
                    e.preventDefault();
                    menu.show(e, trackMenu(t));
                  }}
                >
                  <span class="rank">{i + 1}</span>
                  <img class="row-thumb chart-thumb" src={t.artwork} alt="" loading="lazy" />
                  <span class="chart-text">
                    <span class="row-title">{t.title}</span>
                    <span class="row-sub">{t.artist}</span>
                  </span>
                  <span class="dur">{formatTime(t.duration)}</span>
                </button>
              </li>
            {/each}
          </ol>
        {:else}
          <p class="hint">Nothing yet.</p>
        {/if}
      </section>
    </div>

    <!-- ---------------- albums ---------------- -->
    {#if albums.length}
      <section class="block rise">
        <h3 class="section-title">Albums</h3>
        <div class="albums stagger">
          {#each albums as al (al.key)}
            <MediaCard
              art={al.artwork}
              title={al.title}
              subtitle={al.artist}
              onclick={() => playAlbum(al.key)}
            />
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</div>

<style>
  .home {
    flex: 1;
    overflow-y: auto;
    padding: 26px var(--gutter) 48px;
    display: flex;
    flex-direction: column;
    gap: 30px;
  }

  /*
     The sections arrive in a cascade instead of all firing on the same frame. Six blocks appearing
     simultaneously is the single most obvious tell of an unstyled entrance; a 60ms cadence between
     them costs nothing and reads as composed. Capped at six because anything past that is below the
     fold on first paint anyway, and a longer tail would leave the bottom of the page arriving late.
  */
  .home > .rise:nth-child(2) { animation-delay: 60ms; }
  .home > .rise:nth-child(3) { animation-delay: 120ms; }
  .home > .rise:nth-child(4) { animation-delay: 180ms; }
  .home > .rise:nth-child(5) { animation-delay: 240ms; }
  .home > .rise:nth-child(6) { animation-delay: 300ms; }

  .micro {
    font-size: var(--fs-sm);
    font-weight: 700;
    letter-spacing: 0.5px;
    text-transform: uppercase;
    color: var(--text-dim);
  }

  .hint {
    font-size: var(--fs-base);
    color: var(--text-dim);
    padding: 6px 0 14px;
  }

  /* ---------------- hero ---------------- */
  .hero {
    display: flex;
    align-items: center;
    gap: 22px;
    padding: 20px;
  }

  .hero-art {
    width: 132px;
    height: 132px;
    border-radius: var(--radius-card);
    object-fit: cover;
    flex: none;
    box-shadow:
      0 14px 34px rgba(0, 0, 0, 0.44),
      inset 0 0 0 1px rgba(255, 255, 255, 0.12);
  }

  .hero-body {
    flex: 1;
    min-width: 0;
  }

  .hero-body h2 {
    margin-top: 6px;
    font-size: var(--fs-3xl);
    font-weight: 800;
    letter-spacing: -0.8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hero-meta {
    margin-top: 5px;
    font-size: var(--fs-base);
    font-weight: 600;
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .hero-actions {
    display: flex;
    flex-direction: column;
    gap: 9px;
    flex: none;
  }

  .hero-actions .btn {
    min-width: 148px;
  }

  /* ---------------- shuffle strip ---------------- */
  .strip {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 10px;
  }

  .strip-row {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .btn-shuffle {
    background-color: var(--accent);
    border-color: rgba(255, 255, 255, 0.4);
    color: var(--on-accent);
  }

  .btn-shuffle:hover:not(:disabled) {
    background-color: var(--accent);
    border-color: rgba(255, 255, 255, 0.75);
  }

  .chip-btn {
    cursor: pointer;
    transition: background-color var(--tap) var(--ease-out);
  }

  .chip-btn:hover {
    background: rgba(255, 255, 255, 0.16);
  }

  /* ---------------- blocks ---------------- */
  .block {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .charts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
    gap: 28px;
    align-items: start;
  }

  .chart {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .chart-thumb {
    width: 38px;
    height: 38px;
    border-radius: var(--radius-sm);
  }

  .chart-text {
    display: flex;
    flex-direction: column;
    min-width: 0;
    flex: 1;
  }

  .dur {
    flex: none;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-faint);
    font-variant-numeric: tabular-nums;
    min-width: 36px;
    text-align: right;
  }

  /* ---------------- artists ---------------- */
  .artists {
    display: flex;
    gap: 18px;
    flex-wrap: wrap;
  }

  /* ---------------- albums ---------------- */
  .albums {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 18px;
  }

  /* ---------------- empty ---------------- */
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    text-align: center;
    padding: 56px 40px;
    max-width: 460px;
    margin: auto;
  }

  .empty h2 {
    font-size: 20px;
    font-weight: 800;
  }

  .empty p {
    font-size: var(--fs-base);
    line-height: 1.55;
    color: var(--text-dim);
    max-width: 38ch;
  }

  .empty-ico {
    display: grid;
    place-items: center;
    width: 62px;
    height: 62px;
    border-radius: 50%;
    color: var(--text-faint);
    background: rgba(255, 255, 255, 0.07);
    border: 1px solid rgba(255, 255, 255, 0.12);
    margin-bottom: 4px;
  }
</style>
