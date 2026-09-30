/**
 * The sleep-timer picker, built on the shared context menu.
 *
 * A bespoke popover would need its own positioning, focus trap and outside-click handling to do
 * exactly what `menu` already does, so the timer opens as a menu instead.
 */
import { menu, type MenuItem } from "../stores/menu.svelte";
import { dialog } from "../stores/dialog.svelte";
import { PRESET_MINUTES, sleep } from "../stores/sleep.svelte";
import { player } from "../stores/player.svelte";

export function openSleepMenu(event: MouseEvent): void {
  event.preventDefault();
  const items: MenuItem[] = PRESET_MINUTES.map((m) => ({
    label: `${m} minutes`,
    icon: "clock",
    onSelect: () => sleep.setMinutes(m),
  }));

  items.push(
    {
      label: "Custom minutes…",
      icon: "clock",
      onSelect: async () => {
        const raw = await dialog.ask("Stop playback after how many minutes?", {
          inputLabel: "Minutes",
          value: "90",
          numeric: true,
          confirmText: "Set",
        });
        if (raw === null) return;
        const n = Number.parseInt(raw, 10);
        if (Number.isFinite(n) && n > 0 && n <= 600) sleep.setMinutes(n);
      },
    },
    { separator: true },
    {
      label: sleep.stopAfterCurrent ? "Cancel stop after this song" : "Stop after this song",
      icon: "check",
      onSelect: () => sleep.setStopAfterCurrent(!sleep.stopAfterCurrent),
    },
  );

  if (sleep.active) {
    items.push({ label: "Turn timer off", icon: "close", danger: true, onSelect: () => sleep.clear() });
  }

  menu.show(event, items);
}

/** Wire the countdown and the expiry action. Called once from App. */
export function startSleepTimer(): () => void {
  sleep.onExpire = () => player.pause();
  const id = setInterval(() => sleep.tick(), 1000);
  return () => {
    clearInterval(id);
    sleep.onExpire = null;
  };
}
