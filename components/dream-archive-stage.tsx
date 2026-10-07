"use client";

import { useEffect, useRef } from "react";

type IntroPhase = "boot" | "open" | "departing" | "skipping";

type DreamScene = {
  id: string;
  src: string;
  title: string;
  position: readonly [number, number, number];
  size: readonly [number, number];
  rotationY: number;
  revealAt: number;
};

const DREAM_SCENES: readonly DreamScene[] = [
  {
    id: "moon-stair",
    src: "/images/dream-archive/moon-stair.webp",
    title: "끝없이 이어진 계단",
    position: [-4.4, 1.82, -1.25],
    size: [2.45, 2.45],
    rotationY: 0.34,
    revealAt: 2.45
  },
  {
    id: "window-snake",
    src: "/images/dream-archive/window-snake.webp",
    title: "창문을 넘어온 뱀",
    position: [4.42, 1.7, -1.1],
    size: [2.4, 2.4],
    rotationY: -0.34,
    revealAt: 2.82
  },
  {
    id: "flooded-door",
    src: "/images/dream-archive/flooded-door.webp",
    title: "물속 숲의 붉은 문",
    position: [-3.82, -1.16, 0.08],
    size: [2.62, 2.62],
    rotationY: 0.25,
    revealAt: 3.18
  },
  {
    id: "night-train",
    src: "/images/dream-archive/night-train.webp",
    title: "별 사이의 막차",
    position: [3.84, -1.2, 0.12],
    size: [2.55, 2.55],
    rotationY: -0.25,
    revealAt: 3.55
  },
  {
    id: "sky-whale",
    src: "/images/dream-archive/sky-whale.webp",
    title: "도시 위를 지난 고래",
    position: [0, 0.68, 0.92],
    size: [4.58, 3.25],
    rotationY: 0,
    revealAt: 2.08
  },
  {
    id: "ocean-corridor",
    src: "/images/dream-archive/ocean-corridor.webp",
    title: "바다로 열린 복도",
    position: [0, -2.42, -0.72],
    size: [2.72, 2.18],
    rotationY: 0,
    revealAt: 3.88
  }
] as const;

const FEATURED_SCENE = DREAM_SCENES.find((scene) => scene.id === "sky-whale") ?? DREAM_SCENES[0];

const clamp = (value: number, minimum = 0, maximum = 1) => Math.min(maximum, Math.max(minimum, value));
const easeOutCubic = (value: number) => 1 - Math.pow(1 - clamp(value), 3);
const easeInOutCubic = (value: number) => {
  const progress = clamp(value);
  return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
};

function seededRandom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43_758.5453;
  return value - Math.floor(value);
}

