/* eslint-disable @next/next/no-img-element */
// app/components/PanoTour.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";

/* -----------------------------------------------------------
   Dynamically load three.js (Next.js SSR-safe) with types
----------------------------------------------------------- */
type ThreeNS = typeof import("three");
type OrbitControlsModule = typeof import("three/examples/jsm/controls/OrbitControls.js");
type OrbitControlsCtor = OrbitControlsModule["OrbitControls"];

// minimal interface we use at runtime (avoids importing types eagerly)
interface IOrbitControls {
  enableDamping: boolean;
  enableZoom: boolean;
  enablePan: boolean;
  rotateSpeed: number;
  zoomSpeed: number;
  minDistance: number;
  maxDistance: number;
  update(): void;
  dispose(): void;
}

let THREE: ThreeNS | null = null;
let OrbitControlsClass: OrbitControlsCtor | null = null;

async function ensureThree() {
  if (!THREE) {
    THREE = await import("three");
  }
  if (!OrbitControlsClass) {
    const mod: OrbitControlsModule = await import(
      "three/examples/jsm/controls/OrbitControls.js"
    );
    OrbitControlsClass = mod.OrbitControls;
  }
}

/* -----------------------------------------------------------
   Types
----------------------------------------------------------- */
export type SceneLink = {
  to: string;
  yaw: number; // +right / -left (deg)
  pitch: number; // +down / -up (deg) [UI convention]
  label?: string;
};

export type Pin = {
  id: string;
  yaw: number;
  pitch: number;
  label?: string;
  title: string;
  description?: string;
  image?: string;
  distanceMinutes?: number;
  badge?: string;
  links?: { href: string; text: string }[];
  color?: string;
};

export type Scene = {
  id: string;
  title?: string;
  src: string; // equirect pano under /public
  yaw?: number;
  links?: SceneLink[];
  pins?: Pin[]; // only scenes that have pins will render them
};

export type PanoTourProps = {
  scenes: Scene[];
  startId: string;
  autoRotateSpeed?: number;
  zoom?: boolean;
  /** Logos shown in the top bar (project first) */
  projectLogoSrc?: string;
  companyLogoSrc?: string;
  projectLogoAlt?: string;
  companyLogoAlt?: string;
};

/* -----------------------------------------------------------
   GL Helpers (typed)
----------------------------------------------------------- */
function getWebGLContext(
  attrs: WebGLContextAttributes
): {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext | WebGL2RenderingContext | null;
} {
  const canvas = document.createElement("canvas");

  // Narrow each getContext call to a WebGL context type
  const get = <
    T extends WebGLRenderingContext | WebGL2RenderingContext
  >(
    name: "webgl2" | "webgl" | "experimental-webgl"
  ): T | null => canvas.getContext(name, attrs) as unknown as T | null;

  const gl =
    get<WebGL2RenderingContext>("webgl2") ??
    get<WebGLRenderingContext>("webgl") ??
    get<WebGLRenderingContext>("experimental-webgl");

  return { canvas, gl };
}


function createRenderer(
  T: ThreeNS,
  canvas: HTMLCanvasElement,
  gl: WebGLRenderingContext | WebGL2RenderingContext
): ThreeNS["WebGLRenderer"] | ThreeNS["WebGL1Renderer"] {
  try {
    return new T.WebGLRenderer({ canvas, context: gl });
  } catch {
    return new T.WebGL1Renderer({ canvas, context: gl });
  }
}

type LoseContextExtension = { loseContext: () => void };

