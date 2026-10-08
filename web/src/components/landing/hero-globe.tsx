"use client";

import { motion, useInView, useMotionValue, useReducedMotion, useTransform, type MotionValue } from "motion/react";
import NumberFlow from "@number-flow/react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type * as THREE from "three";
import { cn } from "@/lib/cn";
import { usePageVisible } from "./hero-demo";

// A real, lit 3D earth (three.js): a pale marble ocean, leafy green continents
// traced from Natural Earth, slowly turning. A factory in South America, and an
// offshore rig and two container ships across the Pacific, turn with it and
// smoke; one truck drives over it from the far side to the near side, one plane
// circles higher up, and both leave puffs behind. Gas tags float beside it and
// tick their numbers.
//
// three.js and the map are loaded on demand so they never weigh on other pages.

export const TICK = 1800;
export const TAGS = [
  { gas: "CO₂", values: [2.4, 2.7, 2.5, 3.1, 2.8, 2.6], dot: "bg-signal", pos: "left-[4%] top-[20%]", bob: "" },
  { gas: "N₂O", values: [0.31, 0.28, 0.34, 0.3, 0.36, 0.29], dot: "bg-tier2", pos: "right-[2%] top-[44%]", bob: "hg-bob-b" },
  { gas: "CH₄", values: [1.12, 1.2, 1.05, 1.18, 1.09, 1.24], dot: "bg-attention-strong", pos: "left-[10%] bottom-[14%]", bob: "hg-bob-c" },
] as const;

type Stage = { frame: (dt: number, boost?: number) => void; resize: () => void; dispose: () => void };

