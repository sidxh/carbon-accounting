"use client";

import { useInView, useReducedMotion, type MotionValue } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { usePageVisible } from "./hero-demo";

// Buckminsterfullerene, C60: a truncated icosahedron. Its 60 atoms are the even
// (cyclic) permutations of (0, ±1, ±3φ), (±1, ±(2+φ), ±2φ) and (±φ, ±2, ±φ³);
// every bond is an edge of length 2 between two of them.
const PHI = (1 + Math.sqrt(5)) / 2;

function atoms(): [number, number, number][] {
  const bases: [number, number, number][] = [[0, 1, 3 * PHI], [1, 2 + PHI, 2 * PHI], [PHI, 2, PHI ** 3]];
  const out: [number, number, number][] = [];
  const seen = new Set<string>();
  for (const [a, b, c] of bases) {
    for (const sa of [1, -1]) for (const sb of [1, -1]) for (const sc of [1, -1]) {
      const v: [number, number, number] = [a * sa, b * sb, c * sc];
      for (const p of [[v[0], v[1], v[2]], [v[1], v[2], v[0]], [v[2], v[0], v[1]]] as [number, number, number][]) {
        const key = p.map((x) => x.toFixed(3)).join();
        if (!seen.has(key)) { seen.add(key); out.push(p); }
      }
    }
  }
  return out;
}

function bonds(pts: [number, number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1], pts[i][2] - pts[j][2]);
    if (Math.abs(d - 2) < 0.01) out.push([i, j]);
  }
  return out;
}

type Stage = { frame: (dt: number, burst: number) => void; resize: () => void; dispose: () => void };

