"use client";

import { useEffect, useRef } from "react";

type CosmicPhase = "boot" | "open" | "departing" | "skipping";

type Star = {
  alpha: number;
  depth: number;
  drift: number;
  flare: boolean;
  phase: number;
  size: number;
  tone: number;
  twinkle: number;
  x: number;
  y: number;
};

type NebulaCloud = {
  alpha: number;
  depth: number;
  phase: number;
  rotation: number;
  rx: number;
  ry: number;
  speed: number;
  tone: number;
  x: number;
  y: number;
};

type Comet = {
  cycle: number;
  delay: number;
  duration: number;
  endX: number;
  endY: number;
  startX: number;
  startY: number;
  tone: number;
  width: number;
};

const STAR_COLORS = [
  [245, 241, 226],
  [185, 220, 224],
  [235, 204, 139],
  [166, 191, 211]
] as const;

const NEBULA_COLORS = [
  [46, 111, 126],
  [48, 82, 119],
  [170, 92, 57],
  [205, 171, 103]
] as const;

const COMETS: readonly Comet[] = [
  { cycle: 7.8, delay: 0.7, duration: 1.15, startX: 1.08, startY: 0.04, endX: 0.48, endY: 0.36, tone: 0, width: 1.35 },
  { cycle: 10.4, delay: 2.8, duration: 1.28, startX: 0.82, startY: -0.08, endX: 0.16, endY: 0.36, tone: 1, width: 1.05 },
  { cycle: 13.2, delay: 5.1, duration: 1.2, startX: 1.12, startY: 0.31, endX: 0.58, endY: 0.64, tone: 2, width: 0.9 },
  { cycle: 16.6, delay: 7.4, duration: 1.42, startX: 0.62, startY: -0.1, endX: 0.08, endY: 0.28, tone: 0, width: 0.78 },
  { cycle: 19.8, delay: 10.2, duration: 1.34, startX: 1.1, startY: 0.14, endX: 0.73, endY: 0.48, tone: 1, width: 0.68 }
] as const;

function seededRandom(seed: number) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value));
}

function easeOutQuint(value: number) {
  return 1 - Math.pow(1 - clamp(value), 5);
}

function smoothStep(value: number) {
  const clamped = clamp(value);
  return clamped * clamped * (3 - 2 * clamped);
}

function wrap(value: number, range: number) {
  return ((value % range) + range) % range;
}

