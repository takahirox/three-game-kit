import { createClientRuntime, createBrowserPresentationFrameSource, type ClientRuntime } from "@three-game-kit/client";
import { createParticleEmitter, createParticleFeature, type ParticleEmitter, type ParticleSceneParent } from "@three-game-kit/client/particles";

/**
 * Alternative to the workshop's manual presentation loop: install the emitter
 * in a client runtime, then call client.boot() and client.startPresentation().
 * Add a rendering Feature to the same runtime for a complete scheduled scene.
 * client.shutdown() owns particle cleanup.
 */
export function createParticleSceneRuntime(scene: ParticleSceneParent): {
    readonly client: ClientRuntime;
    readonly emitter: ParticleEmitter;
} {
    const emitter = createParticleEmitter(scene, {
        capacity: 1024, rate: 100, seed: 42,
        shape: { kind: "cone", radius: 0.1, angle: Math.PI / 6 },
        speed: [1, 3], lifetimeMs: [500, 1200], blending: "additive",
    });
    const client = createClientRuntime({ frameSource: createBrowserPresentationFrameSource(requestAnimationFrame, cancelAnimationFrame), features: [createParticleFeature({ emitters: [emitter] })] });
    return { client, emitter };
}