async function build(host: HTMLDivElement): Promise<Stage> {
  const THREE_ = await import("three");
  const pts = atoms();
  const links = bonds(pts);
  const R = Math.hypot(...pts[0]);

  const renderer = new THREE_.WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = THREE_.SRGBColorSpace;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE_.Scene();
  const camera = new THREE_.PerspectiveCamera(32, 1, 0.1, 200);
  camera.position.set(0, 0, 5.4 * R);
  scene.add(new THREE_.HemisphereLight(0xffffff, 0xc9d3cf, 1.4));
  const sun = new THREE_.DirectionalLight(0xffffff, 2.2);
  sun.position.set(-3, 4, 6);
  scene.add(sun);

  const ball = new THREE_.Group();
  ball.rotation.set(0.4, 0.2, 0);
  scene.add(ball);

  // Atoms: one instanced sphere, two greens so the cage reads in depth.
  // Atoms flare a warm white when the cage bursts (see `frame`); otherwise unlit by themselves.
  const atomMat = new THREE_.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05, transparent: true, emissive: 0xfff1c2, emissiveIntensity: 0 });
  const atomMesh = new THREE_.InstancedMesh(new THREE_.SphereGeometry(0.42, 24, 16), atomMat, pts.length);
  const green = new THREE_.Color(0x0e7c72), deep = new THREE_.Color(0x0a5d55);
  pts.forEach((_, i) => atomMesh.setColorAt(i, i % 3 ? green : deep));
  ball.add(atomMesh);

  // Bonds: one instanced cylinder, stretched and aimed between each pair.
  const bondMat = new THREE_.MeshStandardMaterial({ color: 0xb9dcd3, roughness: 0.5, transparent: true });
  const bondMesh = new THREE_.InstancedMesh(new THREE_.CylinderGeometry(0.11, 0.11, 1, 10), bondMat, links.length);
  ball.add(bondMesh);

  // The burst's flash: a warm light at the heart of the cage...
  const core = new THREE_.PointLight(0xfff1c2, 0, R * 6, 1.5);
  ball.add(core);

  // ...and a yellowish-white bloom behind it, a radial fade painted once onto a canvas.
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = glowCanvas.height = 256;
  const g = glowCanvas.getContext("2d")!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, "rgba(255, 252, 235, 0.95)");
  grad.addColorStop(0.35, "rgba(255, 238, 170, 0.55)");
  grad.addColorStop(1, "rgba(255, 232, 150, 0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const glowTex = new THREE_.CanvasTexture(glowCanvas);
  glowTex.colorSpace = THREE_.SRGBColorSpace;
  const glowMat = new THREE_.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0 });
  const halo = new THREE_.Sprite(glowMat);
  halo.position.z = -R * 0.6;
  halo.renderOrder = -1;
  scene.add(halo);

  // Each atom flies out along its own direction, a little faster or slower than the rest.
  const dirs = pts.map(([x, y, z]) => new THREE_.Vector3(x, y, z).normalize());
  const speed = pts.map((_, i) => 0.7 + ((i * 37) % 11) / 11 * 0.8);

  const m = new THREE_.Matrix4(), q = new THREE_.Quaternion(), sc = new THREE_.Vector3();
  const a = new THREE_.Vector3(), b = new THREE_.Vector3(), mid = new THREE_.Vector3(), yAxis = new THREE_.Vector3(0, 1, 0);
  const placed = pts.map(() => new THREE_.Vector3());

  const frame = (dt: number, burst: number) => {
    // The flash: nothing at rest, a yellowish-white burst of light as the cage
    // breaks (peaking early, then gone), swelling outward with the atoms.
    const flash = burst > 0 ? Math.sin(Math.min(1, burst / 0.5) * Math.PI) : 0;
    atomMat.emissiveIntensity = 1.4 * flash;
    core.intensity = 45 * flash;
    halo.scale.setScalar(R * (2.5 + 7 * flash + 2 * burst));
    glowMat.opacity = flash;

    ball.rotation.y += dt * (0.35 + burst * 1.2);
    ball.rotation.x += dt * 0.08;
    const e = burst * burst; // slow start, then fast: a burst, not a drift
    pts.forEach(([x, y, z], i) => {
      placed[i].set(x, y, z).addScaledVector(dirs[i], e * R * 3.2 * speed[i]);
      const s = 1 - Math.max(0, burst - 0.55) / 0.45 * 0.6;
      m.compose(placed[i], q.identity(), sc.setScalar(s));
      atomMesh.setMatrixAt(i, m);
    });
    atomMesh.instanceMatrix.needsUpdate = true;
    atomMat.opacity = 1 - Math.max(0, burst - 0.5) / 0.5;

    links.forEach(([i, j], k) => {
      a.copy(placed[i]); b.copy(placed[j]);
      mid.addVectors(a, b).multiplyScalar(0.5);
      const len = a.distanceTo(b);
      q.setFromUnitVectors(yAxis, b.sub(a).normalize());
      m.compose(mid, q, sc.set(1, len, 1));
      bondMesh.setMatrixAt(k, m);
    });
    bondMesh.instanceMatrix.needsUpdate = true;
    bondMat.opacity = Math.max(0, 1 - burst * 2.4); // bonds snap first
    renderer.render(scene, camera);
  };

  const resize = () => {
    const w = host.clientWidth, h = host.clientHeight;
    if (!w || !h) return;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize();

  return {
    frame,
    resize,
    dispose: () => {
      atomMesh.geometry.dispose(); bondMesh.geometry.dispose(); atomMat.dispose(); bondMat.dispose();
      glowTex.dispose(); glowMat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * A slowly turning C60 cage in the site's greens. `burst` (0–1, from the page's
 * scroll) blows it apart in a yellowish-white flash: bonds snap first, then the
 * atoms fly outward and fade.
 * three.js loads on demand; the loop runs only while it can be seen.
 */
export function Fullerene({ burst, className }: { burst: MotionValue<number>; className?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const inView = useInView(host, { amount: 0.1 });
  const visible = usePageVisible();
  const reduce = useReducedMotion() ?? false;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let dead = false;
    const el = host.current!;
    build(el).then((s) => {
      if (dead) return s.dispose();
      stage.current = s;
      s.frame(0, burst.get());
      setReady(true);
    }).catch(() => { /* No WebGL: the headline still lands. */ });
    const ro = new ResizeObserver(() => { stage.current?.resize(); stage.current?.frame(0, burst.get()); });
    ro.observe(el);
    return () => { dead = true; ro.disconnect(); stage.current?.dispose(); stage.current = null; };
  }, [burst]);

  useEffect(() => {
    if (!ready || !inView || !visible) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      stage.current?.frame(reduce ? 0 : Math.min((now - last) / 1000, 0.05), burst.get());
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, inView, visible, reduce, burst]);

  return <div ref={host} aria-hidden className={cn("transition-opacity duration-700", ready ? "opacity-100" : "opacity-0", className)} />;
}
