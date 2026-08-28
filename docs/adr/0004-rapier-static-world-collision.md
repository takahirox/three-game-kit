# ADR 0004: Rapier static-world collision

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Milestone 0 must select one collision implementation for both sides of the bounded movement slice.
Milestone 2 needs one Client capsule-like character to predict movement over a static floor and stop
at static obstacles. Milestone 3 needs the headless Server to resolve the same bounded collision
shape and static-scene configuration before it writes authoritative positions and snapshots. Shared
Simulation must remain authority-neutral and Rapier-free, and Server must remain headless and
independent of Client.

Rapier JavaScript supplies a kinematic character controller, capsule colliders, static collider
queries, and explicit removal of controllers and colliders. Its WebAssembly-backed implementation
adds initialization and disposal obligations to each runtime adapter. Separate Client and Server
executions may diverge, so its collision results cannot become a cross-runtime determinism contract
or a Client-provided source of authority.

## Decision

### Selected implementation and bounded scope

The MVP selects Rapier JavaScript through the @dimforge/rapier3d package. Exact patch resolution
belongs in the future lockfile. Client and Server may each depend directly on Rapier, but only in
their own private collision adapter modules. Client never exports its adapter implementation to
Server, and Server never imports @three-game-kit/client or any Client source, subpath, declaration,
or generated artifact.

For headless Node, Server uses the official @dimforge/rapier3d-compat distribution of the same Rapier
0.20 API because the bundler distribution lacks Node ESM exports. This packaging choice does not
change authority or any public type; Client remains on @dimforge/rapier3d.

Each Client Runtime instance owns a private Rapier World used only for local prediction. Each Server
Runtime instance owns a different private Rapier World used only for authoritative headless
collision. A Rapier World, controller, collider, handle, vector, shape, query result, or WebAssembly
object is never shared between runtimes.

One world unit equals exactly one meter. Positions are meters, desired and effective translations
are meters per fixed tick, speeds are meters per second, and controller offset is meters. The world
uses positive Y as up.

The collision scene contains only:

- character capsules with configurable positive finite radius and half-height;
- standalone, axis-aligned static cuboid colliders for the floor and obstacles; and
- a Rapier kinematic character controller configured with a 0.01 meter offset, sliding enabled,
  autostep disabled, and snap-to-ground disabled.

Every private Rapier World has zero gravity because this decision introduces no rigid-body
simulation. Shared movement rules, not Rapier forces, supply any downward desired translation needed
for floor contact. Static colliders have no rotation field. Dynamic bodies, moving geometry, and
Client-authored scene configuration are outside this decision.

### Kit-owned Shared data and computation

Shared Simulation defines and produces the immutable, kit-owned movement and static-scene records
consumed by both adapters. Its pure configuration and movement functions:

1. validate and copy a capsule configuration and an ordered list of static-box descriptors;
2. produce the same ordered static-scene descriptor values for Client and Server runtime
   composition; and
3. compute one finite desired translation from semantic movement axes, configured speed, fixed tick
   duration, and the bounded downward movement rule.

A static box descriptor contains only a kit-owned ID, center vector, and positive half-extents
vector. The complete static-scene descriptor contains the capsule dimensions, controller offset,
and ordered static boxes. It is configuration data, not a live collision object. Server composition
uses its trusted configured copy; no scene descriptor received from a Client can configure or
mutate the authoritative scene.

The relevant public records are equivalent to these kit-owned shapes:

| Record | Fields |
| --- | --- |
| MovementVector | finite readonly x, y, and z numbers |
| StaticBoxDescriptor | readonly kit-owned ID, center MovementVector, and positive halfExtents MovementVector |
| StaticSceneDescriptor | readonly capsule radius and half-height, controller offset, and ordered readonly static boxes |
| CollisionMoveResult | readonly startPosition, desiredTranslation, effectiveTranslation, position, grounded, collided, and collisionCount |

collisionCount is a non-negative integer for one computation and conveys no collider identity. All
numeric result fields are copied finite snapshots, never views into WebAssembly memory. Core,
Shared, Protocol, wire data, public exports, public callback parameters, ECS component/resource
types, and all emitted declarations contain only kit-owned data. None may name or structurally expose
a Rapier module, World, controller, collider, handle, vector, shape, collision record, or
WebAssembly type.

Shared does not create, step, query, or dispose a Rapier object. It computes desired movement and
static-scene descriptors only; collision is applied privately by the runtime that owns the state
being predicted or authorized.

