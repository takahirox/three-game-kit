/** Capture recipes use only the demos' public deterministic QA handles. */
export const galleryCovers = [
  {
    id: "metaverse", path: "showcases/metaverse/index.html", handle: "__METAVERSE__",
    query: "test=1", canvas: "#world",
    prepare(game) {
      game.start();
      game.setMove(0, -1);
      game.advance(2.5);
      game.setMove(0, 0);
      game.press("interact");
      game.setLook(-0.35);
      game.advance(0.2);
    },
  },
  {
    id: "craftlands", path: "showcases/craftlands/index.html", handle: "__CRAFTLANDS__",
    query: "test=1&seed=8675309&distance=5", canvas: "#game-canvas",
    prepare(game) {
      game.start();
      game.setTimeOfDay(0.3);
      game.setLook(-0.65, -0.08);
      game.advance(1);
    },
  },
  {
    id: "relic-frontier", path: "showcases/relic-frontier/index.html", handle: "__RELIC_FRONTIER__",
    query: "test=1", canvas: "#game-canvas",
    prepare(game) {
      game.loadScenario("guardian");
      game.dismissOnboarding();
      game.advance(0.25);
    },
  },
  {
    id: "afterglow", path: "showcases/afterglow/index.html", handle: "__AFTERGLOW__",
    query: "test=1", canvas: "#game-canvas",
    prepare(game) {
      game.loadScenario("start");
      game.setInput({ throttle: true, boost: true });
      game.advance(1.2);
    },
  },
  {
    id: "gravetide", path: "showcases/gravetide/index.html", handle: "__GRAVETIDE__",
    query: "test=1&seed=4242", canvas: "#game-canvas",
    prepare(game) {
      game.loadScenario("swarm");
      game.advance(0.2);
    },
  },
  {
    id: "deepfield", path: "showcases/deepfield/index.html", handle: "__DEEPFIELD__",
    query: "test=1&seed=1337", canvas: "#game-canvas",
    prepare(game) {
      game.start();
      game.setTimeOfDay(0.3);
      game.setLook(-0.4, -0.12);
      game.advance(0.5);
    },
  },
  {
    id: "chroma-strike", path: "showcases/relic-frontier/chroma-strike/index.html", handle: "__CHROMA_STRIKE__",
    query: "test=1", canvas: "#strike-canvas",
    prepare(game) {
      game.start();
      game.advance(2);
    },
  },
  {
    id: "particle-atlas", path: "examples/particles/index.html", handle: "__particles",
    query: "test=1", canvas: "#renderer",
    prepare(game) {
      game.select("singularity");
      // Give the selected effect the entire canvas; remove gallery chrome only for capture.
      Object.assign(document.querySelector("#focus-preview").style, {
        position: "fixed", inset: "0", width: "1280px", height: "720px",
      });
      // The renderer clips to the transport's top edge. Move it outside the capture area.
      Object.assign(document.querySelector(".transport").style, { top: "720px", bottom: "auto" });
      for (let frame = 0; frame <= 90; frame += 1) game.present(frame * 32);
    },
  },
  {
    id: "core-run", path: "showcases/core-run/index.html", handle: "__CORE_RUN__",
    query: "test=1", canvas: "#game-canvas",
    prepare(game) {
      game.start();
      game.advance(3.5);
    },
  },
];
