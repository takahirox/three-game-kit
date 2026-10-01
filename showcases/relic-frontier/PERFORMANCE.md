# Relic Frontier performance certification

Certification environment: headless Chromium supplied by Playwright 1.62.1, 1280×720 viewport, device pixel ratio 1, macOS runner, 2026-09-11. Values come from the public `inspectRenderer()` AI/QA handle after the animated rig has attached in test mode; the "encounter" column was captured at the end of the deterministic Guardian fight.

| Metric | Budget | Clean boot (rig attached) | Guardian encounter | Enforcement |
| --- | ---: | ---: | ---: | --- |
| Authored initial asset download | ≤ 8 MiB | 150876 bytes (one GLB) | same | asset intake gate |
| Peak visible scene triangles | ≤ 25,000 | 4,978 | 4,978 | browser acceptance telemetry |
| Draw calls | ≤ 80 | ≤ 80 asserted | 47 | browser acceptance telemetry |
| Scene objects / meshes / lights | informational | 300 / 110 / 4 | same | browser acceptance telemetry |
| Authored texture memory | ≤ 32 MiB | 0 bytes | 0 bytes | asset provenance + telemetry |
| WebGL texture handles | ≤ 16 | 1 before the rig, 7 after (six skeleton bone textures + one VFX atlas) | 7 | browser acceptance telemetry |
| Active SkinnedMesh | ≤ 8 | 6 | 6 | browser acceptance telemetry |
| Simultaneously registered enemies | ≤ 12 | 5 | 5 | deterministic snapshot |
| Fixed simulation work | 60 Hz, no dropped exact QA steps | 60 Hz | 60 Hz | public Runtime exact driver |
| Certification frame time | ≤ 16.7 ms median target | captured by browser/runner; no stable cross-run absolute asserted | — | manual profiling before asset lock |

The rig adds 264 triangles per character (1,584 for six) over the previous procedural silhouettes and no texture memory; every skinned clone shares one geometry, and only tinted enemies clone the single material. Telegraph sectors reuse cached ring geometries keyed by angle, the lock-on reticle is two small meshes, and checkpoint beacons are four shared geometries. Animation runs on the fixed simulation tick (`presentation-publish`), so six mixers cost six `AnimationMixer.update` calls per tick. VFX bursts and trails are pooled by the public VFX runtime with explicit capacities (128 commands, 24 bursts, 24 trails, 12 popups).

Normal mode caps pixel ratio at 2 and wall-clock input at 100 ms per frame; test mode fixes pixel ratio to 1. Before any future asset lock, profile an actual representative gameplay encounter in Chrome Performance/WebGL tooling and record median/p95 frame time and target integrated/mobile GPU. A change that exceeds a budget must either optimize the scene or update this document with evidence and rationale.