export function DreamArchiveStage({ phase }: { phase: IntroPhase }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const stageElement = stageRef.current;
    const canvasElement = canvasRef.current;
    if (!stageElement || !canvasElement) return;
    const stage: HTMLDivElement = stageElement;
    const canvas: HTMLCanvasElement = canvasElement;

    const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let disposed = false;
    let initialising = false;
    let disposeScene: (() => void) | null = null;

    async function initialiseScene() {
      if (disposed || initialising || disposeScene || motionPreference.matches) return;
      initialising = true;
      stage.dataset.renderer = "loading";
      stage.dataset.build = "wireframe";

      try {
        const THREE = await import("three");
        if (disposed || motionPreference.matches) return;

        const isCompact = window.matchMedia("(max-width: 760px)").matches;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x020707);
        scene.fog = new THREE.FogExp2(0x020707, 0.052);

        const renderer = new THREE.WebGLRenderer({
          canvas,
          antialias: !isCompact,
          alpha: false,
          powerPreference: "high-performance"
        });
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.06;
        renderer.setClearColor(0x020707, 1);

        const camera = new THREE.PerspectiveCamera(43, 1, 0.1, 80);
        const world = new THREE.Group();
        world.name = "Yeoun dream observatory";
        scene.add(world);

        const geometries: import("three").BufferGeometry[] = [];
        const materials: import("three").Material[] = [];
        const textures: import("three").Texture[] = [];
        const bracketMaterials: import("three").LineBasicMaterial[] = [];
        const revealMaterials: Array<{
          material: import("three").ShaderMaterial;
          revealAt: number;
          featured: boolean;
        }> = [];

        const rememberGeometry = <T extends import("three").BufferGeometry>(geometry: T) => {
          geometries.push(geometry);
          return geometry;
        };
        const rememberMaterial = <T extends import("three").Material>(material: T) => {
          materials.push(material);
          return material;
        };

        function makeLine(
          points: readonly (readonly [number, number, number])[],
          color = 0x6c9994,
          opacity = 0.22,
          loop = false
        ) {
          const geometry = rememberGeometry(new THREE.BufferGeometry());
          geometry.setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
          const material = rememberMaterial(new THREE.LineBasicMaterial({
            color,
            transparent: true,
            opacity,
            depthWrite: false
          }));
          material.userData.baseOpacity = opacity;
          bracketMaterials.push(material);
          const line = loop ? new THREE.LineLoop(geometry, material) : new THREE.Line(geometry, material);
          world.add(line);
          return line;
        }

        function makeCornerBrackets(dream: DreamScene) {
          const [width, height] = dream.size;
          const corner = Math.min(width, height) * 0.13;
          const halfWidth = width / 2 + 0.09;
          const halfHeight = height / 2 + 0.09;
          const points: Array<readonly [number, number, number]> = [];

          for (const xDirection of [-1, 1] as const) {
            for (const yDirection of [-1, 1] as const) {
              const x = halfWidth * xDirection;
              const y = halfHeight * yDirection;
              points.push(
                [x - corner * xDirection, y, 0.025],
                [x, y, 0.025],
                [x, y, 0.025],
                [x, y - corner * yDirection, 0.025]
              );
            }
          }

          const geometry = rememberGeometry(new THREE.BufferGeometry());
          geometry.setFromPoints(points.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
          const baseOpacity = dream.id === "sky-whale" ? 0.48 : 0.28;
          const material = rememberMaterial(new THREE.LineBasicMaterial({
            color: dream.id === "sky-whale" ? 0xc3d6cc : 0x769893,
            transparent: true,
            opacity: baseOpacity,
            depthWrite: false
          }));
          material.userData.baseOpacity = baseOpacity;
          bracketMaterials.push(material);
          const brackets = new THREE.LineSegments(geometry, material);
          brackets.position.set(...dream.position);
          brackets.rotation.y = dream.rotationY;
          world.add(brackets);
        }

        const roomGeometry = rememberGeometry(new THREE.BoxGeometry(13.6, 7.5, 6.5, 1, 1, 1));
        const roomEdgesGeometry = rememberGeometry(new THREE.EdgesGeometry(roomGeometry));
        const roomMaterial = rememberMaterial(new THREE.LineBasicMaterial({
          color: 0x426964,
          transparent: true,
          opacity: 0.15,
          depthWrite: false
        }));
        roomMaterial.userData.baseOpacity = 0.15;
        bracketMaterials.push(roomMaterial);
        const room = new THREE.LineSegments(roomEdgesGeometry, roomMaterial);
        room.position.set(0, 0.05, -1.8);
        world.add(room);

        const grid = new THREE.GridHelper(22, 34, 0x537c76, 0x1b3835);
        grid.position.set(0, -3.26, -1.25);
        const gridMaterials = Array.isArray(grid.material) ? grid.material : [grid.material];
        for (const material of gridMaterials) {
          material.transparent = true;
          material.opacity = 0.23;
          material.depthWrite = false;
          material.userData.baseOpacity = 0.23;
          materials.push(material);
          bracketMaterials.push(material);
        }
        world.add(grid);

        for (const [radiusX, radiusY, z, opacity] of [
          [3.3, 3.3, -1.72, 0.19],
          [4.9, 4.2, -2.05, 0.13],
          [6.35, 5.2, -2.38, 0.08]
        ] as const) {
          const curve = new THREE.EllipseCurve(0, 0.18, radiusX, radiusY, 0, Math.PI * 2, false, 0);
          const points = curve.getPoints(128).map((point) => [point.x, point.y, z] as const);
          makeLine(points, 0x638d87, opacity, true);
        }

        makeLine([[-7.1, 0.14, -0.5], [7.1, 0.14, -0.5]], 0xa7c2b8, 0.2);
        makeLine([[0, -3.25, 3.1], [0, -3.25, -7.4]], 0x6b8b86, 0.17);
        makeLine([[-1.45, -3.25, 3.1], [-0.72, -3.25, -7.4]], 0x496d68, 0.13);
        makeLine([[1.45, -3.25, 3.1], [0.72, -3.25, -7.4]], 0x496d68, 0.13);

        for (const dream of DREAM_SCENES) makeCornerBrackets(dream);

        const particleCount = isCompact ? 460 : 920;
        const particlePositions = new Float32Array(particleCount * 3);
        const particleStarts = new Float32Array(particleCount * 3);
        const particleTargets = new Float32Array(particleCount * 3);
        const particleDelays = new Float32Array(particleCount);

        for (let index = 0; index < particleCount; index += 1) {
          const dream = DREAM_SCENES[index % DREAM_SCENES.length];
          const seed = index + 1;
          const angle = seededRandom(seed * 1.11) * Math.PI * 2;
          const radius = 5.8 + seededRandom(seed * 2.13) * 8.5;
          const startX = Math.cos(angle) * radius;
          const startY = (seededRandom(seed * 3.71) - 0.5) * 11.5;
          const startZ = (seededRandom(seed * 5.07) - 0.5) * 13 - 1.4;
          const [dreamWidth, dreamHeight] = dream.size;
          const targetX = dream.position[0] + (seededRandom(seed * 7.19) - 0.5) * dreamWidth * 0.92;
          const targetY = dream.position[1] + (seededRandom(seed * 9.31) - 0.5) * dreamHeight * 0.9;
          const targetZ = dream.position[2] + (seededRandom(seed * 11.47) - 0.5) * 0.36;
          const offset = index * 3;

          particleStarts[offset] = particlePositions[offset] = startX;
          particleStarts[offset + 1] = particlePositions[offset + 1] = startY;
          particleStarts[offset + 2] = particlePositions[offset + 2] = startZ;
          particleTargets[offset] = targetX;
          particleTargets[offset + 1] = targetY;
          particleTargets[offset + 2] = targetZ;
          particleDelays[index] = seededRandom(seed * 13.17) * 0.34;
        }

        const particleGeometry = rememberGeometry(new THREE.BufferGeometry());
        particleGeometry.setAttribute("position", new THREE.BufferAttribute(particlePositions, 3));
        const particleMaterial = rememberMaterial(new THREE.PointsMaterial({
          color: 0xb4d4c9,
          size: isCompact ? 0.034 : 0.028,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.66,
          depthWrite: false,
          blending: THREE.AdditiveBlending
        }));
        const particles = new THREE.Points(particleGeometry, particleMaterial);
        world.add(particles);

        const dustCount = isCompact ? 150 : 300;
        const dustPositions = new Float32Array(dustCount * 3);
        for (let index = 0; index < dustCount; index += 1) {
          const offset = index * 3;
          dustPositions[offset] = (seededRandom(index * 2.37 + 90) - 0.5) * 18;
          dustPositions[offset + 1] = (seededRandom(index * 3.81 + 120) - 0.5) * 10;
          dustPositions[offset + 2] = (seededRandom(index * 5.43 + 210) - 0.5) * 14 - 1.5;
        }
        const dustGeometry = rememberGeometry(new THREE.BufferGeometry());
        dustGeometry.setAttribute("position", new THREE.BufferAttribute(dustPositions, 3));
        const dustMaterial = rememberMaterial(new THREE.PointsMaterial({
          color: 0x8faea7,
          size: isCompact ? 0.022 : 0.017,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.17,
          depthWrite: false
        }));
        const dust = new THREE.Points(dustGeometry, dustMaterial);
        world.add(dust);

        const vertexShader = `
          uniform float uTime;
          uniform float uFeatured;
          varying vec2 vUv;

          void main() {
            vUv = uv;
            vec3 transformed = position;
            float quietCenter = 1.0 - smoothstep(0.0, 0.72, abs(uv.y - 0.5));
            transformed.z += sin(uv.x * 6.28318 + uTime * 0.34) * 0.024 * uFeatured * quietCenter;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
          }
        `;
        const fragmentShader = `
          uniform sampler2D uMap;
          uniform float uReveal;
          uniform float uOpacity;
          uniform float uAspect;
          uniform float uTime;
          uniform float uFeatured;
          varying vec2 vUv;

          float hash(vec2 point) {
            return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
          }

          void main() {
            vec2 sampleUv = vUv;
            sampleUv.y = (sampleUv.y - 0.5) / uAspect + 0.5;
            vec4 textureColor = texture2D(uMap, sampleUv);
            float grain = hash(floor(vUv * vec2(118.0, 82.0)));
            float scan = hash(vec2(floor(vUv.y * 64.0), 7.0));
            float field = vUv.y * 0.63 + grain * 0.28 + scan * 0.09;
            float revealMask = smoothstep(field - 0.1, field + 0.08, uReveal);
            float frontier = 1.0 - smoothstep(0.0, 0.055, abs(uReveal - field));
            float breathing = 1.0 + sin(uTime * 0.28) * 0.018 * uFeatured;
            vec3 color = textureColor.rgb * vec3(1.05, 1.1, 1.08) * breathing;
            color += vec3(0.48, 0.72, 0.66) * frontier * 0.32;
            float alpha = textureColor.a * revealMask * uOpacity;
            if (alpha < 0.012) discard;
            gl_FragColor = vec4(color, alpha);
          }
        `;

        let sceneDisposed = false;
        let frame = 0;
        let resizeObserver: ResizeObserver | null = null;
        let detachInteractions = () => undefined;

        disposeScene = () => {
          if (sceneDisposed) return;
          sceneDisposed = true;
          window.cancelAnimationFrame(frame);
          resizeObserver?.disconnect();
          detachInteractions();
          for (const texture of textures) texture.dispose();
          for (const geometry of geometries) geometry.dispose();
          for (const material of materials) material.dispose();
          renderer.dispose();
          renderer.forceContextLoss();
          delete stage.dataset.textures;
        };

        const textureLoader = new THREE.TextureLoader();
        const textureResults = await Promise.all(DREAM_SCENES.map(async (dream) => {
          try {
            const texture = await textureLoader.loadAsync(dream.src);
            if (disposed || sceneDisposed || motionPreference.matches) {
              texture.dispose();
              return null;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.minFilter = THREE.LinearMipmapLinearFilter;
            texture.magFilter = THREE.LinearFilter;
            texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
            textures.push(texture);

            const [width, height] = dream.size;
            const geometry = rememberGeometry(new THREE.PlaneGeometry(width, height, dream.id === "sky-whale" ? 28 : 1, dream.id === "sky-whale" ? 18 : 1));
            const featured = dream.id === "sky-whale";
            const material = rememberMaterial(new THREE.ShaderMaterial({
              uniforms: {
                uMap: { value: texture },
                uReveal: { value: 0 },
                uOpacity: { value: featured ? 1 : 0.9 },
                uAspect: { value: Math.max(1, width / height) },
                uTime: { value: 0 },
                uFeatured: { value: featured ? 1 : 0 }
              },
              vertexShader,
              fragmentShader,
              transparent: true,
              depthWrite: false,
              side: THREE.DoubleSide
            }));
            const plane = new THREE.Mesh(geometry, material);
            plane.position.set(...dream.position);
            plane.rotation.y = dream.rotationY;
            plane.renderOrder = featured ? 2 : 1;
            world.add(plane);
            revealMaterials.push({ material, revealAt: dream.revealAt, featured });
            return dream.id;
          } catch {
            return null;
          }
        }));

        if (disposed || sceneDisposed || motionPreference.matches) return;
        if (textureResults.includes("sky-whale")) stage.dataset.textures = "ready";

        function resize() {
          const width = Math.max(1, stage.clientWidth);
          const height = Math.max(1, stage.clientHeight);
          const compact = width <= 760;
          renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, compact ? 1.35 : 1.75));
          renderer.setSize(width, height, false);
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
          world.scale.setScalar(compact ? 0.56 : 1);
          world.position.set(0, compact ? 1.42 : 0.12, compact ? -0.15 : 0);
        }

        resizeObserver = new ResizeObserver(resize);
        resizeObserver.observe(stage);
        resize();

        const pointer = { x: 0, y: 0, targetX: 0, targetY: 0 };
        let hidden = document.hidden;
        let lastRenderedAt = 0;
        let buildState = "wireframe";
        const startTime = performance.now();

        function setBuildState(nextState: string) {
          if (nextState === buildState) return;
          buildState = nextState;
          stage.dataset.build = nextState;
        }

        function handlePointer(event: PointerEvent) {
          if (event.pointerType === "touch") return;
          pointer.targetX = event.clientX / Math.max(1, window.innerWidth) * 2 - 1;
          pointer.targetY = event.clientY / Math.max(1, window.innerHeight) * 2 - 1;
        }

        function handlePointerLeave() {
          pointer.targetX = 0;
          pointer.targetY = 0;
        }

        function handleVisibility() {
          hidden = document.hidden;
        }

        function handleContextLost(event: Event) {
          event.preventDefault();
          stage.dataset.renderer = "fallback";
          stage.dataset.textures = "fallback";
        }

        function render(now: number) {
          if (sceneDisposed) return;
          frame = window.requestAnimationFrame(render);
          if (hidden) return;

          const elapsed = Math.max(0, (now - startTime) / 1000);
          const settled = elapsed >= 5.8;
          const minimumFrameGap = settled ? (isCompact ? 48 : 32) : 0;
          if (now - lastRenderedAt < minimumFrameGap) return;
          lastRenderedAt = now;

          if (elapsed < 1.2) setBuildState("wireframe");
          else if (elapsed < 3.05) setBuildState("gathering");
          else if (elapsed < 5.8) setBuildState("revealing");
          else setBuildState("settled");

          const arrival = easeInOutCubic(elapsed / 5.8);
          const gather = clamp((elapsed - 0.82) / 3.15);
          const positionAttribute = particleGeometry.getAttribute("position") as import("three").BufferAttribute;
          if (gather < 1) {
            for (let index = 0; index < particleCount; index += 1) {
              const localProgress = easeOutCubic((gather - particleDelays[index]) / Math.max(0.01, 1 - particleDelays[index]));
              const offset = index * 3;
              particlePositions[offset] = THREE.MathUtils.lerp(particleStarts[offset], particleTargets[offset], localProgress);
              particlePositions[offset + 1] = THREE.MathUtils.lerp(particleStarts[offset + 1], particleTargets[offset + 1], localProgress);
              particlePositions[offset + 2] = THREE.MathUtils.lerp(particleStarts[offset + 2], particleTargets[offset + 2], localProgress);
            }
            positionAttribute.needsUpdate = true;
          }

          particleMaterial.opacity = THREE.MathUtils.lerp(0.72, 0.13, easeOutCubic((elapsed - 1.25) / 4.1));
          particleMaterial.size = THREE.MathUtils.lerp(isCompact ? 0.04 : 0.034, isCompact ? 0.018 : 0.014, clamp((elapsed - 1.1) / 4.4));
          dustMaterial.opacity = 0.13 + Math.sin(elapsed * 0.24) * 0.025;
          dust.rotation.y = elapsed * 0.0035;

          for (const entry of revealMaterials) {
            entry.material.uniforms.uReveal.value = clamp((elapsed - entry.revealAt) / (entry.featured ? 1.55 : 1.25)) * 1.12;
            entry.material.uniforms.uTime.value = elapsed;
          }

          const structuralOpacity = elapsed < 1.2
            ? THREE.MathUtils.lerp(0.04, 1, easeOutCubic(elapsed / 1.05))
            : THREE.MathUtils.lerp(1, 0.48, clamp((elapsed - 3.1) / 2.7));
          for (const material of bracketMaterials) {
            material.opacity = Number(material.userData.baseOpacity) * structuralOpacity;
          }

          pointer.x += (pointer.targetX - pointer.x) * 0.035;
          pointer.y += (pointer.targetY - pointer.y) * 0.035;
          const settledWeight = clamp((elapsed - 5.8) / 2);
          const baseZ = THREE.MathUtils.lerp(16.4, 11.9, arrival);
          camera.position.x = pointer.x * 0.82 + Math.sin(elapsed * 0.07) * 0.12;
          camera.position.y = 0.32 - pointer.y * 0.34 + Math.sin(elapsed * 0.09) * 0.065;
          camera.position.z = baseZ + Math.sin((elapsed - 5.8) * 0.12) * 0.12 * settledWeight;
          camera.lookAt(pointer.x * 0.18, -0.08 - pointer.y * 0.055, -0.08);
          world.rotation.y = Math.sin(elapsed * 0.055) * 0.01;

          renderer.render(scene, camera);
        }

        window.addEventListener("pointermove", handlePointer, { passive: true });
        document.documentElement.addEventListener("pointerleave", handlePointerLeave);
        document.addEventListener("visibilitychange", handleVisibility);
        canvas.addEventListener("webglcontextlost", handleContextLost);

        detachInteractions = () => {
          window.removeEventListener("pointermove", handlePointer);
          document.documentElement.removeEventListener("pointerleave", handlePointerLeave);
          document.removeEventListener("visibilitychange", handleVisibility);
          canvas.removeEventListener("webglcontextlost", handleContextLost);
        };

        renderer.render(scene, camera);
        stage.dataset.renderer = "webgl";
        frame = window.requestAnimationFrame(render);
      } catch {
        if (!disposed) {
          disposeScene?.();
          disposeScene = null;
          stage.dataset.renderer = "fallback";
          stage.dataset.build = "settled";
        }
      } finally {
        initialising = false;
      }
    }

    function updateMotionPreference() {
      if (motionPreference.matches) {
        stage.dataset.motion = "reduced";
        stage.dataset.renderer = "fallback";
        stage.dataset.build = "settled";
        disposeScene?.();
        disposeScene = null;
        return;
      }

      stage.dataset.motion = "active";
      void initialiseScene();
    }

    updateMotionPreference();
    motionPreference.addEventListener("change", updateMotionPreference);

    return () => {
      disposed = true;
      motionPreference.removeEventListener("change", updateMotionPreference);
      disposeScene?.();
      disposeScene = null;
    };
  }, []);

  return (
    <div
      ref={stageRef}
      className={`dream-archive-stage dream-archive-stage--${phase}`}
      data-scene="dream-observatory"
      data-motion-profile="assembled-spatial-v1"
      data-featured-scene="sky-whale"
      data-dreams={DREAM_SCENES.length}
      data-motion="loading"
      data-renderer="loading"
      data-build="wireframe"
      data-rendered="true"
      aria-hidden="true"
    >
      <div className="dream-observatory-poster">
        <img
          src={FEATURED_SCENE.src}
          alt=""
          width={960}
          height={960}
          decoding="async"
          loading="eager"
          draggable={false}
        />
      </div>
      <canvas ref={canvasRef} className="dream-observatory-canvas" />
      <div className="dream-observatory-shade" />
      <div className="dream-observatory-scanline" />
      <div className="dream-observatory-grain" />
      <div className="dream-observatory-vignette" />
      <div className="home-intro-blackout" />
    </div>
  );
}