/* -----------------------------------------------------------
   Image loader (typed, no `any`)
----------------------------------------------------------- */
async function loadTextureSmart(
  url: string,
  maxWidth = 8192
): Promise<import("three").CanvasTexture> {
  await ensureThree();
  const T = THREE!;

  // absolute URL (handles basePath)
  const absolute = url.startsWith("http")
    ? url
    : new URL(url, window.location.origin).toString();

  let blob: Blob | null = null;

  // Fetch first so we can surface HTTP errors
  try {
    const res = await fetch(absolute, { cache: "force-cache" });
    if (!res.ok)
      throw new Error(`HTTP ${res.status} ${res.statusText} for ${absolute}`);
    blob = await res.blob();
  } catch {
    // fall through to <img> path
  }

  const makeTextureFromCanvas = (canvas: HTMLCanvasElement) => {
    const tex = new T.CanvasTexture(canvas);
    tex.colorSpace = T.SRGBColorSpace;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.generateMipmaps = true;
    return tex;
  };

  // Try ImageBitmap path if we have a blob
  if (blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const w = bmp.width;
      const h = bmp.height;
      const scale = w > maxWidth ? maxWidth / w : 1;
      const sw = Math.round(w * scale);
      const sh = Math.round(h * scale);

      const off = document.createElement("canvas");
      off.width = sw;
      off.height = sh;
      const ctx = off.getContext("2d")!;
      ctx.drawImage(bmp, 0, 0, sw, sh);
      bmp.close();
      return makeTextureFromCanvas(off);
    } catch {
      // fall back
    }
  }

  // Fallback: decode via <img>
  const img = new Image();
  img.decoding = "async";
  img.src = blob ? URL.createObjectURL(blob) : absolute;

  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () =>
      reject(new Error(`Image decode failed for ${absolute}`));
  });

  try {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const scale = w > maxWidth ? maxWidth / w : 1;
    const sw = Math.round(w * scale);
    const sh = Math.round(h * scale);

    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const ctx = off.getContext("2d")!;
    ctx.drawImage(img, 0, 0, sw, sh);
    return makeTextureFromCanvas(off);
  } finally {
    if (blob) URL.revokeObjectURL(img.src);
  }
}

/* ===========================================================
   PanoViewer (single panorama, fills its parent)
=========================================================== */
type Hotspot = {
  yaw: number;
  pitch: number;
  label?: string;
  onClick?: () => void;
};

