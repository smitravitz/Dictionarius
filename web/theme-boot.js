// Before the page's first frame: the light or dark picked in Settings, if any, so the page
// never shows the system's theme first and then turns. A plain script in the page's <head>
// (tools/theme-script.ts puts it there), so it runs before anything is drawn; the page's
// modules run only later. web/theme.ts does the same when the switch is turned, and keeps the
// pick (under the key below; see web/theme-choice.ts).
(function () {
  var theme = null;
  try {
    theme = localStorage.getItem("dictionarius.theme");
  } catch (e) {
    return; // no storage: the system's theme
  }
  if (theme !== "light" && theme !== "dark") return;
  document.documentElement.dataset.theme = theme;
  // The browser's bars: the picked theme's colour, whatever the system asks for.
  var bars = document.querySelectorAll('meta[name="theme-color"]');
  var colour = null;
  for (var i = 0; i < bars.length; i++) {
    bars[i].dataset.own = bars[i].content;
    if (bars[i].media.indexOf(theme) !== -1) colour = bars[i].content;
  }
  if (colour) for (var j = 0; j < bars.length; j++) bars[j].content = colour;
})();