/** Paints the colour, bump and roughness maps for the earth from the land outline. */
async function paintEarth() {
  const [{ feature }, topo] = await Promise.all([import("topojson-client"), import("world-atlas/land-110m.json")]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (topo as any).default ?? topo;
  const land = feature(t, t.objects.land) as unknown as GeoJSON.FeatureCollection | GeoJSON.Feature;
  const geoms = "features" in land ? land.features.map((f) => f.geometry) : [land.geometry];

  const W = 2048, H = 1024;
  const canvas = () => { const c = document.createElement("canvas"); c.width = W; c.height = H; return c; };
  const px = (lon: number) => ((lon + 180) / 360) * W;
  const py = (lat: number) => ((90 - lat) / 180) * H;
  const landPath = new Path2D();
  for (const g of geoms) {
    if (!g) continue;
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const poly of polys) for (const ring of poly) {
      // Unwrap longitudes so a ring crossing the date line stays continuous, then
      // draw it at both wraps: otherwise it streaks a line across the whole map.
      let prev = ring[0][0], shift = 0;
      const pts = ring.map(([lon, lat]) => {
        if (lon - prev > 180) shift -= 360; else if (prev - lon > 180) shift += 360;
        prev = lon;
        return [lon + shift, lat] as const;
      });
      for (const off of [-360, 0, 360]) {
        pts.forEach(([lon, lat], i) => (i ? landPath.lineTo(px(lon + off), py(lat)) : landPath.moveTo(px(lon + off), py(lat))));
        landPath.closePath();
      }
    }
  }

  // Seeded random so the planet looks the same on every visit.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

  // Land mask, for testing where foliage may grow.
  const mask = canvas();
  const m = mask.getContext("2d", { willReadFrequently: true })!;
  m.fillStyle = "#000"; m.fillRect(0, 0, W, H);
  m.fillStyle = "#fff"; m.fill(landPath);
  const maskData = m.getImageData(0, 0, W, H).data;
  const onLand = (x: number, y: number) => maskData[((y | 0) * W + (x | 0)) * 4] > 128;

  // Colour: marble ocean with mint shallows, then foliage clumps on land.
  const color = canvas();
  const c = color.getContext("2d")!;
  c.fillStyle = "#e8ebe9"; c.fillRect(0, 0, W, H);
  c.filter = "blur(18px)";
  for (let i = 0; i < 40; i++) {
    c.fillStyle = rnd() < 0.5 ? "rgba(196,226,214,0.55)" : "rgba(210,214,212,0.6)";
    c.beginPath(); c.ellipse(rnd() * W, rnd() * H, 60 + rnd() * 160, 30 + rnd() * 80, rnd() * Math.PI, 0, Math.PI * 2); c.fill();
  }
  c.filter = "blur(4px)";
  for (let i = 0; i < 70; i++) {
    c.strokeStyle = `rgba(150,160,158,${0.12 + rnd() * 0.18})`; c.lineWidth = 1 + rnd() * 4;
    c.beginPath(); let x = rnd() * W, y = rnd() * H; c.moveTo(x, y);
    for (let k = 0; k < 4; k++) { const nx = x + (rnd() - 0.5) * 400, ny = y + (rnd() - 0.5) * 160; c.quadraticCurveTo(x + (rnd() - 0.5) * 200, y + (rnd() - 0.5) * 120, nx, ny); x = nx; y = ny; }
    c.stroke();
  }
  c.filter = "blur(22px)"; c.strokeStyle = "rgba(150,212,190,0.75)"; c.lineWidth = 34; c.stroke(landPath);
  c.filter = "none";
  c.fillStyle = "rgba(110,118,116,0.45)";
  for (let i = 0; i < 1800; i++) { c.beginPath(); c.arc(rnd() * W, rnd() * H, 0.6 + rnd() * 1.4, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = "#4d7f26"; c.fill(landPath);

  // Bump: land raised, each foliage clump a little dome.
  const bump = canvas();
  const b = bump.getContext("2d")!;
  b.fillStyle = "#000"; b.fillRect(0, 0, W, H);
  b.fillStyle = "#555"; b.fill(landPath);

  const greens = ["#3e6d1d", "#4f8526", "#62992f", "#77ad3a", "#8dbf48", "#5a8f2a"];
  for (let i = 0; i < 60000; i++) {
    const x = rnd() * W, y = rnd() * H;
    if (!onLand(x, y)) continue;
    const r = 2.5 + rnd() * 6;
    c.fillStyle = greens[(rnd() * greens.length) | 0];
    c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    // A highlight on the upper left of each clump sells the foliage.
    c.fillStyle = "rgba(200,230,140,0.35)";
    c.beginPath(); c.arc(x - r * 0.3, y - r * 0.3, r * 0.4, 0, Math.PI * 2); c.fill();
    const v = 140 + ((rnd() * 115) | 0);
    b.fillStyle = `rgb(${v},${v},${v})`;
    b.beginPath(); b.arc(x, y, r, 0, Math.PI * 2); b.fill();
  }
  const bumpSoft = canvas();
  const bs = bumpSoft.getContext("2d")!;
  bs.filter = "blur(1.5px)"; bs.drawImage(bump, 0, 0);

  // Roughness: glossy ocean, matte land.
  const rough = canvas();
  const r = rough.getContext("2d")!;
  r.fillStyle = "#4a4a4a"; r.fillRect(0, 0, W, H);
  r.fillStyle = "#fff"; r.fill(landPath);

  return { color, bump: bumpSoft, rough };
}

// Painting the maps is the slow part; do it once per page load, even if the
// globe mounts twice (React's dev double-mount, or navigating back to /).
let painted: ReturnType<typeof paintEarth> | null = null;

async function buildStage(host: HTMLDivElement): Promise<Stage> {
  const THREE = await import("three");
  const maps = await (painted ??= paintEarth());

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.width = "100%";
  renderer.domElement.style.height = "100%";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.35, 5.6);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9d3cf, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.4);
  sun.position.set(-3, 4, 5);
  scene.add(sun);

  const tex = (cv: HTMLCanvasElement, srgb = false) => {
    const t = new THREE.CanvasTexture(cv);
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return t;
  };
  const colorMap = tex(maps.color, true), bumpMap = tex(maps.bump), roughMap = tex(maps.rough);

  // Earth, tilted on its axis.
  const tilt = new THREE.Group();
  tilt.rotation.z = 0.32;
  scene.add(tilt);
  const earth = new THREE.Mesh(
    new THREE.SphereGeometry(1, 320, 160),
    new THREE.MeshStandardMaterial({
      map: colorMap, bumpMap, bumpScale: 4, displacementMap: bumpMap, displacementScale: 0.035,
      roughnessMap: roughMap, roughness: 1, metalness: 0,
    }),
  );
  earth.rotation.y = -1.2;
  tilt.add(earth);

  const mat = (color: number, rough = 0.6) => new THREE.MeshStandardMaterial({ color, roughness: rough });
  const box = (w: number, h: number, d: number, m: THREE.Material) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);

  // Truck, built along +z (its direction of travel), wheels on y = 0.
  const truck = new THREE.Group();
  {
    const trailer = box(0.075, 0.075, 0.15, mat(0xf2b705, 0.45)); trailer.position.set(0, 0.058, -0.03);
    const stripe = box(0.077, 0.012, 0.152, mat(0xfffefc)); stripe.position.set(0, 0.045, -0.03);
    const cab = box(0.072, 0.06, 0.05, mat(0x2b2b29, 0.4)); cab.position.set(0, 0.05, 0.075);
    const glass = box(0.066, 0.028, 0.004, mat(0xcfe7e2, 0.15)); glass.position.set(0, 0.062, 0.1);
    truck.add(trailer, stripe, cab, glass);
    const wheelGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.012, 16);
    const wheelMat = mat(0x171716, 0.8);
    for (const z of [-0.08, -0.04, 0.075]) for (const x of [-0.04, 0.04]) {
      const w = new THREE.Mesh(wheelGeo, wheelMat); w.rotation.z = Math.PI / 2; w.position.set(x, 0.016, z); truck.add(w);
    }
  }
  // Rides a great circle: spinning about x carries it over the far side and down toward us.
  const truckOrbit = new THREE.Group();
  truckOrbit.rotation.set(0, 0.5, -0.55);
  const truckSpin = new THREE.Group();
  truck.position.set(0, 1.025, 0);
  truck.scale.setScalar(1.6);
  truckSpin.add(truck);
  truckOrbit.add(truckSpin);
  scene.add(truckOrbit);

  // Plane, built along +z.
  const plane = new THREE.Group();
  {
    const body = mat(0xfffefc, 0.35);
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.13, 6, 12), body); fus.rotation.x = Math.PI / 2;
    const wing = box(0.2, 0.006, 0.04, body); wing.position.set(0, 0, 0.005);
    const tail = box(0.07, 0.005, 0.022, body); tail.position.set(0, 0, -0.075);
    const fin = box(0.005, 0.04, 0.025, mat(0x0e7c72, 0.4)); fin.position.set(0, 0.022, -0.075);
    plane.add(fus, wing, tail, fin);
  }
  const planeOrbit = new THREE.Group();
  planeOrbit.rotation.set(0, -0.6, 0.75);
  const planeSpin = new THREE.Group();
  plane.position.set(0, 1.32, 0);
  plane.scale.setScalar(1.3);
  planeSpin.add(plane);
  planeOrbit.add(planeSpin);
  scene.add(planeOrbit);

  // A factory stands on the land and turns with the earth; each chimney smokes.
  // (Ships and the rig below join `chimneyTops`, so they smoke too.)
  // Placed by latitude and longitude, matching how the equirectangular map wraps the sphere.
  const onSurface = (lat: number, lon: number, r: number) => {
    const phi = ((lon + 180) * Math.PI) / 180, theta = ((90 - lat) * Math.PI) / 180;
    return new THREE.Vector3(-Math.cos(phi) * Math.sin(theta), Math.cos(theta), Math.sin(phi) * Math.sin(theta)).multiplyScalar(r);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const chimneyTops: THREE.Object3D[] = [];
  const factory = (lat: number, lon: number) => {
    const f = new THREE.Group();
    const wall = mat(0xe9e7e2, 0.7), roof = mat(0x6f6e69, 0.6), brick = mat(0xb3452f, 0.6), band = mat(0xfffefc, 0.5);
    const hall = box(0.1, 0.04, 0.065, wall); hall.position.y = 0.02;
    f.add(hall);
    // Sawtooth roof: three tilted slabs.
    for (const x of [-0.033, 0, 0.033]) {
      const slab = box(0.033, 0.004, 0.068, roof); slab.position.set(x, 0.047, 0); slab.rotation.z = 0.45; f.add(slab);
    }
    const office = box(0.04, 0.026, 0.05, wall); office.position.set(0.07, 0.013, 0.005); f.add(office);
    for (const [x, z, h] of [[-0.03, -0.02, 0.11], [0.0, -0.02, 0.085]] as const) {
      const stack = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.011, h, 14), brick);
      stack.position.set(x, h / 2, z); f.add(stack);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.0085, 0.0085, 0.008, 14), band);
      stripe.position.set(x, h - 0.012, z); f.add(stripe);
      const top = new THREE.Object3D(); top.position.set(x, h + 0.004, z); f.add(top);
      chimneyTops.push(top);
    }
    f.scale.setScalar(1.6);
    const n = onSurface(lat, lon, 1.02);
    f.position.copy(n);
    f.quaternion.setFromUnitVectors(up, n.clone().normalize());
    earth.add(f);
  };
  factory(-22, -47); // São Paulo

  // The Pacific is a long stretch of open ocean as the earth turns, so it gets the
  // industry that lives at sea: an offshore rig with a flare, and container ships.
  const place = (g: THREE.Group, lat: number, lon: number, r: number, heading = 0) => {
    const n = onSurface(lat, lon, r);
    g.position.copy(n);
    g.quaternion.setFromUnitVectors(up, n.clone().normalize());
    g.rotateY(heading);
    g.scale.setScalar(1.6);
    earth.add(g);
  };

  const rig = (lat: number, lon: number) => {
    const g = new THREE.Group();
    const steel = mat(0x6f6e69, 0.5), white = mat(0xe9e7e2, 0.6), red = mat(0xb3452f, 0.55);
    for (const [x, z] of [[-0.026, -0.02], [0.026, -0.02], [-0.026, 0.02], [0.026, 0.02]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.055, 10), steel);
      leg.position.set(x, 0.0175, z); g.add(leg);
    }
    const deck = box(0.078, 0.009, 0.062, steel); deck.position.y = 0.045; g.add(deck);
    const quarters = box(0.032, 0.022, 0.026, white); quarters.position.set(0.016, 0.06, 0.012); g.add(quarters);
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.003, 18), mat(0x0e7c72, 0.5)); pad.position.set(0.016, 0.073, 0.012); g.add(pad);
    const derrick = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.012, 0.07, 4), red); derrick.position.set(-0.018, 0.084, -0.012); g.add(derrick);
    // Flare boom leaning out over the water, a small flame and smoke at its tip.
    const boom = box(0.05, 0.004, 0.004, steel); boom.position.set(0.055, 0.058, -0.015); boom.rotation.z = 0.55; g.add(boom);
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.006, 0.016, 10),
      new THREE.MeshStandardMaterial({ color: 0xf2b705, emissive: 0xf2b705, emissiveIntensity: 0.7, roughness: 0.4 }),
    );
    flame.position.set(0.077, 0.079, -0.015); g.add(flame);
    const tip = new THREE.Object3D(); tip.position.set(0.077, 0.09, -0.015); g.add(tip);
    chimneyTops.push(tip);
    place(g, lat, lon, 1.0);
  };

  const ship = (lat: number, lon: number, heading: number) => {
    const g = new THREE.Group();
    const hull = box(0.17, 0.022, 0.042, mat(0x2b2b29, 0.5)); hull.position.y = 0.007; g.add(hull);
    const stripe = box(0.172, 0.006, 0.044, mat(0xb3452f, 0.6)); stripe.position.y = -0.002; g.add(stripe);
    // Containers in the site's colours, some stacked two high.
    const colours = [0x0e7c72, 0xf2b705, 0xb3452f, 0x4b5f8a, 0xe9e7e2, 0x0a5d55];
    for (let k = 0; k < 4; k++) {
      const x = -0.058 + k * 0.03;
      for (const [z, lvl] of [[-0.01, 0], [0.01, 0], [0, 1]] as const) {
        if (lvl === 1 && k % 2) continue;
        const c = box(0.026, 0.015, 0.018, mat(colours[(k * 3 + lvl + (z > 0 ? 1 : 0)) % colours.length], 0.6));
        c.position.set(x, 0.026 + lvl * 0.016, lvl ? 0 : z); g.add(c);
      }
    }
    const bridge = box(0.022, 0.032, 0.036, mat(0xfffefc, 0.5)); bridge.position.set(0.064, 0.034, 0); g.add(bridge);
    const funnel = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.006, 0.02, 12), mat(0xb3452f, 0.5)); funnel.position.set(0.064, 0.06, 0); g.add(funnel);
    const top = new THREE.Object3D(); top.position.set(0.064, 0.072, 0); g.add(top);
    chimneyTops.push(top);
    place(g, lat, lon, 1.0, heading);
  };

  rig(19, -152); // off Hawaii
  ship(4, -172, 0.4); // mid-Pacific
  ship(-14, -128, -0.3); // eastern Pacific

  // A marker in the middle of the Pacific: while it faces the camera the earth
  // spins faster, so the long stretch of open ocean goes by quickly.
  const pacific = new THREE.Object3D();
  pacific.position.copy(onSurface(0, -165, 1));
  earth.add(pacific);
  const pacificAt = new THREE.Vector3();
  let spin = 1; // current speed multiplier, eased toward its target

  // Puffs: a small pool of spheres that drift away from the earth, grow and fade.
  const puffGeo = new THREE.SphereGeometry(1, 12, 8);
  type Puff = { mesh: THREE.Mesh; mat: THREE.MeshStandardMaterial; age: number; life: number; vel: THREE.Vector3; size: number; alpha: number };
  const puffs: Puff[] = [];
  for (let i = 0; i < 120; i++) {
    const pm = new THREE.MeshStandardMaterial({ color: 0xb9bdbb, roughness: 1, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(puffGeo, pm); mesh.visible = false; scene.add(mesh);
    puffs.push({ mesh, mat: pm, age: 1, life: 1, vel: new THREE.Vector3(), size: 0.01, alpha: 0.85 });
  }
  let next = 0;
  const tmp = new THREE.Vector3();
  const emit = (from: THREE.Object3D, local: THREE.Vector3, size: number, life: number, color: number, alpha = 0.85) => {
    const p = puffs[next]; next = (next + 1) % puffs.length;
    from.localToWorld(tmp.copy(local));
    p.mesh.position.copy(tmp);
    p.vel.copy(tmp).normalize().multiplyScalar(0.09);
    p.age = 0; p.life = life; p.size = size; p.alpha = alpha; p.mesh.visible = true; p.mat.color.setHex(color);
  };

  let tTruck = 0.15, tPlane = 0.4, sinceTruck = 0, sincePlane = 0, sinceSmoke = 0;
  const origin = new THREE.Vector3();
  const truckExhaust = new THREE.Vector3(0.025, 0.1, -0.1);
  const planeTrail = new THREE.Vector3(0, 0, -0.1);

  const frame = (dt: number, boost = 0) => {
    // `boost` (0–3) comes from scroll speed: the earth spins up while the page moves.
    // Facing: 0 when the Pacific is round the side or behind, 1 when it faces us.
    pacific.getWorldPosition(pacificAt);
    const facing = Math.min(1, Math.max(0, (pacificAt.z - 0.15) / 0.6));
    spin += ((1 + 3.5 * facing) - spin) * Math.min(1, dt * 3);
    earth.rotation.y += dt * (0.12 * spin + boost * 0.9);
    tTruck += dt / 11;
    tPlane += dt / 7;
    truckSpin.rotation.x = tTruck * Math.PI * 2;
    planeSpin.rotation.x = tPlane * Math.PI * 2;
    sinceTruck += dt; sincePlane += dt;
    if (dt > 0 && sinceTruck > 0.22) { sinceTruck = 0; emit(truck, truckExhaust, 0.014, 1.6, 0xa9aeac); }
    if (dt > 0 && sincePlane > 0.09) { sincePlane = 0; emit(plane, planeTrail, 0.008, 1.1, 0xe2e5e3); }
    sinceSmoke += dt;
    if (dt > 0 && sinceSmoke > 0.16) {
      sinceSmoke = 0;
      for (const top of chimneyTops) emit(top, origin, 0.018 + Math.random() * 0.01, 2.6, 0xd4d8d6, 0.55);
    }
    for (const p of puffs) {
      if (!p.mesh.visible) continue;
      p.age += dt;
      const k = p.age / p.life;
      if (k >= 1) { p.mesh.visible = false; continue; }
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.scale.setScalar(p.size * (1 + k * 1.8));
      p.mat.opacity = p.alpha * (1 - k);
    }
    renderer.render(scene, camera);
  };

  const resize = () => {
    const s = host.clientWidth;
    if (!s) return;
    // A very large globe at 2x would push ~9M pixels a frame; cap the drawing buffer.
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2, 2400 / s));
    renderer.setSize(s, s, false);
  };
  resize();

  return {
    frame,
    resize,
    dispose: () => {
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry?.dispose();
        const m = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(m)) m.forEach((x) => x.dispose()); else m?.dispose();
      });
      [colorMap, bumpMap, roughMap].forEach((t) => t.dispose());
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}