### Client prediction tick

On each Client simulation tick, after reconciliation and semantic action sampling, Shared computes
the desired translation. The Client collision adapter then:

1. synchronizes its private capsule from the current kit-owned predicted position, including any
   preceding authoritative correction;
2. copies the desired translation into private Rapier values;
3. asks its private character controller to compute movement against its private static colliders;
4. copies effective translation and bounded collision facts into kit-owned result data;
5. moves its private capsule by the effective translation; and
6. writes the copied predicted position to kit-owned Client movement state for presentation.

No collision computation occurs in a presentation frame. A presentation frame may read or
interpolate the latest kit-owned state only. The Client sends semantic movement intent, never
position, effective translation, grounded state, collision count, collider identity, or a Rapier
result.

### Server authority tick

For every scheduled movement command, the Server performs the following order before any
authoritative movement mutation:

1. confirm that the emitting connection is live and joined and resolve its server-owned
   connection/player/entity binding;
2. validate the exact next sequence and accepted intended-tick window;
3. validate that both semantic movement axes are finite, within their component bounds, and within
   the unit-disc magnitude bound;
4. validate that configured speed is positive, finite, and no greater than the Protocol movement
   ceiling, and that the resulting per-tick desired-translation magnitude is within that speed
   bound;
5. call the Rapier-free Shared movement function to compute desired translation;
6. synchronize the entity's private Server capsule from its current authoritative kit-owned
   position;
7. apply the Server adapter's own private Rapier collision against the Server's trusted copy of the
   static-scene configuration;
8. copy the effective result back into authoritative kit-owned position state; and
9. build later replication snapshots from that authoritative position.

A failure in steps 1 through 4 is counted under the selected Protocol rejection reason and performs
none of steps 5 through 9. The Server does not accept a Client position or collision result at any
step. Even if a Client predicts passage through an obstacle, forges local grounded or collision
facts, or constructs extra outcome fields, only semantic axes admitted by the strict Protocol
boundary can reach this pipeline. Authoritative position is the result of Shared desired movement
followed by the Server's private Rapier collision.

The owning Client predicts with its separate World, then reconciles to Server snapshots. The two
Rapier executions use the same kit-owned scene values but do not share state or promise identical
floating-point, query, contact, or effective-translation results. Snapshots and reconciliation are
the required mechanism for handling divergence.

### Client adapter setup, rollback, and disposal

Each installed Client collision adapter instance solely owns one private zero-gravity Rapier World,
one controller, one character capsule collider, and all static colliders created from its copied
configuration. It borrows kit-owned Client movement state and does not own or dispose the Client ECS
World.

Client setup is deterministic:

1. await Rapier module initialization;
2. create the private World;
3. create static colliders in descriptor order;
4. create the character capsule collider;
5. create the character controller;
6. publish the kit-owned Client collision resource/API; and
7. register the Client fixed-tick collision system.

Client disposal first prevents new work, then performs this exact order:

1. unregister the Client fixed-tick collision system;
2. remove and invalidate the published kit-owned Client resource/API;
3. remove the character controller;
4. remove the character capsule collider;
5. remove static colliders in reverse descriptor order;
6. free the private World; and
7. clear every private reference and copied configuration reference.

Partial Client setup rollback performs the applicable subset of the disposal order for objects that
were created. It publishes no resource and registers no system if setup does not reach those steps.
Disposal is idempotent. Calls after invalidation return the kit's structured disposed-resource
failure without touching a stale handle.

### Server adapter setup, avatar ownership, rollback, and disposal

Each installed Server collision adapter instance solely owns one private zero-gravity Rapier World,
one controller, all static colliders created from its trusted copied configuration, and one private
capsule collider for every live authoritative avatar. Private collider lookup is keyed internally by
kit-owned EntityId; no Rapier handle becomes an ECS component, public identifier, or wire identity.
The adapter borrows authoritative movement state and does not own or dispose the Server ECS World.

Server setup is independently deterministic:

1. await Rapier module initialization in the headless Node process;
2. create the private World;
3. create static colliders in descriptor order;
4. create the character controller;
5. create private avatar capsule colliders for any existing authoritative avatars in ascending ECS
   creation order;
6. publish the kit-owned Server-internal collision resource and avatar create/remove hooks; and
7. register the authoritative fixed-tick collision system before snapshot construction.

