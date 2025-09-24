"use client";
import React, { useEffect, useMemo, useRef, useState, forwardRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type Category = {
  id: string;
  label: string;
  neonColor: string;
};

export type Pin = {
  id: string;
  name: string;
  categoryId: string;
  yaw: number;
  pitch: number;
  cardImage: string;
  distanceKm: number;
  durationMin: number;
  hoverOverlayPng?: string;
};

function yawPitchToVector3(yawDeg: number, pitchDeg: number, radius: number) {
  const yaw = THREE.MathUtils.degToRad(yawDeg);
  const pitch = THREE.MathUtils.degToRad(pitchDeg);
  const x = -radius * Math.cos(pitch) * Math.sin(yaw);
  const y = radius * Math.sin(pitch);
  const z = -radius * Math.cos(pitch) * Math.cos(yaw);
  return new THREE.Vector3(x, y, z);
}

const PinDot = forwardRef<HTMLButtonElement, {
  color: string;
  label: string;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
}>(({ color, label, onEnter, onLeave, onClick }, ref) => (
  <button
    ref={ref}
    className="group absolute pointer-events-auto -translate-x-1/2 -translate-y-1/2 rounded-full p-2 focus:outline-none"
    onMouseEnter={onEnter}
    onMouseLeave={onLeave}
    onFocus={onEnter}
    onBlur={onLeave}
    onClick={onClick}
    aria-label={label}
    style={{ left: 0, top: 0, transform: "translate(-50%, -50%) translate3d(0px,0px,0)" }}
  >
    <span
      className="block h-4 w-4 rounded-full shadow-[0_0_12px_2px_var(--pin)] ring-2"
      style={{ background: "#fff", boxShadow: `0 0 16px 3px ${color}`, borderColor: color }}
    />
    <span className="absolute left-1/2 top-[-22px] -translate-x-1/2 whitespace-nowrap rounded-md bg-black/70 px-2 py-0.5 text-xs text-white opacity-0 backdrop-blur-sm transition group-hover:opacity-100">
      {label}
    </span>
  </button>
));
PinDot.displayName = "PinDot";

export default function Pano360({
  panoramaSrc,
  pins,
  categories,
  initialYaw = 0,
  initialPitch = 0,
  initialFov = 65,
  autoRotate = true,
  rotationSpeed = 0.5,
  projectLogo = "/images/project-logo.png",
  companyLogo = "/images/company-logo.png",
}: {
  panoramaSrc: string;
  pins: Pin[];
  categories: Category[];
  initialYaw?: number;
  initialPitch?: number;
  initialFov?: number;
  autoRotate?: boolean;
  rotationSpeed?: number;
  projectLogo?: string;
  companyLogo?: string;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const overlaySphereRef = useRef<THREE.Mesh | null>(null);
  const overlayTexturesRef = useRef<Map<string, THREE.Texture>>(new Map());
  const loadingManagerRef = useRef<THREE.LoadingManager | null>(null);
  const overlayLoaderRef = useRef<THREE.TextureLoader | null>(null);
  const pinRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const filteredPinsRef = useRef<Pin[]>([]);

  const [enabledCats, setEnabledCats] = useState<Set<string>>(
    () => new Set(categories.map((c) => c.id))
  );
  const [hoveredPinId, setHoveredPinId] = useState<string | null>(null);
  const hoveredPin = useMemo(() => pins.find((p) => p.id === hoveredPinId) || null, [hoveredPinId, pins]);

  const catMap = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const filteredPins = useMemo(
    () => pins.filter((p) => enabledCats.has(p.categoryId)),
    [pins, enabledCats]
  );

  useEffect(() => {
    filteredPinsRef.current = filteredPins;
  }, [filteredPins]);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(initialFov, 1, 0.1, 2000);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    rendererRef.current = renderer;

    const mount = mountRef.current;
    mount.innerHTML = "";
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableZoom = false;
    controls.enableDamping = true;
    controls.rotateSpeed = 0.15;
    controls.dampingFactor = 0.06;
    controls.enablePan = false;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = rotationSpeed;

    const radius = 500;
    const geo = new THREE.SphereGeometry(radius, 64, 64);
    const tex = new THREE.TextureLoader().load(panoramaSrc);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);

    const overlayGeo = new THREE.SphereGeometry(radius - 1, 64, 64);
    const overlayMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false });
    const overlaySphere = new THREE.Mesh(overlayGeo, overlayMat);
    overlaySphere.visible = false;
    overlaySphereRef.current = overlaySphere;
    scene.add(overlaySphere);

    controls.target.set(0, 0, 0);
    const dir = yawPitchToVector3(initialYaw, initialPitch, 1).normalize();
    camera.position.copy(dir.multiplyScalar(-0.1));
    camera.lookAt(0, 0, 0);
    camera.fov = initialFov;
    camera.updateProjectionMatrix();

    const onResize = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height || 1;
      camera.updateProjectionMatrix();
    };
    onResize();
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(mount);

    const updatePinPositions = () => {
      const width = mount.clientWidth;
      const height = mount.clientHeight;
      const pinsNow = filteredPinsRef.current;
      for (let i = 0; i < pinsNow.length; i++) {
        const p = pinsNow[i];
        const world = yawPitchToVector3(p.yaw, p.pitch, radius - 0.1);
        const projected = world.clone().project(camera);
        const x = (projected.x * 0.5 + 0.5) * width;
        const y = (-projected.y * 0.5 + 0.5) * height;
        const visible = projected.z < 1 && projected.z > -1;
        const el = pinRefs.current[p.id];
        if (!el) continue;
        el.style.transform = `translate(-50%, -50%) translate3d(${x}px, ${y}px, 0)`;
        el.style.opacity = visible ? "1" : "0";
        el.style.pointerEvents = visible ? "auto" : "none";
      }
    };

    let rafId = 0;
    let stopped = false;
    const animate = () => {
      if (stopped) return;
      rafId = requestAnimationFrame(animate);
      controls.autoRotate = autoRotate;
      controls.autoRotateSpeed = rotationSpeed;
      controls.update();
      renderer.render(scene, camera);
      updatePinPositions();
    };
    animate();

    const onStart = () => (controls.autoRotate = false);
    const onEnd = () => (controls.autoRotate = autoRotate);
    controls.addEventListener("start", onStart);
    controls.addEventListener("end", onEnd);

    return () => {
      controls.removeEventListener("start", onStart);
      controls.removeEventListener("end", onEnd);
      resizeObserver.disconnect();
      stopped = true;
      cancelAnimationFrame(rafId);
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      tex.dispose();
      overlayGeo.dispose();
      const m = overlaySphere.material as THREE.MeshBasicMaterial;
      if (m.map) m.map.dispose();
      m.dispose();
    };
  }, [panoramaSrc, initialYaw, initialPitch, initialFov, autoRotate, rotationSpeed]);

  useEffect(() => {
    THREE.Cache.enabled = true;
    if (!loadingManagerRef.current) loadingManagerRef.current = new THREE.LoadingManager();
    if (!overlayLoaderRef.current) overlayLoaderRef.current = new THREE.TextureLoader(loadingManagerRef.current);
    const loader = overlayLoaderRef.current;
    pins.forEach((p) => {
      if (!p.hoverOverlayPng) return;
      if (overlayTexturesRef.current.has(p.hoverOverlayPng)) return;
      const t = loader.load(p.hoverOverlayPng);
      t.colorSpace = THREE.SRGBColorSpace;
      overlayTexturesRef.current.set(p.hoverOverlayPng, t);
    });
    return () => {};
  }, [pins]);

  useEffect(() => {
    const overlaySphere = overlaySphereRef.current;
    if (!overlaySphere) return;

    if (!hoveredPin || !hoveredPin.hoverOverlayPng) {
      (overlaySphere.material as THREE.MeshBasicMaterial).opacity = 0;
      overlaySphere.visible = false;
      return;
    }

    const map = overlayTexturesRef.current.get(hoveredPin.hoverOverlayPng);
    if (map) {
      (overlaySphere.material as THREE.MeshBasicMaterial).map = map;
      (overlaySphere.material as THREE.MeshBasicMaterial).opacity = 1;
      (overlaySphere.material as THREE.MeshBasicMaterial).needsUpdate = true;
      overlaySphere.visible = true;
    } else {
      const loader = overlayLoaderRef.current || new THREE.TextureLoader();
      const tex = loader.load(hoveredPin.hoverOverlayPng, () => {
        overlayTexturesRef.current.set(hoveredPin.hoverOverlayPng!, tex);
        (overlaySphere.material as THREE.MeshBasicMaterial).map = tex;
        (overlaySphere.material as THREE.MeshBasicMaterial).opacity = 1;
        (overlaySphere.material as THREE.MeshBasicMaterial).needsUpdate = true;
        overlaySphere.visible = true;
      });
      tex.colorSpace = THREE.SRGBColorSpace;
    }
  }, [hoveredPin]);

  const toggleCat = (id: string) => {
    setEnabledCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      if (hoveredPinId && !next.has(pins.find((p) => p.id === hoveredPinId)?.categoryId || "")) {
        setHoveredPinId(null);
      }
      return next;
    });
  };

  return (
    <div className="fixed inset-0 flex h-screen w-screen overflow-hidden bg-black">
      <div className="absolute inset-0" ref={mountRef} />
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-full">
        {filteredPins.map((p) => (
          <PinDot
            key={p.id}
            ref={(el) => (pinRefs.current[p.id] = el)}
            color={catMap.get(p.categoryId)?.neonColor || "#39FF14"}
            label={p.name}
            onEnter={() => setHoveredPinId(p.id)}
            onLeave={() => setHoveredPinId((cur) => (cur === p.id ? null : cur))}
            onClick={() => setHoveredPinId(p.id)}
          />
        ))}
      </div>
      <div className="absolute left-4 top-4 z-20 flex flex-wrap gap-2 rounded-2xl border border-white/20 bg-white/10 p-2 backdrop-blur-xl shadow-lg">
        {categories.map((c) => {
          const active = enabledCats.has(c.id);
          return (
            <button
              key={c.id}
              onClick={() => toggleCat(c.id)}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                active ? "bg-white/90 text-black" : "bg-black/50 text-white"
              }`}
              style={{ boxShadow: active ? `0 0 16px 2px ${c.neonColor}` : undefined, border: `1px solid ${c.neonColor}` }}
            >
              <span className="inline-block h-2 w-2 -translate-y-0.5 rounded-full" style={{ background: c.neonColor }} />
              <span className="ml-2">{c.label}</span>
            </button>
          );
        })}
      </div>
      {hoveredPin && (
        <aside className="absolute right-4 top-4 z-20 w-80 max-w-[90%] rounded-2xl border border-white/20 bg-white/10 p-4 shadow-xl ring-1 ring-white/10 backdrop-blur-xl">
          <div className="flex h-full flex-col">
            <div className="mb-3 flex items-center gap-2">
              <span
                className="inline-block h-3 w-3 rounded-full drop-shadow-[0_0_8px_rgba(255,255,255,0.6)]"
                style={{ background: catMap.get(hoveredPin.categoryId)?.neonColor || "#00E5FF", boxShadow: `0 0 12px 2px ${catMap.get(hoveredPin.categoryId)?.neonColor || "#00E5FF"}` }}
              />
              <h3 className="text-lg font-semibold leading-tight text-white">{hoveredPin.name}</h3>
            </div>
            <div className="relative mb-3 aspect-[4/3] w-full overflow-hidden rounded-xl border border-white/20 ring-1 ring-white/10">
              <img src={hoveredPin.cardImage} alt={hoveredPin.name} className="h-full w-full object-cover" />
            </div>
            <div className="mt-auto grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-black/40 p-3">
                <div className="text-xs text-neutral-300">Distance</div>
                <div className="text-base font-medium text-white">{hoveredPin.distanceKm.toFixed(1)} km</div>
              </div>
              <div className="rounded-lg bg-black/40 p-3">
                <div className="text-xs text-neutral-300">Drive time</div>
                <div className="text-base font-medium text-white">{hoveredPin.durationMin} min</div>
              </div>
            </div>
          </div>
        </aside>
      )}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-4">
        <img src={projectLogo} alt="Project Logo" className="h-12 w-auto object-contain drop-shadow-lg" />
        <img src={companyLogo} alt="Company Logo" className="h-12 w-auto object-contain drop-shadow-lg" />
      </div>
    </div>
  );
}

export const exampleCategories: Category[] = [
  { id: "gov", label: "Devlet Kurumları", neonColor: "#F4FF00" },
  { id: "mall", label: "AVM", neonColor: "#39FF14" },
  { id: "school", label: "Okul", neonColor: "#00E5FF" },
  { id: "hospital", label: "Hastane", neonColor: "#FF1744" },
  { id: "road", label: "Yollar / Mahalleler", neonColor: "#FF8C00" },
];

export const examplePins: Pin[] = [
  // DEVLET KURUMLARI
  {
    id: "gov1",
    name: "Havelsan",
    categoryId: "gov",
    yaw: -65,
    pitch: -10,
    cardImage: "/pins/HAVELSAN.jpeg",
    distanceKm:  1.7,
    durationMin: 5,
    hoverOverlayPng: "/overlays/havelsan.png",
  },
  {
    id: "gov2",
    name: "TC Çevre ve Şehircilik Bakanlığı",
    categoryId: "gov",
    yaw: 60,
    pitch: -4,
    cardImage: "/pins/tc-cevrevesehircilik.jpeg",
    distanceKm: 1.9,
    durationMin: 5,
    hoverOverlayPng: "/overlays/cevre.png",
  },
  {
    id: "gov3",
    name: "TC Tarım ve Orman Bakanlığı",
    categoryId: "gov",
    yaw: 73,
    pitch: -3,
    cardImage: "/pins/tarim.jpeg",
    distanceKm: 2.9,
    durationMin: 6,
    hoverOverlayPng: "/overlays/tctarimveorman.png",
  },
  {
    id: "gov4",
    name: "TC Diyanet İşleri Başkanlığı",
    categoryId: "gov",
    yaw: 33,
    pitch: -8,
    cardImage: "/pins/diyanetbaskanligi.jpeg",
    distanceKm: 3.7,
    durationMin: 7,
    hoverOverlayPng: "/overlays/diyanet.png",
  },
  {
    id: "gov5",
    name: "TOBB",
    categoryId: "gov",
    yaw: 50,
    pitch: -5,
    cardImage: "/pins/TOBB.jpeg",
    distanceKm: 1.1,
    durationMin: 3,
    hoverOverlayPng: "/overlays/TOBB.png",
  },

  // AVM
  {
    id: "mall1",
    name: "KentPark AVM",
    categoryId: "mall",
    yaw: -42,
    pitch: -7,
    cardImage: "/pins/kentparkavm.jpeg",
    distanceKm: 1.3,
    durationMin: 3,
    hoverOverlayPng: "/overlays/KENTPARKAVM.png",
  },
  {
    id: "mall2",
    name: "MAIDAN AVM",
    categoryId: "mall",
    yaw: 25,
    pitch: -14,
    cardImage: "/pins/maidanavm.jpeg",
    distanceKm: 0.9,
    durationMin: 3,
    hoverOverlayPng: "/overlays/maidanavm.png",
  },
  {
    id: "mall3",
    name: "Tepe Prime",
    categoryId: "mall",
    yaw: 76,
    pitch: -4,
    cardImage: "/pins/tepeprime.jpeg",
    distanceKm: 1.7,
    durationMin: 4,
    hoverOverlayPng: "/overlays/tepeprime.png",
  },
  {
    id: "mall4",
    name: "Cepa AVM",
    categoryId: "mall",
    yaw: -48,
    pitch: -5,
    cardImage: "/pins/cepaavm.jpeg",
    distanceKm: 1.5,
    durationMin: 4,
    hoverOverlayPng: "/overlays/cepaavm.png",
  },

  // OKUL
  {
    id: "school1",
    name: "ODTÜ",
    categoryId: "school",
    yaw: -20,
    pitch: -5,
    cardImage: "/pins/odtü.jpeg",
    distanceKm: 4.2,
    durationMin: 6,
    hoverOverlayPng: "/overlays/ODTU.png",
  },

  // HASTANE
  {
    id: "hospital1",
    name: "Bilkent Şehir Hastanesi",
    categoryId: "hospital",
    yaw: 43,
    pitch: -4,
    cardImage: "/pins/bilkenthastane.jpeg",
    distanceKm: 3.1,
    durationMin: 8,
    hoverOverlayPng: "/overlays/bilkenthastane.png",
  },

  // YOLLAR / MAHALLELER
  {
    id: "road1",
    name: "Bilkent Sabancı Bulvarı",
    categoryId: "road",
    yaw: 29,
    pitch: -16,
    cardImage: "/pins/bilkentsabancibulvari.jpeg",
    distanceKm: 1.5,
    durationMin: 5,
    hoverOverlayPng: "/overlays/bilkentsabanci.png",
  },
  {
    id: "road2",
    name: "21-27. Cadde",
    categoryId: "road",
    yaw: -50,
    pitch: -40,
    cardImage: "/pins/2127cadde.jpeg",
    distanceKm: 2.1,
    durationMin: 6,
    hoverOverlayPng: "/overlays/2127.cadde.png",
  },
  {
    id: "road3",
    name: "Ankara Çankaya Mustafa Kemal Mahallesi",
    categoryId: "road",
    yaw: -60,
    pitch: -25,
    cardImage: "/pins/mustafakemalmahallesi.jpeg",
    distanceKm: 0.7,
    durationMin: 3,
    hoverOverlayPng: "/overlays/mustafakemalmahallesi.png",
  },
];
