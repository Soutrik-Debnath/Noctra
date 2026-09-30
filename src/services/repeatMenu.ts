/**
 * The repeat picker, built on the shared context menu like the sleep timer.
 *
 * Left-click on the repeat button keeps cycling off → all → one, which is what the R key does and
 * what a tap should do. "Play each track N times" needs a number, so it lives on the right-click
 * menu instead of being crammed into a three-state cycle.
 */
import { menu, type MenuItem } from "../stores/menu.svelte";
import { dialog } from "../stores/dialog.svelte";
import { player } from "../stores/player.svelte";

const COUNTS = [2, 3, 5, 10];

export function openRepeatMenu(event: MouseEvent): void {
  event.preventDefault();
  const items: MenuItem[] = [
    {
      label: "Don't repeat",
      icon: "close",
      onSelect: () => {
        player.repeat = "off";
      },
    },
    {
      label: "Repeat the queue",
      icon: "repeat",
      onSelect: () => {
        player.repeat = "all";
      },
    },
    {
      label: "Repeat this track",
      icon: "repeat-one",
      onSelect: () => {
        player.repeat = "one";
      },
    },
    { separator: true },
    ...COUNTS.map(
      (n): MenuItem => ({
        label: `Play each track ${n} times`,
        icon: "repeat",
        onSelect: () => player.setRepeatTimes(n),
      }),
    ),
    {
      label: "Custom count…",
      icon: "clock",
      onSelect: async () => {
        const raw = await dialog.ask("Play each track how many times?", {
          inputLabel: "Times",
          value: "3",
          numeric: true,
          confirmText: "Set",
        });
        if (raw === null) return;
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n >= 2 && n <= 20) player.setRepeatTimes(n);
      },
    },
  ];

  menu.show(event, items);
}