A joined avatar gets one private capsule initialized from its authoritative position. Creation order
is recorded by the adapter. Disconnect or authoritative entity removal removes and invalidates only
that avatar's private capsule before its mapping is cleared. A stale command cannot recreate it.

Server disposal first prevents new commands and ticks from reaching collision, then performs this
exact order:

1. unregister the authoritative fixed-tick collision system;
2. remove and invalidate the Server-internal collision resource and avatar hooks;
3. remove remaining avatar capsule colliders in reverse adapter creation order;
4. remove the character controller;
5. remove static colliders in reverse descriptor order;
6. free the private World; and
7. clear every private map, reference, and copied configuration reference.

Partial Server setup rollback performs the applicable subset of this order, including reverse-order
removal of any avatar colliders already created. It exposes no internal resource and registers no
system if setup does not reach those steps. Server disposal is idempotent, and a second call performs
no Rapier operation. A failure or shutdown of one adapter instance never disposes another Client or
Server instance's Rapier objects. Rapier module initialization is process/module initialization; an
adapter awaits it but does not claim ownership of or free the module.

## Consequences

- Shared remains authority-neutral and Rapier-free while providing the one desired-movement and
  static-scene data contract used by prediction and authority.
- Client and Server each pay Rapier's WebAssembly startup/runtime cost and own separate collision
  state; neither runtime imports the other.
- Server snapshots contain positions produced by authoritative Server collision, never a
  Client-reported collision outcome.
- Public and wire surfaces remain kit-owned and can preserve their contracts if either private
  adapter implementation changes later.
- Static scenes are axis-aligned and translation-only. Rotated or moving colliders require a later
  decision and are unsupported by the MVP.
- Prediction may disagree with authority, so reconciliation is expected operation rather than a
  physics failure.
- The fixed 0.01 meter controller offset is observable as collision clearance and is included in
  both runtime test tolerances.

## Deliberate exclusions

This decision does not include dynamic bodies, forces, impulses, joints, rigid-body networking,
general physics interfaces, collider rotation, character rotation, torque, moving platforms,
ragdolls, projectile physics, continuous rigid-body simulation, or determinism promises. It does
not promise bit-identical results across browsers, machines, Rapier versions, Client and Server, or
separate runs.

## Objective Milestone 2 tests

Milestone 2 retains automated browser and declaration evidence for all of the following:

1. **Units and floor:** create a static floor whose top is y = 0 and a capsule with radius 0.5
   meters and half-height 0.5 meters at (0, 2, 0). Submit (0, -1/60, 0) meters on each of 120
   Client fixed ticks. Every result is finite; the capsule bottom never passes below -0.001 meters;
   the final bottom is between 0 and 0.011 meters; and the final result is grounded and collided.
2. **Static obstacle:** add an axis-aligned box whose near face is x = 2. From a grounded capsule
   center at (0, 1.01, 0), submit (1/60, -0.001, 0) meters on each of 180 Client fixed ticks. The
   capsule advances in positive X, reports at least one collision, and its positive-X surface never
   exceeds 2.001 meters. At completion that surface is no farther than 0.011 meters from the
   obstacle.
3. **Fixed-tick boundary:** drive exactly 120 Client simulation ticks and 75 independently scheduled
   presentation frames. Observe exactly 120 desired-translation submissions and collision
   computations, zero collision computations from presentation callbacks, and finite presentation
   transforms throughout.
4. **Public boundary:** typecheck a consumer of @three-game-kit/client/collision using only
   MovementVector, static-scene configuration data, and CollisionMoveResult. Source, dependency,
   public-export, wire-shape, and emitted-declaration checks find no Rapier import or type in Core,
   Shared, Protocol, public exports, wire data, or any declaration.
5. **Client ownership and cleanup:** with three static colliders, instrument removal to observe the
   Client system, Client resource, controller, capsule, static collider 3, static collider 2, static
   collider 1, then World, in exactly that order. A second shutdown produces no additional
   removal/free call, and a post-shutdown movement request returns the structured disposed-resource
   failure without a Rapier access or uncaught error.
6. **Client rollback:** force setup failure immediately after controller creation. Rollback removes
   the controller, capsule, static colliders in reverse creation order, and World; it publishes no
   API, leaves no fixed-tick system, and retains no owned Rapier handle.

These tests establish bounded same-build browser prediction behavior only. They do not establish
authoritative Server behavior, cross-runtime equality, rotated-collider support, or rigid-body
behavior; the Server authority obligations are tested separately in Milestone 3.

