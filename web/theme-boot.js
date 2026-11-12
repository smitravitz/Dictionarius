// Before the page's first frame: dark, or light if that was picked in Settings, so the page
// never shows anything else first. A plain script in the page's <head> (tools/theme-script.ts
// puts it there), so it runs before anything is drawn; the page's modules run only later.
// web/theme.ts does the same when the switch is turned, and keeps the pick (under the key
// below; see web/theme-choice.ts, whose default this is).
(function () {
  var theme = "dark";
  try {
    if (localStorage.getItem("dictionarius.theme") === "light") theme = "light";
  } catch (e) {
    // no storage: the default
  }
  document.documentElement.dataset.theme = theme;
  // The browser's bars: the theme's colour, whatever the system asks for.
  var bars = document.querySelectorAll('meta[name="theme-color"]');
  var colour = null;
  for (var i = 0; i < bars.length; i++) {
    bars[i].dataset.own = bars[i].content;
    if (bars[i].media.indexOf(theme) !== -1) colour = bars[i].content;
  }
  if (colour) for (var j = 0; j < bars.length; j++) bars[j].content = colour;
})();