/**
 * `reveal` (0–1) draws the orbit ring and brings in the gas tags; `boost` is a
 * spin-up from scroll speed; `tagScale` undoes any scale the parent applies, so the
 * tags stay readable. All optional: without them the globe stands alone.
 */
export function HeroGlobe({ className, reveal, boost, tagScale }: { className?: string; reveal?: MotionValue<number>; boost?: MotionValue<number>; tagScale?: MotionValue<number> }) {
  const t = useTranslations("landing.globe");
  const locale = useLocale();
  const ref = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const stage = useRef<Stage | null>(null);
  const inView = useInView(ref, { amount: 0.15 });
  const visible = usePageVisible();
  const reduce = useReducedMotion() ?? false;
  const running = inView && visible && !reduce;
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);

  // Build once; tear down on unmount.
  useEffect(() => {
    let dead = false;
    const el = host.current!;
    buildStage(el)
      .then((s) => {
        if (dead) return s.dispose();
        stage.current = s;
        s.frame(0);
        setReady(true);
      })
      .catch(() => { /* No WebGL: the tags still tell the story. */ });
    const ro = new ResizeObserver(() => { stage.current?.resize(); stage.current?.frame(0); });
    ro.observe(el);
    return () => { dead = true; ro.disconnect(); stage.current?.dispose(); stage.current = null; };
  }, []);

  // Run the loop only while it can be seen.
  useEffect(() => {
    if (!running || !ready) return;
    let raf = 0, last = performance.now();
    const loop = (now: number) => {
      stage.current?.frame(Math.min((now - last) / 1000, 0.05), boost?.get() ?? 0);
      last = now;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const id = setInterval(() => setTick((n) => n + 1), TICK);
    return () => { cancelAnimationFrame(raf); clearInterval(id); };
  }, [running, ready, boost]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={t("aria")}
      data-paused={running ? undefined : ""}
      data-still={reduce ? "" : undefined}
      className={cn("hero-globe relative aspect-square w-full select-none", className)}
    >
      <div ref={host} aria-hidden className={cn("absolute inset-0 transition-opacity duration-700", ready ? "opacity-100" : "opacity-0")} />
      <Ledger reveal={reveal} tick={tick} locale={locale} tagScale={tagScale} />
    </div>
  );
}