export function PanoViewer({
  src,
  yaw = 0,
  hotspots = [],
  pins = [],
  autoRotateSpeed = 0,
  zoom = true,
  debug = true,
  className = "absolute inset-0",
}: {
  src: string;
  yaw?: number;
  hotspots?: Hotspot[];
  pins?: Pin[];
  autoRotateSpeed?: number;
  zoom?: boolean;
  debug?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    // three.js objects
    let renderer:
      | ThreeNS["WebGLRenderer"]
      | ThreeNS["WebGL1Renderer"]
      | null = null;
    let gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
    let scene: import("three").Scene | null = null;
    let camera: import("three").PerspectiveCamera | null = null;
    let controls: IOrbitControls | null = null;
    let sphere: import("three").Mesh | null = null;
    let geometry: import("three").SphereGeometry | null = null;
    let material: import("three").MeshBasicMaterial | null = null;
    let texture: import("three").Texture | null = null;
    let animId = 0;

    const pinWraps: HTMLDivElement[] = [];
    const hotspotEls: HTMLDivElement[] = [];

    const toVec3 = (yawDeg: number, pitchDeg: number) => {
      const T = THREE!;
      const yawR = (yawDeg * Math.PI) / 180;
      const pitchR = (pitchDeg * Math.PI) / 180;
      const x = Math.cos(pitchR) * Math.sin(yawR);
      const y = Math.sin(pitchR);
      const z = Math.cos(pitchR) * Math.cos(yawR);
      return new T.Vector3(x, y, z).multiplyScalar(49.9);
    };

    // for debug: compute yaw/pitch from mouse
    const getYawPitchFromPointer = (ev: MouseEvent) => {
      if (!camera || !renderer) return { yaw: 0, pitch: 0 };
      const rect = renderer.domElement.getBoundingClientRect();
      const x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      const T = THREE!;
      const v = new T.Vector3(x, y, 0.5)
        .unproject(camera)
        .sub(camera.position)
        .normalize();
      const yawD = (Math.atan2(v.x, v.z) * 180) / Math.PI;
      const pitchD = (Math.asin(v.y) * 180) / Math.PI; // +up
      return { yaw: yawD, pitch: -pitchD }; // UI uses +down
    };

    let cleanup = () => {};

    (async () => {
      await ensureThree();
      if (!mounted || !THREE || !containerRef.current) return;
      const T = THREE!;

      const el = containerRef.current;
      const size = () => [el.clientWidth, el.clientHeight] as const;

      // --- Preflight GL ---
      const attrs: WebGLContextAttributes = {
        alpha: false,
        antialias: false,
        depth: true,
        stencil: false,
        desynchronized: true as unknown as boolean, // flag varies
        powerPreference: "high-performance",
        preserveDrawingBuffer: false,
      };
      const { canvas, gl: ctx } = getWebGLContext(attrs);
      gl = ctx;

      if (!gl) {
        setError(
          "WebGL is unavailable. Close other GPU-heavy tabs, enable hardware acceleration, or reduce image size."
        );
        return;
      }

      // --- Renderer from that context ---
      renderer = createRenderer(T, canvas, gl);
      renderer.setClearColor(0x000000, 1);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      const [w0, h0] = size();
      renderer.setSize(w0, h0);
      el.appendChild(renderer.domElement);

      renderer.domElement.addEventListener(
        "webglcontextlost",
        (ev: Event) => {
          ev.preventDefault();
          setError("Graphics context lost. Reload the page.");
        },
        false
      );

      // --- Scene / Camera / Controls ---
      scene = new T.Scene();
      camera = new T.PerspectiveCamera(75, w0 / h0, 0.1, 1000);
      camera.position.set(0, 0, 0.1);

      const Controls = OrbitControlsClass!;
      controls = new Controls(camera, renderer.domElement) as unknown as IOrbitControls;
      controls.enableDamping = true;
      controls.enableZoom = zoom;
      controls.enablePan = false;
      controls.rotateSpeed = 0.25;
      controls.zoomSpeed = 0.6;
      controls.minDistance = 0.1;
      controls.maxDistance = 3;

      // --- Texture (downscale big 12k images to <= 8k) ---
      try {
        texture = await loadTextureSmart(src, 8192);
      } catch (e: unknown) {
        const msg =
          e instanceof Error ? e.message : "Failed to load image.";
        setError(msg);
        return;
      }

      geometry = new T.SphereGeometry(50, 64, 48);
      geometry.scale(-1, 1, 1);
      material = new T.MeshBasicMaterial({ map: texture });
      sphere = new T.Mesh(geometry, material);
      scene.add(sphere);

      // initial yaw
      camera.rotation.y = -(yaw * Math.PI) / 180;

      // --- Hotspots (scene links) ---
      hotspots.forEach((h) => {
        const d = document.createElement("div");
        d.className =
          "absolute -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 rounded-full text-[11px] leading-none " +
          "bg-white/35 text-slate-900 border border-white/60 shadow-[0_8px_24px_rgba(0,0,0,0.18)] " +
          "backdrop-blur-md hover:bg-white/50 transition";
        d.textContent = h.label || "●";
        d.style.cursor = h.onClick ? "pointer" : "default";
        if (h.onClick) d.addEventListener("click", h.onClick);
        el.appendChild(d);
        hotspotEls.push(d);
      });

      // --- Pins with info cards ---
      pins.forEach((p) => {
        const wrap = document.createElement("div");
        wrap.className =
          "absolute -translate-x-1/2 -translate-y-1/2 pointer-events-auto group";

        const btn = document.createElement("button");
        btn.className =
          "relative h-4 w-4 rounded-full shadow ring-2 transition " +
          "border border-white/70 bg-white ring-white/60 " +
          "group-hover:scale-110";
        if (p.color) {
          btn.style.background = p.color;
          btn.style.borderColor = p.color;
          btn.style.boxShadow = `0 0 0 2px ${p.color}`;
        }
        btn.title = p.label || p.title;

        if (p.label) {
          const lbl = document.createElement("div");
          lbl.className =
            "absolute left-1/2 -translate-x-1/2 mt-2 whitespace-nowrap " +
            "px-1.5 py-0.5 rounded-full text-[10px] bg-white/70 text-black border border-white/80";
          lbl.textContent = p.label;
          btn.appendChild(lbl);
        }

        const card = document.createElement("div");
        card.className =
          "absolute left-1/2 -translate-x-1/2 -translate-y-3 opacity-0 " +
          "group-hover:opacity-100 group-[.open]:opacity-100 " +
          "group-hover:pointer-events-auto group-[.open]:pointer-events-auto " +
          "pointer-events-none transition";
        card.innerHTML = `
          <div class="w-72 max-w-[80vw] rounded-xl bg-black/70 text-white backdrop-blur border border-white/20 shadow-xl p-3">
            <div class="flex gap-3">
              ${p.image ? `<img src="${p.image}" class="w-20 h-20 rounded-lg object-cover" alt="${p.title}"/>` : ""}
              <div class="min-w-0">
                <div class="font-medium text-sm leading-tight">${p.title}</div>
                ${p.badge ? `<div class="text-[10px] uppercase tracking-wide text-white/70 mt-0.5">${p.badge}</div>` : ""}
                ${p.description ? `<div class="text-white/80 text-xs mt-1">${p.description}</div>` : ""}
                ${p.distanceMinutes != null ? `<div class="text-white/60 text-[11px] mt-1">~${p.distanceMinutes} min</div>` : ""}
                ${
                  p.links?.length
                    ? `<div class="mt-2 flex gap-2 flex-wrap">
                        ${p.links
                          .map(
                            (l) =>
                              `<a href="${l.href}" target="_blank" class="inline-flex items-center text-xs px-2 py-1 rounded bg-white text-black hover:bg-white/90">${l.text}</a>`
                          )
                          .join("")}
                       </div>`
                    : ""
                }
              </div>
            </div>
          </div>
        `;
        wrap.appendChild(btn);
        wrap.appendChild(card);

        // hover & tap
        let open = false;
        const openCard = () => {
          open = true;
          wrap.classList.add("open");
        };
        const closeCard = () => {
          open = false;
          wrap.classList.remove("open");
        };
        btn.addEventListener("mouseenter", openCard);
        wrap.addEventListener("mouseleave", closeCard);
        btn.addEventListener("click", () => (open ? closeCard() : openCard()));

        el.appendChild(wrap);
        pinWraps.push(wrap);
      });

      // --- render loop ---
      const clock = new T.Clock();
      const loop = () => {
        animId = requestAnimationFrame(loop);
        const dt = clock.getDelta();
        if (autoRotateSpeed && sphere) {
          sphere.rotation.y += ((autoRotateSpeed * Math.PI) / 180) * dt;
        }
        controls?.update();
        if (scene && camera && renderer) renderer.render(scene, camera);

        const w = el.clientWidth;
        const h = el.clientHeight;

        hotspots.forEach((hs, i) => {
          const p3 = toVec3(hs.yaw, -hs.pitch);
          p3.project(camera!);
          const visible = p3.z < 1;
          const x = (p3.x * 0.5 + 0.5) * w;
          const y = (-p3.y * 0.5 + 0.5) * h;
          const node = hotspotEls[i];
          node.style.display = visible ? "block" : "none";
          if (visible) node.style.transform = `translate(${x}px, ${y}px)`;
        });

        pins.forEach((pin, i) => {
          const p3 = toVec3(pin.yaw, -pin.pitch);
          p3.project(camera!);
          const visible = p3.z < 1;
          const x = (p3.x * 0.5 + 0.5) * w;
          const y = (-p3.y * 0.5 + 0.5) * h;
          const wrap = pinWraps[i];
          wrap.style.display = visible ? "block" : "none";
          if (visible) wrap.style.transform = `translate(${x}px, ${y}px)`;
        });
      };

      // resize
      const onResize = () => {
        const nw = el.clientWidth;
        const nh = el.clientHeight;
        renderer!.setSize(nw, nh);
        if (camera) {
          camera.aspect = nw / nh;
          camera.updateProjectionMatrix();
        }
      };
      window.addEventListener("resize", onResize);

      // debug: Alt+Click to print yaw/pitch
      const onAltClick = (e: MouseEvent) => {
        if (!debug || !e.altKey) return;
        const a = getYawPitchFromPointer(e);
        // eslint-disable-next-line no-console
        console.log("Pin draft:", {
          id: `pin_${Date.now()}`,
          yaw: Number(a.yaw.toFixed(2)),
          pitch: Number(a.pitch.toFixed(2)),
          title: "New place",
          description: "Describe...",
          image: "/pins/example.jpg",
          distanceMinutes: 5,
          label: "Label",
          badge: "Type",
          links: [{ href: "https://example.com", text: "More" }],
        });
      };
      el.addEventListener("click", onAltClick);

      setError(null);
      setReady(true);
      loop();

      // --- cleanup ---
      cleanup = () => {
        cancelAnimationFrame(animId);
        window.removeEventListener("resize", onResize);
        el.removeEventListener("click", onAltClick);
        hotspotEls.forEach((d) => d.remove());
        pinWraps.forEach((d) => d.remove());

        try {
          if (gl && "getExtension" in gl) {
            const ext = (gl as WebGLRenderingContext).getExtension(
              "WEBGL_lose_context"
            ) as LoseContextExtension | null;
            ext?.loseContext();
          }
        } catch {
          /* ignore */
        }

        controls?.dispose();
        if (renderer && renderer.domElement.parentElement === el) {
          el.removeChild(renderer.domElement);
        }
        geometry?.dispose();
        material?.dispose();
        texture?.dispose();
        renderer?.dispose?.();
      };
    })();

    return () => {
      mounted = false;
      cleanup();
    };
  }, [src, yaw, hotspots, pins, autoRotateSpeed, zoom, debug]);

  return (
    <div ref={containerRef} className={className}>
      {/* subtle glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 -left-24 h-64 w-64 rounded-full bg-gradient-to-br from-white/40 to-transparent blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-64 w-64 rounded-full bg-gradient-to-tl from-white/30 to-transparent blur-3xl" />
      </div>

      {!ready && !error && (
        <div className="absolute inset-0 grid place-items-center text-sm text-white/80">
          Loading panorama…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 grid place-items-center">
          <div className="rounded-xl bg-black/70 text-white px-4 py-3 text-sm backdrop-blur">
            {error}
          </div>
        </div>
      )}
    </div>
  );
}

/* ===========================================================
   PanoTour (FULLSCREEN with glass UI + logos)
=========================================================== */
export default function PanoTour({
  scenes,
  startId,
  autoRotateSpeed = 0.12,
  zoom = true,
  projectLogoSrc = "/logos/project.png",
  companyLogoSrc = "/logos/company.png",
  projectLogoAlt = "Project logo",
  companyLogoAlt = "Company logo",
}: PanoTourProps) {
  const byId = useMemo(
    () => Object.fromEntries(scenes.map((s) => [s.id, s])),
    [scenes]
  ) as Record<string, Scene>;
  const [currentId, setCurrentId] = useState(startId);
  const [autoSpin, setAutoSpin] = useState<boolean>(true);
  const current = byId[currentId];

  // lock page scroll while fullscreen tour is mounted
  useEffect(() => {
    const { documentElement: html, body } = document;
    const prevHtml = html.style.overflow;
    const prevBody = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = prevHtml;
      body.style.overflow = prevBody;
    };
  }, []);

  if (!current) {
    return (
      <div className="fixed inset-0 grid place-items-center text-red-600">
        Scene “{currentId}” not found.
      </div>
    );
  }

  const idx = scenes.findIndex((s) => s.id === currentId);
  const prev = scenes[(idx - 1 + scenes.length) % scenes.length];
  const next = scenes[(idx + 1) % scenes.length];

  const hotspots: Hotspot[] = (current.links || []).map((lnk) => ({
    yaw: lnk.yaw,
    pitch: lnk.pitch,
    label: lnk.label || "Go",
    onClick: () => setCurrentId(lnk.to),
  }));

  return (
    <div className="fixed inset-0 bg-black">
      {/* Force remount on scene change -> new clean renderer each time */}
      <PanoViewer
        key={current.id}
        src={current.src}
        yaw={current.yaw || 0}
        hotspots={hotspots}
        pins={current.pins || []}
        autoRotateSpeed={autoSpin ? autoRotateSpeed : 0}
        zoom={zoom}
        className="absolute inset-0"
      />

      {/* ======= GLASS UI OVERLAYS ======= */}

      {/* Top bar with logos */}
      <div className="pointer-events-none absolute left-0 right-0 top-0 p-3">
        <div className="mx-auto max-w-[min(1280px,100vw)] pointer-events-auto rounded-2xl bg-white/10 border border-white/20 backdrop-blur-xl text-white shadow-[0_12px_40px_rgba(0,0,0,.25)]">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="flex items-center gap-4 min-w-0">
              <img
                src={projectLogoSrc}
                alt={projectLogoAlt}
                className="h-8 w-auto object-contain"
              />
              <div className="h-6 w-px bg-white/30" />
              <img
                src={companyLogoSrc}
                alt={companyLogoAlt}
                className="h-8 w-auto object-contain"
              />
              <div className="ml-4">
                <div className="text-[11px] uppercase tracking-wider text-white/70">
                  Panorama Tour
                </div>
                <h2 className="text-lg font-semibold leading-tight">
                  {current.title || current.id}
                </h2>
              </div>
            </div>

            {/* scene chips */}
            <div className="hidden md:flex flex-wrap gap-2">
              {scenes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentId(s.id)}
                  className={`px-3 py-1.5 rounded-full text-xs transition border backdrop-blur-md ${
                    s.id === currentId
                      ? "bg-white text-black border-white shadow"
                      : "bg-white/25 text-white border-white/50 hover:bg-white/35"
                  }`}
                  title={s.title || s.id}
                >
                  {s.title || s.id}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom dock */}
      <div className="pointer-events-none absolute left-0 right-0 bottom-0 p-3">
        <div className="mx-auto max-w-[min(1280px,100vw)] pointer-events-auto flex flex-col gap-2">
          {/* Control pill */}
          <div className="self-center flex items-center gap-2 rounded-full bg-white/15 border border-white/30 backdrop-blur-xl px-2 py-1.5 text-white shadow-[0_10px_35px_rgba(0,0,0,.35)]">
            <button
              onClick={() => setCurrentId(prev.id)}
              className="px-3 py-1 rounded-full text-xs bg-white/60 text-black hover:bg-white/80 transition"
              title="Previous"
            >
              ‹ Prev
            </button>
            <button
              onClick={() => setAutoSpin((v) => !v)}
              className="px-3 py-1 rounded-full text-xs bg-white/60 text-black hover:bg-white/80 transition"
              title={autoSpin ? "Pause auto-rotate" : "Play auto-rotate"}
            >
              {autoSpin ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => setCurrentId(next.id)}
              className="px-3 py-1 rounded-full text-xs bg-white/60 text-black hover:bg-white/80 transition"
              title="Next"
            >
              Next ›
            </button>
          </div>

          {/* Thumbs strip */}
          <div className="rounded-2xl border border-white/20 bg-white/10 backdrop-blur-xl px-2 py-2">
            <div className="flex gap-2 overflow-x-auto">
              {scenes.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setCurrentId(s.id)}
                  className={`shrink-0 w-36 h-20 rounded-xl overflow-hidden border transition ${
                    s.id === currentId
                      ? "ring-2 ring-white border-white"
                      : "border-white/40 hover:border-white/60"
                  }`}
                  title={s.title || s.id}
                >
                  <img
                    src={s.src}
                    alt={s.id}
                    className="w-full h-full object-cover"
                  />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
