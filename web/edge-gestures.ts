/**
 * The position slider's ends sit at the screen's edges, and a thumb holding
 * near an edge to reach them can set off the phone's own edge swipe (Android's
 * Back gesture): the phone takes the touch away mid-slide and the slider
 * closes. (Stock Android drops a back swipe that starts with a hold, but
 * some phones' own gesture handling doesn't.) A web page can't refuse that,
 * so in the Android app a tiny native plugin (EdgeGesturesPlugin, in
 * android/app) turns the edge gesture off in a strip down each side of the
 * results, centred on their lower half, where the thumb holds. Android
 * honours at most 200 dp of such strips per edge; Back still works from the
 * rest of each edge, and everywhere on a word's page.
 */
import { Capacitor, registerPlugin } from "@capacitor/core";

const STRIP = 48; // CSS px in from each edge: wider than Android's widest edge-gesture setting
const MAX_HEIGHT = 200; // Android's limit, in dp (a CSS px is a dp in the app's WebView)

export interface Strip {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The strips for a results list spanning `list` (top and bottom, in CSS px) on a
 *  screen `width` wide: centred on the list's lower half, inside the list. */
export function edgeStrips(list: { top: number; bottom: number } | null, width: number): Strip[] {
  if (!list || list.bottom <= list.top) return [];
  const height = Math.min(MAX_HEIGHT, list.bottom - list.top);
  const centre = list.top + (list.bottom - list.top) * 0.75;
  const y = Math.max(list.top, Math.min(list.bottom - height, centre - height / 2));
  return [
    { x: 0, y, width: STRIP, height },
    { x: width - STRIP, y, width: STRIP, height },
  ];
}

interface EdgeGestures {
  /** Turn the phone's edge gestures off in these strips (CSS px), and on everywhere else. */
  exclude(options: { strips: Strip[] }): Promise<void>;
}

/** In the Android app, keep the strips beside the results (`frame`) while they show. */
export function guardEdges(frame: HTMLElement) {
  if (Capacitor.getPlatform() !== "android") return;
  const plugin = registerPlugin<EdgeGestures>("EdgeGestures");
  let last = "";
  const update = () => {
    const box = frame.hidden ? null : frame.getBoundingClientRect();
    const strips = edgeStrips(box, document.documentElement.clientWidth);
    const key = JSON.stringify(strips);
    if (key === last) return;
    last = key;
    void plugin.exclude({ strips }).catch(() => {});
  };
  new ResizeObserver(update).observe(frame);
  new MutationObserver(update).observe(frame, { attributes: true, attributeFilter: ["hidden"] });
  update();
}