## Objective Milestone 3 tests

Milestone 3 adds automated headless, integration, boundary, and cleanup evidence for all of the
following:

1. **Authoritative static collision:** run the Server in Node with the same kit-owned floor,
   obstacle, capsule, and offset descriptors used by the M2 fixture. Starting at the documented
   grounded position, admit valid positive-X movement commands and advance exactly 180 Server ticks.
   The authoritative capsule surface never exceeds 2.001 meters, finishes within 0.011 meters of the
   obstacle, records a collision, and every snapshot position equals the post-collision
   authoritative kit-owned position for its tick.
2. **Validation and phase order:** instrument a valid command to observe live connection/binding,
   sequence, intended tick, finite-axis/unit-disc, speed-bound, Shared desired-translation, Server
   collision, authoritative write, and snapshot construction in exactly that order. Each invalid
   connection, sequence, tick, axis, magnitude, or speed case increments exactly one matching
   rejection counter and causes no Shared movement call, Rapier collision call, authoritative
   mutation, or snapshot of a mutated position.
3. **Forged Client outcomes are ignored:** make a Client test adapter report a predicted position
   beyond the obstacle together with forged effective translation, grounded, collided, and
   collision-count values while it sends the same schema-valid semantic axes. The Server reads none
   of those local values, resolves the command from its connection binding and authoritative start
   state, stops at its own obstacle, and snapshots that bounded position. A wire object with added
   position or collision-outcome fields fails the strict Protocol schema and cannot mutate state.
4. **Private Worlds and reconciliation:** instrument two Client instances and one Server instance to
   prove three distinct Rapier Worlds and no shared handle or mutable scene object. Deliberately
   perturb one Client prediction result; the Server result is unchanged and the owning Client
   reconciles from a later authoritative snapshot within the normative M3 tolerance. The test makes
   no equality assertion between Client and Server collision details.
5. **Headless boundary:** import, initialize, tick, collide, snapshot, and dispose the Server adapter
   in Node with no window, document, WebGL, browser WebSocket, or Three.js global. Source, dependency,
   bundle, and emitted-declaration checks prove Server imports neither Client nor Three.js and prove
   both runtime adapters keep Rapier types private; Core, Shared, Protocol, public exports, wire data,
   and declarations remain Rapier-free.
6. **Server rollback and disposal:** with three static colliders and two authoritative avatars,
   instrument the exact Server order: authoritative system, internal resource/hooks, avatar 2,
   avatar 1, controller, static collider 3, static collider 2, static collider 1, then World. Force a
   separate setup failure after avatar creation and observe the applicable reverse-order rollback,
   no published resource/system, no retained handle, map, or copied configuration, and no operation
   from a second disposal.
7. **Both runtime adapters clean up:** complete the normative two-Client scenario, shut down both
   Client collision instances and the Server collision instance, and assert their respective exact
   disposal orders, zero live Rapier Worlds/controllers/colliders/handles/systems/hooks, zero retained
   copied scene objects, and no second-disposal side effect. Disposing any one instance leaves the
   others live until their own shutdown.

These tests establish the bounded authoritative and predictive static-collision architecture. They
do not establish deterministic lockstep, bit-identical cross-runtime results, production anti-cheat,
dynamic collision, rotated colliders, or general rigid-body physics.

## Rejected alternatives

- **A hand-written capsule/AABB solver:** appears smaller initially but would make edge handling,
  sliding, grounding, tolerances, and maintenance kit-owned physics work without improving the MVP
  boundary.
- **Three.js raycasts or bounding boxes as collision:** presentation queries do not provide the
  selected kinematic character movement contract and would couple gameplay movement to rendering.
- **Client-only collision:** permits authoritative state and snapshots to pass through static
  geometry and contradicts the Server-owned truth required by the multiplayer slice.
- **A full rigid-body API using Rapier, Cannon, or Ammo:** adds dynamics, forces, joints, stepping,
  and public abstraction work outside the static collision slice.
- **Exposing Rapier types or a general physics-provider interface:** freezes a vendor or speculative
  abstraction into Core, Shared, Protocol, public exports, wire data, or emitted declarations before
  a second implementation is required.
- **Importing Client collision into Server:** violates the sibling package graph and makes headless
  authority depend on a browser-runtime package.
- **Deterministic lockstep or trusting Client collision output:** conflicts with authoritative
  snapshots, the untrusted-command boundary, and the explicit absence of determinism promises.