export function CosmicDreamCanvas({ phase }: { phase: CosmicPhase }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef({ value: phase, changedAt: 0 });

  useEffect(() => {
    phaseRef.current = { value: phase, changedAt: performance.now() };
  }, [phase]);

  useEffect(() => {
    const currentCanvas = canvasRef.current;
    if (!currentCanvas) return;
    const currentContext = currentCanvas.getContext("2d", { alpha: true });
    if (!currentContext) return;
    const canvas: HTMLCanvasElement = currentCanvas;
    const context: CanvasRenderingContext2D = currentContext;
    const stage = canvas.parentElement;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const random = seededRandom(20_260_823);
    const pointer = { x: 0, y: 0, targetX: 0, targetY: 0, energy: 0, targetEnergy: 0 };
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const saveData = Boolean((navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData);
    const frameInterval = memory <= 4 || saveData ? 1_000 / 30 : 1_000 / 60;
    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let stars: Star[] = [];
    let nebulaClouds: NebulaCloud[] = [];
    let animationFrame = 0;
    let lastDrawTime = 0;
    let previousTime = performance.now();
    let openingAt = previousTime;
    let firstFrame = true;

    function galacticLine(normalizedX: number) {
      return 0.64 - normalizedX * 0.54 + Math.sin(normalizedX * Math.PI * 2.1 + 0.35) * 0.055;
    }

    function makeScene() {
      const mobile = width <= 760;
      const baseCount = mobile ? 260 : Math.min(560, Math.max(400, Math.round((width * height) / 3_200)));
      const starCount = memory <= 4 || saveData ? Math.round(baseCount * 0.7) : baseCount;

      stars = Array.from({ length: starCount }, () => {
        const depth = Math.pow(random(), 0.9);
        const x = random();
        const bandStar = random() < 0.38;
        const bandOffset = (random() + random() + random() - 1.5) * 0.17;
        return {
          alpha: 0.18 + random() * 0.66,
          depth,
          drift: 0.8 + depth * 7.4 + random() * 2.2,
          flare: random() > 0.955,
          phase: random() * Math.PI * 2,
          size: 0.32 + Math.pow(depth, 1.7) * 1.65 + random() * 0.4,
          tone: random() > 0.88 ? (random() > 0.52 ? 1 : 2) : random() > 0.92 ? 3 : 0,
          twinkle: 0.55 + random() * 1.45,
          x,
          y: bandStar ? clamp(galacticLine(x) + bandOffset, -0.05, 1.05) : random()
        };
      });

      const cloudCount = mobile ? 16 : 24;
      nebulaClouds = Array.from({ length: cloudCount }, (_, index) => {
        const along = index < cloudCount - 4 ? random() * 1.18 - 0.08 : random();
        const looseCloud = index >= cloudCount - 4;
        return {
          alpha: 0.025 + random() * (looseCloud ? 0.035 : 0.07),
          depth: 0.18 + random() * 0.68,
          phase: random() * Math.PI * 2,
          rotation: -0.5 + random() * 0.48,
          rx: 0.105 + random() * 0.16,
          ry: 0.055 + random() * 0.095,
          speed: 0.1 + random() * 0.18,
          tone: index % NEBULA_COLORS.length,
          x: looseCloud ? random() : along,
          y: looseCloud ? 0.08 + random() * 0.78 : galacticLine(along) + (random() - 0.5) * 0.2
        };
      });

      canvas.dataset.particles = String(starCount);
      canvas.dataset.frameRate = frameInterval > 20 ? "30" : "60";
      canvas.dataset.comets = String(COMETS.length);
    }

    function resize() {
      const bounds = canvas.getBoundingClientRect();
      width = Math.max(1, bounds.width || window.innerWidth);
      height = Math.max(1, bounds.height || window.innerHeight);
      pixelRatio = Math.min(window.devicePixelRatio || 1, width <= 760 ? 1.35 : 1.6);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      makeScene();
      firstFrame = true;
      if (reduceMotion.matches && canvas.dataset.motion === "reduced") drawFrame(performance.now(), true);
    }

    function drawSoftEllipse(
      x: number,
      y: number,
      radiusX: number,
      radiusY: number,
      rotation: number,
      color: readonly [number, number, number],
      alpha: number,
      center = 0
    ) {
      context.save();
      context.translate(x, y);
      context.rotate(rotation);
      context.scale(Math.max(1, radiusX), Math.max(1, radiusY));
      const gradient = context.createRadialGradient(center, -center * 0.32, 0, 0, 0, 1);
      gradient.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`);
      gradient.addColorStop(0.36, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.72})`);
      gradient.addColorStop(0.72, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.2})`);
      gradient.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(0, 0, 1, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }

    function drawBackground(sceneTime: number, reveal: number, exit: number) {
      context.clearRect(0, 0, width, height);

      const slowBreath = 0.88 + Math.sin(sceneTime * 0.18) * 0.12;
      context.globalCompositeOperation = "screen";
      drawSoftEllipse(width * 0.72 + pointer.x * 2, height * 0.25 + pointer.y * 2, width * 0.48, height * 0.32, -0.34, NEBULA_COLORS[1], 0.028 * reveal * slowBreath);
      drawSoftEllipse(width * 0.96, height * 0.72, width * 0.38, height * 0.31, -0.18, NEBULA_COLORS[2], 0.018 * reveal);
      drawSoftEllipse(width * 0.18, height * 0.78, width * 0.3, height * 0.24, 0.15, NEBULA_COLORS[0], 0.016 * reveal);
      context.globalCompositeOperation = "source-over";

      if (exit > 0) {
        context.fillStyle = `rgba(227, 235, 229, ${exit * 0.055})`;
        context.fillRect(0, 0, width, height);
      }
    }

    function drawNebulae(sceneTime: number, reveal: number) {
      context.save();
      context.globalCompositeOperation = "screen";
      for (const cloud of nebulaClouds) {
        const driftX = Math.sin(sceneTime * cloud.speed + cloud.phase) * (18 + cloud.depth * 38) + pointer.x * cloud.depth * 5.5;
        const driftY = Math.cos(sceneTime * cloud.speed * 0.78 + cloud.phase) * (12 + cloud.depth * 24) + pointer.y * cloud.depth * 4.4;
        const pulse = 0.82 + Math.sin(sceneTime * (0.34 + cloud.speed * 1.6) + cloud.phase) * 0.18;
        drawSoftEllipse(
          cloud.x * width + driftX,
          cloud.y * height + driftY,
          cloud.rx * width,
          cloud.ry * height,
          cloud.rotation + Math.sin(sceneTime * cloud.speed * 0.7 + cloud.phase) * 0.06,
          NEBULA_COLORS[cloud.tone],
          cloud.alpha * pulse * reveal
        );
      }
      context.restore();
    }

    function riverPath(offset: number, sceneTime: number) {
      const wave = Math.sin(sceneTime * 0.28 + offset * 0.04) * height * 0.014;
      context.beginPath();
      context.moveTo(-width * 0.16, height * 0.72 + offset + wave);
      context.bezierCurveTo(width * 0.13, height * 0.58 + offset, width * 0.34, height * 0.43 + offset - wave, width * 0.54, height * 0.29 + offset);
      context.bezierCurveTo(width * 0.72, height * 0.15 + offset + wave, width * 0.91, height * 0.12 + offset, width * 1.18, -height * 0.02 + offset - wave);
    }

    function drawGalacticRiver(sceneTime: number, reveal: number, exit: number) {
      const scale = 1 + exit * 0.34;
      const coreX = width * 0.69 + pointer.x * 2.4;
      const coreY = height * 0.245 + pointer.y * 2.2;
      context.save();
      context.translate(coreX, coreY);
      context.scale(scale, scale);
      context.translate(-coreX, -coreY);
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";

      const bands = [
        { color: "rgba(61, 117, 132, ALPHA)", alpha: 0.018, offset: height * 0.055, width: height * 0.18 },
        { color: "rgba(194, 130, 78, ALPHA)", alpha: 0.014, offset: -height * 0.025, width: height * 0.11 },
        { color: "rgba(223, 203, 153, ALPHA)", alpha: 0.021, offset: 0, width: height * 0.048 },
        { color: "rgba(200, 224, 219, ALPHA)", alpha: 0.045, offset: -height * 0.005, width: height * 0.009 }
      ] as const;

      for (const band of bands) {
        riverPath(band.offset, sceneTime);
        context.strokeStyle = band.color.replace("ALPHA", String(band.alpha * reveal));
        context.lineWidth = Math.max(1, band.width);
        context.stroke();
      }

      drawSoftEllipse(coreX, coreY, width * 0.27, height * 0.14, -0.42, NEBULA_COLORS[3], 0.035 * reveal, -0.22);
      drawSoftEllipse(coreX + width * 0.015, coreY - height * 0.006, width * 0.15, height * 0.061, -0.42, STAR_COLORS[0], 0.04 * reveal, -0.18);

      context.globalCompositeOperation = "source-over";
      riverPath(height * 0.014, sceneTime);
      context.strokeStyle = `rgba(1, 4, 10, ${0.08 * reveal})`;
      context.lineWidth = Math.max(6, height * 0.018);
      context.stroke();

      context.globalCompositeOperation = "screen";
      for (let index = 0; index < 5; index += 1) {
        const shift = Math.sin(sceneTime * (0.42 + index * 0.035) + index * 1.7) * height * 0.02;
        riverPath((index - 2) * height * 0.016 + shift, sceneTime);
        context.strokeStyle = index % 2 === 0
          ? `rgba(193, 222, 218, ${0.105 * reveal})`
          : `rgba(232, 199, 126, ${0.09 * reveal})`;
        context.lineWidth = index === 2 ? 0.82 : 0.48;
        context.stroke();
      }
      context.restore();
    }

    function drawStars(sceneTime: number, reveal: number, exit: number, minimumDepth: number, maximumDepth: number) {
      const coreX = width * 0.69;
      const coreY = height * 0.245;
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";

      for (const star of stars) {
        if (star.depth < minimumDepth || star.depth >= maximumDepth) continue;
        const margin = 28;
        const driftX = sceneTime * star.drift * (0.46 + star.depth * 0.74) + pointer.x * star.depth * 8;
        const driftY = sceneTime * star.drift * 0.22 + pointer.y * star.depth * 6.2;
        const baseX = wrap(star.x * (width + margin * 2) + driftX, width + margin * 2) - margin;
        const baseY = wrap(star.y * (height + margin * 2) + driftY, height + margin * 2) - margin;
        const forwardCycle = wrap(star.phase / (Math.PI * 2) + sceneTime * (0.022 + star.depth * 0.024), 1);
        const forwardScale = 0.87 + forwardCycle * 0.24;
        const orbit = sceneTime * (0.0012 + star.depth * 0.0024);
        const baseDistanceX = baseX - coreX;
        const baseDistanceY = baseY - coreY;
        const orbitX = baseDistanceX * Math.cos(orbit) - baseDistanceY * Math.sin(orbit);
        const orbitY = baseDistanceX * Math.sin(orbit) + baseDistanceY * Math.cos(orbit);
        const warp = forwardScale * (1 + exit * (0.9 + star.depth * 1.6));
        const x = coreX + orbitX * warp;
        const y = coreY + orbitY * warp;
        if (x < -60 || x > width + 60 || y < -60 || y > height + 60) continue;

        const twinkle = 0.68 + Math.sin(sceneTime * star.twinkle + star.phase) * 0.26;
        const alpha = star.alpha * twinkle * reveal * (0.48 + star.depth * 0.62) * (1 - exit * 0.3);
        const color = STAR_COLORS[star.tone];
        const radius = star.size * (0.64 + star.depth * 0.55) * (1 + exit * 0.42);

        const radialLength = Math.max(1, Math.hypot(x - coreX, y - coreY));
        const cruisePulse = 0.82 + Math.sin(sceneTime * 1.15 + star.phase) * 0.18;
        const normalTrail = star.depth > 0.48 ? (star.depth - 0.42) * 12 * cruisePulse : 0;
        if (exit > 0.035 || normalTrail > 0.55) {
          const trailScale = exit > 0.035
            ? Math.max(forwardScale * 0.88, warp - exit * (0.16 + star.depth * 0.36))
            : Math.max(0.72, warp - normalTrail / radialLength);
          const fromX = coreX + orbitX * trailScale;
          const fromY = coreY + orbitY * trailScale;
          const trailAlpha = exit > 0.035 ? alpha * 0.78 : alpha * (0.32 + star.depth * 0.26);
          context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${trailAlpha})`;
          context.lineWidth = Math.max(0.38, radius * (0.52 + star.depth * 0.22));
          context.beginPath();
          context.moveTo(fromX, fromY);
          context.lineTo(x, y);
          context.stroke();

          if (star.depth > 0.62) {
            context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.72})`;
            context.beginPath();
            context.arc(x, y, Math.max(0.3, radius * 0.56), 0, Math.PI * 2);
            context.fill();
          }
        } else {
          context.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha})`;
          context.beginPath();
          context.arc(x, y, Math.max(0.28, radius), 0, Math.PI * 2);
          context.fill();
        }

        if (star.flare && alpha > 0.28) {
          const flare = (4.2 + star.depth * 6.8) * (0.78 + Math.sin(sceneTime * star.twinkle + star.phase) * 0.18);
          context.strokeStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${alpha * 0.48})`;
          context.lineWidth = 0.45;
          context.beginPath();
          context.moveTo(x - flare, y);
          context.lineTo(x + flare, y);
          context.moveTo(x, y - flare * 0.52);
          context.lineTo(x, y + flare * 0.52);
          context.stroke();
        }
      }
      context.restore();
    }

    function drawComets(sceneTime: number, reveal: number) {
      context.save();
      context.globalCompositeOperation = "screen";
      context.lineCap = "round";

      for (const comet of COMETS) {
        const localTime = wrap(sceneTime - comet.delay, comet.cycle);
        if (localTime > comet.duration) continue;
        const progress = smoothStep(localTime / comet.duration);
        const x = (comet.startX + (comet.endX - comet.startX) * progress) * width;
        const y = (comet.startY + (comet.endY - comet.startY) * progress) * height;
        const directionX = (comet.endX - comet.startX) * width;
        const directionY = (comet.endY - comet.startY) * height;
        const directionLength = Math.max(1, Math.hypot(directionX, directionY));
        const trailLength = Math.min(width * 0.24, 150 + width * 0.055);
        const tailX = x - directionX / directionLength * trailLength;
        const tailY = y - directionY / directionLength * trailLength;
        const fade = Math.sin(clamp(localTime / comet.duration) * Math.PI);
        const color = STAR_COLORS[comet.tone];
        const trail = context.createLinearGradient(tailX, tailY, x, y);
        trail.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`);
        trail.addColorStop(0.75, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${0.26 * fade * reveal})`);
        trail.addColorStop(1, `rgba(255, 250, 229, ${0.88 * fade * reveal})`);
        context.strokeStyle = trail;
        context.globalAlpha = 0.24;
        context.lineWidth = comet.width * 4;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(x, y);
        context.stroke();
        context.globalAlpha = 1;
        context.lineWidth = comet.width;
        context.beginPath();
        context.moveTo(tailX, tailY);
        context.lineTo(x, y);
        context.stroke();
        context.fillStyle = `rgba(255, 252, 235, ${0.92 * fade * reveal})`;
        context.beginPath();
        context.arc(x, y, comet.width * 1.15, 0, Math.PI * 2);
        context.fill();
      }
      context.restore();
    }

    function drawFrame(time: number, staticFrame = false) {
      const elapsed = Math.min(40, Math.max(0, time - previousTime));
      const delta = staticFrame ? 0 : elapsed / 1_000;
      previousTime = time;
      const currentPhase = phaseRef.current.value;
      const phaseElapsed = Math.max(0, time - phaseRef.current.changedAt);
      const rawSceneTime = Math.max(0, (time - openingAt) / 1_000);
      const sceneTime = staticFrame ? 2.05 : rawSceneTime;
      const reveal = reduceMotion.matches ? 1 : smoothStep((time - openingAt - 80) / 1_180);
      const exit = currentPhase === "departing" ? easeOutQuint(phaseElapsed / 1_220) : 0;
      const follow = staticFrame ? 1 : 1 - Math.exp(-delta * 3.4);
      pointer.x += (pointer.targetX - pointer.x) * follow;
      pointer.y += (pointer.targetY - pointer.y) * follow;
      pointer.energy += (pointer.targetEnergy - pointer.energy) * follow;
      if (!reduceMotion.matches && stage) {
        stage.style.setProperty("--cosmos-pointer-x", `${pointer.x * 8}px`);
        stage.style.setProperty("--cosmos-pointer-y", `${pointer.y * 8}px`);
      }

      drawBackground(sceneTime, reveal, exit);
      drawStars(sceneTime, reveal, exit, 0, 0.34);
      drawNebulae(sceneTime, reveal * (0.92 + pointer.energy * 0.06));
      drawGalacticRiver(sceneTime, reveal * (0.94 + pointer.energy * 0.06), exit);
      drawStars(sceneTime, reveal, exit, 0.34, 0.72);
      drawStars(sceneTime, reveal, exit, 0.72, 1.01);
      drawComets(sceneTime, reveal * (1 - exit * 0.65));

      if (firstFrame) {
        canvas.dataset.rendered = "true";
        firstFrame = false;
      }
    }

    function animate(time: number) {
      if (!lastDrawTime || time - lastDrawTime >= frameInterval - 1) {
        drawFrame(time);
        lastDrawTime = lastDrawTime ? time - ((time - lastDrawTime) % frameInterval) : time;
      }
      animationFrame = window.requestAnimationFrame(animate);
    }

    function updateMotion() {
      window.cancelAnimationFrame(animationFrame);
      canvas.dataset.motion = reduceMotion.matches ? "reduced" : "active";
      previousTime = performance.now();
      lastDrawTime = 0;
      if (reduceMotion.matches) drawFrame(previousTime, true);
      else animationFrame = window.requestAnimationFrame(animate);
    }

    function handlePointer(event: PointerEvent) {
      pointer.targetX = clamp(event.clientX / Math.max(1, width), 0, 1) * 2 - 1;
      pointer.targetY = clamp(event.clientY / Math.max(1, height), 0, 1) * 2 - 1;
      pointer.targetEnergy = clamp(Math.hypot(pointer.targetX, pointer.targetY) * 0.7);
    }

    function handlePointerLeave() {
      pointer.targetX = 0;
      pointer.targetY = 0;
      pointer.targetEnergy = 0;
    }

    function handleVisibility() {
      window.cancelAnimationFrame(animationFrame);
      if (!document.hidden) updateMotion();
    }

    resize();
    openingAt = performance.now();
    phaseRef.current.changedAt = openingAt;
    updateMotion();
    window.addEventListener("resize", resize, { passive: true });
    window.addEventListener("pointermove", handlePointer, { passive: true });
    document.documentElement.addEventListener("pointerleave", handlePointerLeave);
    document.addEventListener("visibilitychange", handleVisibility);
    reduceMotion.addEventListener("change", updateMotion);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointermove", handlePointer);
      document.documentElement.removeEventListener("pointerleave", handlePointerLeave);
      document.removeEventListener("visibilitychange", handleVisibility);
      reduceMotion.removeEventListener("change", updateMotion);
      stage?.style.removeProperty("--cosmos-pointer-x");
      stage?.style.removeProperty("--cosmos-pointer-y");
    };
  }, []);

  return (
    <div className={`cosmic-dream-stage cosmic-dream-stage--${phase}`} aria-hidden="true">
      <picture className="cosmic-dream-panorama" aria-hidden="true">
        <source media="(max-width: 760px)" srcSet="/images/cosmic/living-universe-mobile-v1.webp" />
        <img
          src="/images/cosmic/living-universe-v1.webp"
          alt=""
          decoding="async"
          fetchPriority="high"
          draggable={false}
        />
      </picture>
      <canvas
        ref={canvasRef}
        className="cosmic-dream-canvas"
        data-scene="living-cosmos"
        data-motion-profile="dynamic-v2"
        data-layers="panorama,far-stars,nebula,galactic-river,mid-stars,distant-bodies,near-stars,comets"
        aria-hidden="true"
      />
      <div className="cosmic-dream-atmosphere" />
      <div className="cosmic-dream-grain" />
      <div className="cosmic-dream-vignette" />
      <div className="home-intro-blackout" />
    </div>
  );
}
