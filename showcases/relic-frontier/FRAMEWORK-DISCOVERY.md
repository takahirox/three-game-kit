# Relic Frontier framework discovery log

This document records what building the animated melee slice ([Issue #29](https://github.com/takahirox/three-game-kit/issues/29)) revealed about `three-game-kit`, following the working rule: implement the behaviour in the showcase first, use it in the real gameplay path, and promote it only when the responsibility proved reusable and not game-specific.

## Promoted into public APIs

| Capability | Friction discovered in the showcase | Promotion | Showcase migration |
| --- | --- | --- | --- |
| Animation clip events | Swing trails, footstep dust, and cast bursts needed to fire at a clip time, not a simulation tick. Without notifies the renderer had to poll `activeClipSeconds` every frame and dedupe by hand. | `createThreeAnimationRuntime({ events })` + `onEvent`; deterministic, loop-aware, fired from `update`. Inspection reports `emittedEventCount` and `registeredEventIds`. | `renderer.ts` registers nine clip events per character and drives presentation-only VFX from them. |
| Clip-time inspection | QA could not prove that the animation matched the tick-authoritative hit window. | `activeClipSeconds`, `activeClipDuration`, `activePlaybackRate` on `inspect()`. | The acceptance test asserts clip progress at the tick before the heavy attack's active window. |
| Playback-rate control | Attack clips must fit an attack's tick budget exactly. | `playbackRate` already existed for `play`/`playOneShot`; `setPlaybackRate` now retunes an active action. | `syncCharacter` stretches every one-shot to `clipDuration / (durationTicks · dt)`. |
| One-shot cancel windows | Dodge cancels attack recovery; respawn cancels a death-in-progress; both need the mixer to leave a one-shot immediately. | `cancelOneShot()` returns to the state clip and counts as an interruption. | Animation cues carry a `sequence`; a bump with `oneShot: null` cancels. |
| One-shot completion reliability | Replacing a one-shot mid-flight used to count the superseded clip as "completed" once its cross-fade finished. | `finished` only counts the active action; superseded or cancelled one-shots increment `interruptedOneShotCount`. | Tests assert completed vs interrupted counts. |
| Per-state play options | A death clip registered as a looping state looped. | `states` accept `{ clip, loop, clampWhenFinished, crossFadeSeconds, playbackRate }`. | `dead: { clip: "death", loop: false, clampWhenFinished: true }`. |
| Multiple characters arriving after boot | The Animation Feature bound one runtime at install time; the rig loads asynchronously and is cloned for six characters. Fixed Feature IDs also forbade installing it six times. | `createAnimationCharacterSet()` owns any number of runtimes added or removed after boot; `createAnimationFeature({ id?, characters })` advances them all on the fixed presentation tick and disposes them on shutdown. | One `animation` Feature; the renderer adds a runtime per clone once the glTF arrives. |
| Hit Query / Damage Volume | Player arcs, Husk arcs, the Guardian's sweep arc, its slam sphere, and Pulse projectiles all re-implemented "who is inside this shape, in a stable order, at most N" in slightly different ways. | `createHitQueryRuntime` in `@three-game-kit/shared/genre`: arc, sphere, and capsule volumes, candidate radii, vertical tolerance, exclusions, `maxTargets`, and distance-then-id ordering. | Every melee and area attack in `game.ts` is one `hitQuery.query` call driven by a data table. |
| Lock-on / targeting | Acquire nearest, cycle deterministically, release when the target dies or leaves range, expose it to camera/HUD/rules without letting presentation grant it. | `createLockOnRuntime` in `@three-game-kit/shared/genre` with `acquire`, `cycle`, `release`, and `step` (validity + hysteresis) plus inspection. | The rules Feature toggles the runtime from the `lock-on` action, faces the player toward the target, and mirrors `targetId` into the snapshot; the reticle and HUD read the snapshot only. |
| Checkpoint / respawn | Activation ordering, "already active", delayed respawn scheduling, and cancellation on QA reload had to be tracked by hand. | `createCheckpointRuntime` in `@three-game-kit/shared/gameplay`: checkpoint registry, `activate`, `requestRespawn`/`cancelRespawn`, ticked `step`, explicit outcomes, and inspection. Restore policy stays caller-owned. | Trigger Areas activate beacons; the rules Feature restores player, enemies, and phase on `respawned`. |
| Simple AI repositioning | Knockback and encounter resets moved an enemy while its AI agent kept the stale position. | `SimpleAiRuntime.setPosition(agentId, position)`. | Used by knockback, respawn resets, and QA scenarios. |

## Kept game-local (deliberately)

| Behaviour | Why it stayed in `game.ts` |
| --- | --- |
| Attack tables (startup/active/recovery, damage, volumes, knockback, stagger, clip) | Pure tuning data; the reusable part is the query and the timing pattern, both of which fit in a few lines. |
| Player combat state machine (idle/attack/dodge/hit/stagger/dead, combo queue, cancel window, super armour) | Rules such as "light 2 queues after light 1's startup" and "heavy is unstoppable while active" are this game's feel, not a framework contract. |
| Enemy behaviours (Husk approach/hold, Warden keep-range/retreat, Guardian alternation, poise) | Three small hand-written state machines were clearer than forcing them through a generic behaviour system; the public Simple AI runtime still owns steering and waypoint motion. |
| Respawn policy (living enemies reset, progress kept, stale projectiles ignored) | Policies differ per game; the runtime only schedules and announces. |
| Animation cue → one-shot mapping (`state`, `oneShot`, `sequence`, `durationTicks`) | A tiny snapshot contract between rules and presentation; a general animation graph was not needed. |
| Telegraph sectors, reticle, checkpoint beacons | Presentation. |

## Observations for future work

- Hit stop was not added: hit reactions, knockback, trails, and audio already made hits read clearly; the acceptance test would need a wall-clock notion to verify it.
- A `Lock-On` or `Checkpoint` scheduled Feature wrapper was not added because the game-specific rules Feature already steps the runtimes in the right order; a second consumer would justify a wrapper and catalog entry.
- Character-versus-character collision is absent (the Rapier adapter models the avatar against static boxes only); rolls pass through enemies, which the design leans into.
- The character controller reports the capsule centre (y ≈ 0.9). Rules project to the ground plane for volumes and steering, and the renderer offsets the rig; a documented "feet position" accessor would remove this seam.
- Six `SkinnedMesh` instances allocate six bone textures (`renderer.info.memory.textures` reports 7 with the VFX atlas); this is expected and inside the budget.
