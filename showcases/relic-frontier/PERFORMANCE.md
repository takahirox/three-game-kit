# Relic Frontier performance certification

Certification environment: headless Chromium supplied by Playwright 1.62.1, 1280×720 viewport, device pixel ratio 1, macOS runner, 2026-09-01. Values come from the public `inspectRenderer()` AI/QA handle after a clean test-mode boot.

| Metric | Budget | Certified clean-boot measurement | Enforcement |
| --- | ---: | ---: | --- |
| Authored initial asset download | ≤ 8 MiB | 0 bytes | asset intake gate |
| Peak visible scene triangles | ≤ 25,000 | 2,936 | browser acceptance telemetry |
| Draw calls | ≤ 80 | 53 | browser acceptance telemetry |
| Scene objects / meshes / lights | informational | 124 / 52 / 3 | browser acceptance telemetry |
| Authored texture memory | ≤ 32 MiB | 0 bytes | asset provenance + telemetry |
| WebGL texture handles | ≤ 16 | 1 internal handle | browser acceptance telemetry |
| Active SkinnedMesh | ≤ 8 | 0 | browser acceptance telemetry |
| Simultaneously registered enemies | ≤ 12 | 4 | deterministic snapshot |
| Fixed simulation work | 60 Hz, no dropped exact QA steps | 60 Hz | public Runtime exact driver |
| Certification frame time | ≤ 16.7 ms median target | captured by browser/runner; no stable cross-run absolute asserted | manual profiling before asset lock |

The geometry-first art direction intentionally stays far below the triangle and texture budgets. Shared geometries and materials reduce memory; static environment pieces are candidates for instancing or merging if future art pushes draw calls above 80. The test asserts measurable ceilings rather than relying on asset labels. Normal mode caps pixel ratio at 2 and wall-clock input at 100 ms per frame; test mode fixes pixel ratio to 1.

Before any future asset lock, profile an actual representative gameplay encounter in Chrome Performance/WebGL tooling and record median/p95 frame time and target integrated/mobile GPU. A change that exceeds a budget must either optimize the scene or update this document with evidence and rationale.