/** The orbit ring and gas tags: the accounting laid over the world. */
function Ledger({ reveal, tick, locale, tagScale }: { reveal?: MotionValue<number>; tick: number; locale: string; tagScale?: MotionValue<number> }) {
  const shown = useMotionValue(1);
  const r = reveal ?? shown;
  const ring = useTransform(r, (v) => Math.min(1, v / 0.6));
  const tags = useTransform(r, (v) => Math.min(1, Math.max(0, (v - 0.4) / 0.6)));
  return (
    <>
      <svg viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full -rotate-90" aria-hidden>
        <motion.circle
          cx={50} cy={50} r={44} fill="none" stroke="var(--line-strong)" strokeWidth={0.2}
          strokeLinecap="round" style={{ pathLength: ring, opacity: ring }}
        />
      </svg>
      <motion.div className="absolute inset-0" style={{ opacity: tags }}>
        {TAGS.map((g) => (
          <motion.div key={g.gas} className={cn("absolute", g.pos)} style={tagScale ? { scale: tagScale } : undefined}>
            <Tag label={g.gas} value={g.values[tick % g.values.length]} dot={g.dot} bob={g.bob} locale={locale} />
          </motion.div>
        ))}
      </motion.div>
    </>
  );
}

/** A floating pill: coloured dot, label, ticking value in tonnes. Bobs when inside `.hero-globe`. */
export function Tag({ label, value, dot, bob, locale, unit = "t", digits = 2 }: { label: string; value: number; dot: string; bob: string; locale: string; unit?: string; digits?: number }) {
  return (
    <div className={cn("hg-bob card flex items-center gap-1.5 rounded-full px-2.5 py-1 shadow-[var(--shadow-float)]", bob)}>
      <span className={cn("size-1.5 rounded-full", dot)} aria-hidden />
      <span className="text-[11px] font-semibold text-ink">{label}</span>
      <span className="font-mono text-[11px] text-ink-soft">
        <NumberFlow value={value} locales={locale} format={{ minimumFractionDigits: 1, maximumFractionDigits: digits }} trend={0} /> {unit}
      </span>
    </div>
  );
}
