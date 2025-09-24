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
  rotationSpeed = 0.12,
  projectLogo = "/vegacenter-beyaz-logo.png",
  companyLogo = "/NATA-logobeyaz.png",
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
  const pinRefs = useRef<Record<string, HTMLButtonElement>>({});
  const filteredPinsRef = useRef<Pin[]>([]);

  // NEW: preload states
  const [progress, setProgress] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const panoTextureRef = useRef<THREE.Texture | null>(null);

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

  // =====================
  // PRELOAD ALL ASSETS (panorama, overlay textures, card images) WITH PROGRESS
  // — ensures *all* images referenced in examplePins are downloaded (deduped)
  // =====================
  useEffect(() => {
    let cancelled = false;

    // Reset
    setProgress(0);
    setIsLoaded(false);
    panoTextureRef.current = null;
    overlayTexturesRef.current.clear();

    const manager = new THREE.LoadingManager();
    loadingManagerRef.current = manager;

    // Collect and de-duplicate ALL URLs used by pins
    const overlaySet = new Set<string>();
    const cardSet = new Set<string>();

    pins.forEach(p => {
      if (p.hoverOverlayPng) overlaySet.add(p.hoverOverlayPng);
      if (p.cardImage) cardSet.add(p.cardImage);
    });

    // Build the total item set (panorama + overlays + card images)
    const totalItems: Set<string> = new Set([panoramaSrc, ...overlaySet, ...cardSet]);

    manager.onProgress = (_url, itemsLoaded, itemsTotal) => {
      const pct = Math.round((itemsLoaded / Math.max(itemsTotal, 1)) * 100);
      setProgress(pct);
    };

    manager.onLoad = () => {
      if (!cancelled) setIsLoaded(true);
    };

    const texLoader = new THREE.TextureLoader(manager);

    // 1) Preload panorama
    texLoader.load(
      panoramaSrc,
      (t) => {
        if (cancelled) { t.dispose(); return; }
        t.colorSpace = THREE.SRGBColorSpace;
        panoTextureRef.current = t;
      },
      undefined,
      () => { /* ignore errors; manager still settles */ }
    );

    // 2) Preload ALL unique overlay textures
    overlaySet.forEach(url => {
      if (overlayTexturesRef.current.has(url)) return;
      texLoader.load(
        url,
        (t) => {
          if (cancelled) { t.dispose(); return; }
          t.colorSpace = THREE.SRGBColorSpace;
          t.generateMipmaps = false;
          t.minFilter = THREE.LinearFilter;
          t.magFilter = THREE.LinearFilter;
          overlayTexturesRef.current.set(url, t);
        },
        undefined,
        () => { /* ignore */ }
      );
    });

    // 3) Preload ALL unique card images and force DECODE to avoid first-use jank
    cardSet.forEach(url => {
      manager.itemStart(url);
      const img = new Image();
      img.src = url;
      // Prefer decode() if supported to force raster decode before first paint
      if (typeof (img as any).decode === 'function') {
        (img as any).decode().catch(() => {/* ignore */}).finally(() => manager.itemEnd(url));
      } else {
        img.onload = () => manager.itemEnd(url);
        img.onerror = () => manager.itemEnd(url);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [panoramaSrc, pins]);

  // =====================
  // SCENE SETUP (waits until isLoaded)
  // =====================
  useEffect(() => {
    if (!isLoaded) return;
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
    controls.autoRotateSpeed = Math.max(0, Math.min(rotationSpeed, 1));

    const radius = 500;
    const geo = new THREE.SphereGeometry(radius, 64, 64);
    const panoTex = panoTextureRef.current ?? new THREE.TextureLoader().load(panoramaSrc);
    panoTex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: panoTex, side: THREE.BackSide });
    const sphere = new THREE.Mesh(geo, mat);
    scene.add(sphere);

    const overlayGeo = new THREE.SphereGeometry(radius - 1, 64, 64);
    const placeholder = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat);
    placeholder.colorSpace = THREE.SRGBColorSpace;
    placeholder.needsUpdate = true;
    const overlayMat = new THREE.MeshBasicMaterial({ map: placeholder, transparent: true, opacity: 0, side: THREE.BackSide, depthWrite: false });
    const overlaySphere = new THREE.Mesh(overlayGeo, overlayMat);
    overlaySphere.visible = false;
    overlaySphereRef.current = overlaySphere;
    scene.add(overlaySphere);

    // -------- GPU WARM-UP for overlay textures to avoid first-hover upload stutter --------
    try {
      const caps = renderer.capabilities as any;
      const maxAniso = (caps.getMaxAnisotropy ? caps.getMaxAnisotropy() : 0) || 0;
      overlayTexturesRef.current.forEach((tex) => {
        tex.anisotropy = Math.min(4, maxAniso);
      });
      // Render one frame per cached overlay texture with opacity 0 to force GPU upload
      const originalMap = (overlaySphere.material as THREE.MeshBasicMaterial).map;
      const originalOpacity = (overlaySphere.material as THREE.MeshBasicMaterial).opacity;
      (overlaySphere.material as THREE.MeshBasicMaterial).opacity = 0;
      overlayTexturesRef.current.forEach((tex) => {
        (overlaySphere.material as THREE.MeshBasicMaterial).map = tex;
        (overlaySphere.material as THREE.MeshBasicMaterial).needsUpdate = true;
        renderer.render(scene, camera);
      });
      (overlaySphere.material as THREE.MeshBasicMaterial).map = originalMap;
      (overlaySphere.material as THREE.MeshBasicMaterial).opacity = originalOpacity;
    } catch { /* safe no-op */ }

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

    const pause = () => (controls.autoRotate = false);
    const resume = () => (controls.autoRotate = autoRotate);
    mount.addEventListener("pointerenter", pause);
    mount.addEventListener("pointerleave", resume);

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
      controls.autoRotateSpeed = Math.max(0, Math.min(rotationSpeed, 1));
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
      mount.removeEventListener("pointerenter", pause);
      mount.removeEventListener("pointerleave", resume);
      resizeObserver.disconnect();
      stopped = true;
      cancelAnimationFrame(rafId);
      renderer.dispose();
      geo.dispose();
      mat.dispose();
      // Do NOT dispose panoTex here if you plan to reuse across mounts. If desired, uncomment next line.
      // panoTex.dispose();
      overlayGeo.dispose();
      const m = overlaySphere.material as THREE.MeshBasicMaterial;
      if (m.map && m.map !== placeholder) m.map.dispose();
      m.dispose();
      placeholder.dispose();
    };
  }, [isLoaded, panoramaSrc, initialYaw, initialPitch, initialFov, autoRotate, rotationSpeed]);

  // Keep TextureLoader ready for on-hover fallback (though most are preloaded)
  useEffect(() => {
    THREE.Cache.enabled = true;
    if (!loadingManagerRef.current) loadingManagerRef.current = new THREE.LoadingManager();
    if (!overlayLoaderRef.current) overlayLoaderRef.current = new THREE.TextureLoader(loadingManagerRef.current);
  }, []);

  // Swap overlay on hover (prefers cache from preload)
  useEffect(() => {
    const overlaySphere = overlaySphereRef.current;
    if (!overlaySphere) return;

    if (!hoveredPin || !hoveredPin.hoverOverlayPng) {
      (overlaySphere.material as THREE.MeshBasicMaterial).opacity = 0;
      overlaySphere.visible = false;
      return;
    }

    const cached = overlayTexturesRef.current.get(hoveredPin.hoverOverlayPng);
    if (cached) {
      cached.generateMipmaps = false;
      cached.minFilter = THREE.LinearFilter;
      cached.magFilter = THREE.LinearFilter;
      (overlaySphere.material as THREE.MeshBasicMaterial).map = cached;
      (overlaySphere.material as THREE.MeshBasicMaterial).opacity = 1;
      (overlaySphere.material as THREE.MeshBasicMaterial).needsUpdate = true;
      overlaySphere.visible = true;
    } else {
      const loader = overlayLoaderRef.current || new THREE.TextureLoader();
      const tex = loader.load(hoveredPin.hoverOverlayPng, () => {
        tex.generateMipmaps = false;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
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
      {/* THREE mount */}
      <div className="absolute inset-0" ref={mountRef} />

      {/* PRELOADER OVERLAY */}
      {!isLoaded && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-[#0b0b0f] text-white">
          <div className="flex items-center gap-4">
            <img src={projectLogo} alt="Project Logo" className="h-12 w-auto object-contain drop-shadow" />
            <div className="h-10 w-px bg-white/20" />
            <img src={companyLogo} alt="Company Logo" className="h-12 w-auto object-contain drop-shadow" />
          </div>
          <div className="w-[min(520px,80vw)]">
            <div className="mb-2 flex justify-between text-xs text-white/70">
              <span>Preparing experience…</span>
              <span>{progress}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
              <div
                className="h-full rounded-full bg-white/80 transition-[width] duration-200"
                style={{ width: `${progress}%` }}
              />
            </div>
            <div className="mt-3 text-[11px] text-white/50">Loading panorama, overlays & pin cards</div>
          </div>
          <div className="mt-4 h-6 w-6 animate-spin rounded-full border-2 border-white/40 border-t-white/90" />
        </div>
      )}

      {/* Pins layer */}
      <div className="pointer-events-none absolute left-0 top-0 z-10 h-full w-full">
        {filteredPins.map((p) => (
          <PinDot
            key={p.id}
            ref={(el: HTMLButtonElement | null) => {
              if (el) pinRefs.current[p.id] = el;
            }}
            color={catMap.get(p.categoryId)?.neonColor || "#39FF14"}
            label={p.name}
            onEnter={() => setHoveredPinId(p.id)}
            onLeave={() => setHoveredPinId((cur) => (cur === p.id ? null : cur))}
            onClick={() => setHoveredPinId(p.id)}
          />
        ))}
      </div>

      {/* Category Filter */}
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

      {/* Pin Card */}
      {hoveredPin && (
<aside
  className="absolute right-4 top-4 z-20 w-80 max-w-[90%] rounded-2xl border border-white/20 bg-white/10 p-4 shadow-xl ring-1 ring-white/10 backdrop-blur-xl"
  style={{ willChange: "transform, opacity", transform: "translateZ(0)" }}
>          <div className="flex h-full flex-col">
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

      {/* Logos */}
      <div className="absolute bottom-4 left-4 z-20 flex items-center gap-4">
        <img src={projectLogo} alt="Project Logo" className="h-12 w-auto object-contain drop-shadow-lg" />
        <img src={companyLogo} alt="Company Logo" className="h-12 w-auto object-contain drop-shadow-lg" />
      </div>
    </div>
  );
}

// ---- Example data (unchanged) ----
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
