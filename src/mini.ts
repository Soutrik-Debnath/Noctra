import { mount } from "svelte";
import "./app.css";
// Not optional: `Slider.svelte` has no style block of its own — its track, fill, thumb and the
// whole `.slider-v` vertical layout live in the shared controls.css. Without this import the mini
// window's volume control silently degrades to a bare native range input, which is what produced
// the horizontal blue bar instead of the glass pill.
import "./controls.css";
import MiniApp from "./MiniApp.svelte";

mount(MiniApp, {
  target: document.getElementById("app")!,
});
