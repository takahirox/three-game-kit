# Known limitations

This is the comprehensive limitation index for the bounded MVP. It summarizes the
implemented release-candidate boundary; it is not a roadmap and does not claim
support for omitted capabilities. Normative details remain in the linked contracts.

## Environment and browser

- Node.js 24.x, TypeScript 6.0, `pnpm@11.24.0`, Ubuntu 24.04 x64, and the pinned
  Playwright-bundled Chromium are the only required verification baseline.
- Firefox, WebKit, system browsers, other operating systems, architectures, Node
  majors, and package-manager versions are not certified.
- Browser code depends on browser APIs; headless Node support does not make client
  packages browser-independent. See [supported environments](./supported-environments.md).

## Physics, avatar, assets, and animation

- Collision is a bounded static-world slice: a floor and static boxes with one
  capsule-like kinematic avatar controller. It is not a general physics system.
- Dynamic rigid bodies, forces, joints, destructible geometry, broad collision
  filtering, and cross-platform bit-identical physics are outside the MVP.
- Rendering and asset loading cover the local scene and one URL-loaded glTF avatar
  with at most one animation clip. There is no generalized scene, asset cache/CDN,
  streaming, retry, animation graph, blending, retargeting, or character system.

## WebSocket, protocol, trust, and connection lifecycle

- Networking uses one WebSocket transport and strict JSON Protocol v1 with bounded
  messages, queues, sequences, tick windows, snapshots, and rejection reasons.
  Alternate transports and protocol negotiation are absent.
- Network input is untrusted. The server derives identity and ownership from live
  connection bindings; client-provided identity never grants authority.
- Production authentication, authorization integration, encryption beyond the
  deployment's transport setup, matchmaking, persistence, cryptographic anti-replay,
  anti-DDoS, and comprehensive anti-cheat are not provided.
- Reconnect and resume are unsupported.
- Deterministic lockstep is unsupported.
- Reconnect, resume, session migration, and delivery guarantees under packet loss
  are unsupported. Disconnect fences authority and cleans up the session; callers
  must establish a new session. See the [MVP protocol](./protocol/mvp.md).

## Authority and network presentation

- The server is authoritative for multiplayer state. Client movement prediction is
  local presentation of pending input, not authority.
- Reconciliation corrects the owning avatar from authoritative snapshots. It is not
  rollback netcode, lag compensation, or a general state-merging facility.
- Remote interpolation buffers authoritative snapshots for presentation. It does
  not predict peers, promise smoothness during loss, or change simulation state.
- The deterministic delay, jitter, and drop injector is test support, not a network
  quality or production-loss guarantee. See
  [two-client acceptance](./testing/two-client-acceptance.md).

## Scheduling and composition

- Simulation uses fixed-rate ticks, fixed named phases, serial synchronous systems,
  stable priority/declaration ordering, exact stepping, and bounded wall-clock
  catch-up. There are no jobs, arbitrary ordering edges, cross-phase overrides, or
  asynchronous tick systems.
- Feature composition is complete and immutable at runtime construction. There is
  no discovery loader, optional-provider solver, hot enable/disable, replacement,
  restart after stop, or dynamic schedule mutation. See
  [runtime scheduling](./architecture/runtime-scheduling.md) and
  [Feature lifecycle](./architecture/feature-lifecycle.md).

## Interaction

- The only optional cross-runtime proof is the consumer-owned Interaction example:
  one configured target, finite inclusive range validation, and one boolean toggle.
- It does not provide line-of-sight or physics-occlusion checks, multiple-target
  policy, inventory, combat, damage, abilities, dialogue, navigation, vehicles, or
  arbitrary actions. Removing it leaves the base movement slice intact. See the
  [Interaction contract](./features/interaction.md).

## Telemetry and performance

- Telemetry is bounded in-memory inspection: structured errors, counters, gauges,
  latest timing/backlog values, lifecycle state, and bounded rejection evidence.
- There is no exporter, dashboard, tracing system, persistent store, histogram,
  percentile service, alerting, profiling suite, or production service-level claim.
- The MVP has no general performance, scale, concurrency, capacity, latency, or
  memory guarantee beyond its objective tests and bounded queues. Telemetry observes
  outcomes; it never grants authority. See
  [errors and telemetry](./architecture/errors-and-telemetry.md).

## Packaging, publication, and license

- The five packages expose explicit roots and selected exported subpaths at one
  pre-1.0 compatibility line. Internal source paths and undeclared deep imports are
  unsupported. See the [package map](./architecture/package-map.md).
- Packed tarballs are tested in an external fixture, but the packages are
  `UNLICENSED` and are not published to a package registry. A packed-consumer test
  is evidence of the public boundary, not permission or a registry availability
  claim.

## Deployment and operations

- The repository provides development, test, browser-demo, and headless-server
  evidence, not a production deployment platform.
- Hosting, TLS termination, proxies, origins, secrets, configuration distribution,
  process supervision, scaling, load balancing, health checks, rolling upgrades,
  backups, disaster recovery, monitoring, and incident response remain consumer
  responsibilities.

## Explicitly deferred presentation capabilities

XR, audio, and postprocessing are explicitly deferred. The MVP provides no WebXR
device/session behavior, spatial or non-spatial audio system, or render
postprocessing pipeline, and successful experimentation with those capabilities
does not create a support commitment.
