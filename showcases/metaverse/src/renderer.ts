import * as THREE from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { RenderingFeatureAdapter } from "@three-game-kit/client/rendering";
import type { ThirdPersonCameraTransform } from "@three-game-kit/client/camera";
import { FOOT_OFFSET } from "./world.js";

export function createCourtRenderer(
  canvas: HTMLCanvasElement,
  visitor: GLTF,
  court: GLTF,
) {
  const webgl = new THREE.WebGLRenderer({ canvas, antialias: true });
  webgl.setPixelRatio(Math.min(devicePixelRatio, 2));
  webgl.shadowMap.enabled = true;
  webgl.shadowMap.type = THREE.PCFShadowMap;
  webgl.outputColorSpace = THREE.SRGBColorSpace;
  webgl.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xc8dcd9);
  scene.fog = new THREE.Fog(0xc8dcd9, 22, 65);
  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xe5f4ff, 0x6d6349, 2.6));
  const sun = new THREE.DirectionalLight(0xffe1ac, 3.4);
  sun.position.set(-10, 16, 8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, {
    left: -20,
    right: 20,
    top: 20,
    bottom: -20,
  });
  sun.shadow.bias = -0.0005;
  scene.add(sun);
  scene.add(court.scene, visitor.scene);
  // Asset manager owns the two loaded scenes' geometry and materials; renderer borrows them.
  scene.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  const ownedGeometries: THREE.BufferGeometry[] = [],
    ownedMaterials: THREE.Material[] = [];
  function ground(w: number, d: number, color: number, x = 0, z = 0, y = 0) {
    const g = new THREE.PlaneGeometry(w, d),
      m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    ownedGeometries.push(g);
    ownedMaterials.push(m);
    const mesh = new THREE.Mesh(g, m);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.set(x, y, z);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
  ground(32, 32, 0x809273);
  ground(4.5, 29, 0xcfbf9e, 0, 0, 0.008);
  ground(24, 3.5, 0xcfbf9e, 0, -6.5, 0.009);
  // Central mosaic and border stones anchor the meeting place.
  ground(7, 7, 0xe0d3b6, 0, -3, 0.012);
  for (const x of [-2.4, 2.4]) ground(0.14, 27, 0xebdfc5, x, 0, 0.013);
  for (let i = 0; i < 8; i++)
    ground(
      0.36,
      0.36,
      i % 2 ? 0xb2956c : 0x708f85,
      Math.sin((i * Math.PI) / 4) * 2.6,
      -3 + Math.cos((i * Math.PI) / 4) * 2.6,
      0.016,
    );
  // Render the collider boundaries as low garden walls rather than invisible barriers.
  const wallG = new THREE.BoxGeometry(32, 1.4, 0.6),
    wallM = new THREE.MeshStandardMaterial({ color: 0xabbb9b, roughness: 1 });
  ownedGeometries.push(wallG);
  ownedMaterials.push(wallM);
  for (const [x, z, angle] of [
    [0, -16, 0],
    [0, 16, 0],
    [-16, 0, Math.PI / 2],
    [16, 0, Math.PI / 2],
  ]) {
    const m = new THREE.Mesh(wallG, wallM);
    m.position.set(x!, 0.7, z!);
    m.rotation.y = angle!;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
  }
  const lamp = new THREE.PointLight(0xffb966, 0, 9, 2);
  lamp.position.set(0, 2.9, -3);
  scene.add(lamp);
  const glow = court.scene.getObjectByName("LanternGlow") as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshStandardMaterial
  >;
  const cameraRay = new THREE.Raycaster();
  const cameraTarget = new THREE.Vector3();
  const cameraDirection = new THREE.Vector3();
  const cameraObstacles = scene.children.filter(
    (object) => object !== visitor.scene,
  );
  let disposed = false,
    frames = 0;
  function resize() {
    if (disposed) return;
    const { width, height } = canvas.getBoundingClientRect();
    webgl.setSize(Math.max(1, width), Math.max(1, height), false);
    camera.aspect = width / Math.max(1, height);
    camera.updateProjectionMatrix();
  }
  resize();
  const adapter: RenderingFeatureAdapter = {
    render() {
      if (!disposed) {
        webgl.render(scene, camera);
        frames++;
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      // Skeleton bone textures are created by WebGL, not by the asset backend.
      visitor.scene.traverse((o) => {
        if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
      });
      for (const g of ownedGeometries.splice(0)) g.dispose();
      for (const m of ownedMaterials.splice(0)) m.dispose();
      sun.shadow.dispose();
      cameraObstacles.length = 0;
      scene.clear();
      webgl.renderLists.dispose();
      webgl.dispose();
    },
  };
  return {
    ...adapter,
    resize,
    prepare(
      position: Readonly<{ x: number; y: number; z: number }>,
      facing: number,
      active: boolean,
    ) {
      if (disposed) return;
      visitor.scene.position.set(
        position.x,
        position.y - FOOT_OFFSET,
        position.z,
      );
      visitor.scene.rotation.y = facing;
      lamp.intensity = active ? 16 : 0;
      glow.material.emissiveIntensity = active ? 3 : 0.05;
    },
    setCamera(transform: ThirdPersonCameraTransform) {
      if (disposed) return;
      camera.position.copy(transform.position);
      cameraTarget.set(
        transform.lookAt.x,
        transform.lookAt.y,
        transform.lookAt.z,
      );
      cameraDirection.subVectors(camera.position, cameraTarget);
      cameraRay.far = cameraDirection.length();
      cameraRay.set(cameraTarget, cameraDirection.normalize());
      scene.updateMatrixWorld(true);
      const obstruction = cameraRay.intersectObjects(cameraObstacles, true)[0];
      if (obstruction) {
        camera.position
          .copy(cameraTarget)
          .addScaledVector(
            cameraDirection,
            Math.max(0.15, obstruction.distance - 0.25),
          );
      }
      camera.lookAt(transform.lookAt.x, transform.lookAt.y, transform.lookAt.z);
    },
    inspect() {
      let meshes = 0,
        skinnedMeshes = 0;
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) meshes++;
        if (o instanceof THREE.SkinnedMesh) skinnedMeshes++;
      });
      const head = visitor.scene.getObjectByName("Head");
      return {
        disposed,
        frames,
        meshes,
        skinnedMeshes,
        drawCalls: webgl.info.render.calls,
        triangles: webgl.info.render.triangles,
        ownedGeometries: ownedGeometries.length,
        ownedMaterials: ownedMaterials.length,
        headQuaternion: head?.quaternion.toArray(),
        legQuaternion: visitor.scene
          .getObjectByName("ThighL")
          ?.quaternion.toArray(),
        lanternIntensity: lamp.intensity,
        camera: {
          position: camera.position.toArray(),
          target: [
            visitor.scene.position.x,
            visitor.scene.position.y + 1.2,
            visitor.scene.position.z,
          ],
        },
      };
    },
  };
}
export type CourtRenderer = ReturnType<typeof createCourtRenderer>;
