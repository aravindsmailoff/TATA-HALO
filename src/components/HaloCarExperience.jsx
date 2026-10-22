'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import Lenis from 'lenis';

export default function HaloCarExperience() {
  const rootRef = useRef(null);

  useEffect(() => {
    const $ = (s, r = document) => r.querySelector(s);
    const $$ = (s, r = document) => [...r.querySelectorAll(s)];
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const sstep = (a, b, x) => {
      const t = clamp01((x - a) / (b - a));
      return t * t * (3 - 2 * t);
    };
    const win = (a, b, c, d, x) => sstep(a, b, x) * (1 - sstep(c, d, x));
    const REDUCE = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const MOBILE = typeof window !== 'undefined' && window.innerWidth < 768;
    const TOUCH = typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches;
    const subs = new Set();
    let raf = 0;
    function frame(t) {
      raf = requestAnimationFrame(frame);
      for (const s of [...subs]) {
        try {
          s(t);
        } catch (e) {
          console.error('[ticker]', e);
        }
      }
    }
    const tick = (fn) => {
      subs.add(fn);
      if (!raf) raf = requestAnimationFrame(frame);
      return () => subs.delete(fn);
    };

    /* ═══════════ LENIS SMOOTH SCROLLING ═══════════ */
    let p = 0, pTarget = 0;
    let lenis = null;
    try {
      lenis = new Lenis({
        duration: 1.05,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        orientation: 'vertical',
        smoothWheel: true,
        wheelMultiplier: 1.25,
        touchMultiplier: 1.4,
      });

      const updateScrollProgress = (scrollVal) => {
        const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        pTarget = clamp01(scrollVal / maxScroll);
      };

      lenis.on('scroll', (e) => {
        updateScrollProgress(e.scroll);
      });

      function lenisTicker(time) {
        lenis.raf(time);
        requestAnimationFrame(lenisTicker);
      }
      requestAnimationFrame(lenisTicker);
    } catch (e) {
      console.warn('Lenis fallback to native scroll', e);
      const readScroll = () => {
        pTarget = clamp01(window.scrollY / Math.max(1, document.documentElement.scrollHeight - window.innerHeight));
      };
      window.addEventListener('scroll', readScroll, { passive: true });
      readScroll();
    }

    const cleanupNavLinks = [];
    $$('[data-to]').forEach((a) => {
      const handler = (e) => {
        e.preventDefault();
        const targetScroll = +a.dataset.to * (document.documentElement.scrollHeight - window.innerHeight);
        if (lenis) {
          lenis.scrollTo(targetScroll, { duration: REDUCE ? 0 : 1.4 });
        } else {
          window.scrollTo({
            top: targetScroll,
            behavior: REDUCE ? 'auto' : 'smooth',
          });
        }
      };
      a.addEventListener('click', handler);
      cleanupNavLinks.push(() => a.removeEventListener('click', handler));
    });

    /* ═══════════ CHAR-MASK REVEAL (REACT BITS STYLE) ═══════════ */
    function maskChars(el) {
      if (!el) return [];
      const nodes = [...el.childNodes];
      el.textContent = '';
      const chars = [];
      const push = (text, parent) => {
        for (const ch of text) {
          if (ch === ' ') {
            parent.appendChild(document.createTextNode(' '));
            continue;
          }
          const m = document.createElement('span');
          m.className = 'char-mask';
          const c = document.createElement('span');
          c.className = 'hero-char';
          c.textContent = ch;
          m.appendChild(c);
          parent.appendChild(m);
          chars.push(c);
        }
      };
      for (const n of nodes) {
        if (n.nodeType === 3) push(n.textContent, el);
        else if (n.tagName === 'BR') el.appendChild(n);
        else {
          const s = document.createElement(n.tagName.toLowerCase());
          s.className = n.className;
          s.style.cssText = n.style.cssText;
          push(n.textContent, s);
          el.appendChild(s);
        }
      }
      return chars;
    }
    const armOf = (chars) => chars[0]?.closest('.animated-title, .hero-title');
    const revealChars = (chars, stagger = 30, base = 0) => {
      const a = armOf(chars);
      a?.classList.add('armed');
      chars.forEach((c, i) => setTimeout(() => c.classList.add('revealed'), base + i * stagger));
      setTimeout(() => a?.classList.remove('armed'), base + chars.length * stagger + 1800);
    };
    const hideChars = (chars) => chars.forEach((c) => c.classList.remove('revealed'));

    /* ═══════════ 3D SCENE: TATA PUNCH GLB ═══════════ */
    const COLOURS = [
      { name: 'Orcus White', c: 0xffffff, mix: 0 },
      { name: 'Daytona Grey', c: 0x4a4e55, mix: 0.82 },
      { name: 'Atomic Orange', c: 0xd35400, mix: 0.88 },
    ];
    let colour = 0, sceneReady = false;
    const fg = $('#fg'), bg = $('#bg'), read = $('#read');
    if (!fg || !bg || !read) return;

    // Detect 2GB RAM or low-concurrency machine to aggressively optimize GPU & heap memory
    const isLowMem = typeof navigator !== 'undefined' && (
      (navigator.deviceMemory && navigator.deviceMemory <= 2) ||
      (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4)
    );
    const targetDPR = isLowMem ? 1.0 : (MOBILE ? 1.25 : 1.5);

    const renderer = new THREE.WebGLRenderer({
      canvas: fg,
      antialias: !isLowMem,
      alpha: true,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
      precision: isLowMem ? 'mediump' : 'highp',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, targetDPR));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.localClippingEnabled = true;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 1, 400);
    camera.position.set(0, 0, 95);

    const group = new THREE.Group();
    scene.add(group);
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 40);

    const carGroup = new THREE.Group();
    group.add(carGroup);
    const carMats = [];

    // Realistic ground contact shadow underneath car
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = shadowCanvas.height = 256;
    const sCtx = shadowCanvas.getContext('2d');
    const sGrad = sCtx.createRadialGradient(128, 128, 0, 128, 128, 128);
    sGrad.addColorStop(0, 'rgba(0,0,0,0.85)');
    sGrad.addColorStop(0.55, 'rgba(0,0,0,0.38)');
    sGrad.addColorStop(1, 'rgba(0,0,0,0)');
    sCtx.fillStyle = sGrad;
    sCtx.fillRect(0, 0, 256, 256);

    const shadowMat = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(shadowCanvas),
      transparent: true,
      depthWrite: false,
      opacity: 0.28,
    });
    const shadowMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 48), shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    carGroup.add(shadowMesh);

    const currTint = new THREE.Color(COLOURS[0].c);
    let currMix = 0;

    const loader = new GLTFLoader();
    const modelCandidates = ['/models/tata-punch-3d-model.glb', '/models/car.glb'];

    const loadCarModel = (idx = 0) => {
      if (idx >= modelCandidates.length) {
        console.warn('All GLB candidates loaded or attempted');
        sceneReady = true;
        return;
      }
      const targetUrl = modelCandidates[idx];
      loader.load(
        targetUrl,
        (gltf) => {
          const carScene = gltf.scene;
          const box = new THREE.Box3().setFromObject(carScene);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          const maxDim = Math.max(size.x, size.z);
          // Scale car to fit screen proportionally
          const scale = 35 / (maxDim || 1);

          carScene.scale.setScalar(scale);
          carScene.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

          // Wrap car in a group facing front towards camera
          const carWrapper = new THREE.Group();
          carWrapper.rotation.y = Math.PI;
          carWrapper.add(carScene);
          carGroup.add(carWrapper);

          shadowMesh.position.y = -center.y * scale + 0.05;

          const maxAniso = Math.min(isLowMem ? 2 : 4, renderer.capabilities.getMaxAnisotropy() || 2);

          carScene.traverse((child) => {
            if (child.isMesh && child.material) {
              const mats = Array.isArray(child.material) ? child.material : [child.material];
              mats.forEach((m) => {
                m.roughness = Math.min(m.roughness ?? 0.45, 0.5);
                m.metalness = Math.max(m.metalness ?? 0.35, 0.2);
                m.envMapIntensity = 1.4;
                [m.map, m.metalnessMap, m.normalMap].forEach((t) => {
                  if (t) t.anisotropy = maxAniso;
                });
                m.userData.baseColor = m.color.clone();
                carMats.push(m);
              });
            }
          });

          sceneReady = true;
          renderer.render(scene, camera);
        },
        undefined,
        (err) => {
          console.warn(`Error loading model from ${targetUrl}, trying fallback...`, err);
          loadCarModel(idx + 1);
        }
      );
    };
    loadCarModel(0);

    /* Studio environment lighting (Lightweight 512x256 on 2GB RAM machines) */
    function studioEnv() {
      const cv = document.createElement('canvas');
      const ew = isLowMem ? 512 : 1024, eh = isLowMem ? 256 : 512;
      cv.width = ew;
      cv.height = eh;
      const c = cv.getContext('2d');
      const g = c.createLinearGradient(0, 0, 0, eh);
      g.addColorStop(0, '#ffffff');
      g.addColorStop(0.5, '#e9ebef');
      g.addColorStop(0.8, '#b9bdc4');
      g.addColorStop(1, '#6f747c');
      c.fillStyle = g;
      c.fillRect(0, 0, ew, eh);
      c.fillStyle = 'rgba(255,255,255,1)';
      c.beginPath();
      c.roundRect(ew * 0.14, eh * 0.08, ew * 0.41, eh * 0.3, 20);
      c.fill();
      c.fillStyle = 'rgba(20,22,26,.9)';
      c.beginPath();
      c.roundRect(ew * 0.7, eh * 0.35, ew * 0.22, eh * 0.31, 15);
      c.fill();
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.beginPath();
      c.roundRect(ew * 0.06, eh * 0.6, ew * 0.25, eh * 0.12, 15);
      c.fill();
      const tex = new THREE.CanvasTexture(cv);
      tex.mapping = THREE.EquirectangularReflectionMapping;
      tex.colorSpace = THREE.SRGBColorSpace;
      const pm = new THREE.PMREMGenerator(renderer);
      pm.compileEquirectangularShader();
      const env = pm.fromEquirectangular(tex).texture;
      pm.dispose();
      tex.dispose();
      return env;
    }
    scene.environment = studioEnv();

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.0);
    keyLight.position.set(-30, 50, 60);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xdfe8ff, 1.3);
    rimLight.position.set(40, 20, -60);
    scene.add(rimLight);

    const fillLight = new THREE.HemisphereLight(0xffffff, 0x667085, 0.9);
    scene.add(fillLight);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    const hudDPR = Math.min(window.devicePixelRatio || 1, isLowMem ? 1.0 : 1.5);
    const fit = () => {
      const w = window.innerWidth, h = window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      bg.width = 96;
      bg.height = 54;
      read.width = w * hudDPR;
      read.height = h * hudDPR;
    };
    window.addEventListener('resize', fit);
    fit();

    /* Pointer controls (Tilt & 360° Orbit Drag) */
    const tilt = { x: 0, y: 0 }, tiltTo = { x: 0, y: 0 };
    let dragging = false, lastX = 0, lastY = 0;
    let orbitYaw = 0, orbitPitch = 0;
    let velYaw = 0, velPitch = 0;

    const onPointerDown = (e) => {
      if (e.target && e.target.closest && e.target.closest('a, button, input, textarea, form, .chat')) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };

    const onPointerMove = (e) => {
      tiltTo.y = (e.clientX / window.innerWidth - 0.5) * 2;
      tiltTo.x = (e.clientY / window.innerHeight - 0.5) * 2;
      if (dragging) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        velYaw = dx * 0.008;
        velPitch = dy * 0.005;
        orbitYaw += velYaw;
        orbitPitch = Math.max(-0.35, Math.min(0.45, orbitPitch + velPitch));
        lastX = e.clientX;
        lastY = e.clientY;
      }
    };

    const onPointerUp = () => {
      dragging = false;
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    /* Paint Swatches */
    const targetCol = new THREE.Color(COLOURS[0].c);
    let targetMix = COLOURS[0].mix;
    const cleanupSwatches = [];
    $$('.sw').forEach((b) => {
      const handler = () => {
        colour = +b.dataset.c;
        $$('.sw').forEach((x) => x.setAttribute('aria-pressed', String(+x.dataset.c === colour)));
        targetCol.set(COLOURS[colour].c);
        targetMix = COLOURS[colour].mix;
      };
      b.addEventListener('click', handler);
      cleanupSwatches.push(() => b.removeEventListener('click', handler));
    });

    /* Phase DOM Elements */
    const blueprintEl = $('#blueprint');
    const mountainSceneEl = $('#mountain-scene');
    const mountainImgEl = $('#mountain-img');
    const sceneEl = $('#scene');
    const glass = $('#glass-container'), glassIn = $('#glass-gradient');
    const ph4 = $('#phase4-container'), ph5 = $('#phase5-container'), ph6 = $('#phase6-container'), foot = $('#phase6-footer');
    const words = [$('#word1'), $('#word2'), $('#word3')];
    const titles = {
      p3: maskChars($('#phase3-title')),
      p4: maskChars($('#phase4-title')),
      p5a: maskChars($('#phase5-title-1')),
      p5b: maskChars($('#phase5-title-2')),
      p6: maskChars($('#phase6-title')),
    };
    const shown = {};
    const showOnce = (k, chars) => {
      if (!shown[k]) {
        shown[k] = true;
        revealChars(chars, 24, 0);
      }
    };
    const hideAgain = (k, chars) => {
      if (shown[k]) {
        shown[k] = false;
        hideChars(chars);
      }
    };

    for (const g of $$('.flow-title')) {
      const chars = maskChars(g);
      const io = new IntersectionObserver((entries) => {
        if (entries[0].isIntersecting) {
          io.disconnect();
          revealChars(chars, 22, 0);
        }
      }, { threshold: 0.2 });
      io.observe(g);
    }

    /* ═══════════ AUTOMOTIVE CAN-BUS TELEMETRY HUD ═══════════ */
    const rctx = read.getContext('2d');
    const bctx = bg.getContext('2d');
    const CAN_RATE = 52 / 60;

    function canSignalWave(g) {
      const A = (B, Q, E) => Math.exp(-((B - Q) * (B - Q)) / (E * E));
      return 0.1 * A(g, 0.18, 0.04) - 0.12 * A(g, 0.34, 0.012) + 1.0 * A(g, 0.37, 0.014) - 0.22 * A(g, 0.4, 0.012) + 0.22 * A(g, 0.62, 0.06);
    }

    function drawTelemetryHUD(now, alpha, cx, cy, R, night) {
      if (alpha <= 0.001) {
        rctx.clearRect(0, 0, read.width, read.height);
        return;
      }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      rctx.save();
      rctx.clearRect(0, 0, read.width, read.height);
      rctx.scale(dpr, dpr);
      rctx.globalAlpha = alpha;
      const sec = now / 1000;
      const strokePrefix = night ? 'rgba(255,255,255,' : 'rgba(0,0,0,';

      // Outer radar sweep ring
      rctx.strokeStyle = strokePrefix + '0.18)';
      rctx.lineWidth = 1;
      rctx.beginPath();
      rctx.arc(cx, cy, R * 1.5, 0, Math.PI * 2);
      rctx.stroke();

      // Neon green CAN bus heartbeat wave
      rctx.strokeStyle = '#4cff7a';
      rctx.lineWidth = 1.6;
      rctx.beginPath();
      const K = 420;
      const F = Math.PI * 1.35;
      const M = -Math.PI * 0.5 - F / 2 + Math.sin(sec * 0.2) * 0.2;
      for (let i = 0; i <= K; i++) {
        const O = i / K;
        const c = M + O * F;
        const s = (O * 4.2 + sec * CAN_RATE) % 1;
        const L = R * 1.5 + canSignalWave(s) * R * 0.28;
        const Y = cx + Math.cos(c) * L;
        const N = cy + Math.sin(c) * L;
        if (i === 0) rctx.moveTo(Y, N);
        else rctx.lineTo(Y, N);
      }
      rctx.stroke();

      // Segmented radar arcs
      const segments = [
        [0, 0.22, '.85'],
        [0.22, 0.55, '.45'],
        [0.55, 0.82, '.65'],
        [0.82, 1, '.2']
      ];
      segments.forEach(([i, O, c]) => {
        rctx.strokeStyle = strokePrefix + c + ')';
        rctx.lineWidth = 6;
        rctx.beginPath();
        rctx.arc(cx, cy, R * 1.72, Math.PI * 0.75 + i * Math.PI * 1.5, Math.PI * 0.75 + O * Math.PI * 1.5 - 0.02);
        rctx.stroke();
      });

      // Vitals readout
      rctx.fillStyle = strokePrefix + '0.9)';
      const P_FONT = '200 44px Sarabun, sans-serif';
      const T_FONT = '500 12px Sarabun, sans-serif';
      const drawGauge = (val, label, x, y, align) => {
        rctx.textAlign = align;
        rctx.font = P_FONT;
        rctx.fillText(val, x, y);
        rctx.font = T_FONT;
        rctx.fillText(label, x, y + 20);
      };

      const volt = (12.6 + Math.sin(sec * 0.4) * 0.05).toFixed(1) + ' V';
      drawGauge(volt, 'BATTERY VOLTAGE', cx + R * 1.85, cy - R * 0.9, 'left');
      drawGauge('410 km', 'ESTIMATED RANGE', cx + R * 1.85, cy + R * 0.9, 'left');
      drawGauge('89°C', 'COOLANT TEMP', cx - R * 1.85, cy - R * 0.9, 'right');
      drawGauge('28 psi', 'REAR RIGHT TYRE · 4 PSI LOW', cx - R * 1.85, cy + R * 0.9, 'right');

      rctx.restore();
    }

    function drawAmbientBackground(night, cxNorm, cyNorm) {
      const w = 96, h = 54;
      bctx.fillStyle = night ? '#07090d' : '#ffffff';
      bctx.fillRect(0, 0, w, h);
      const grad = bctx.createRadialGradient(cxNorm * w, cyNorm * h, 2, cxNorm * w, cyNorm * h, w * 0.55);
      if (night) {
        grad.addColorStop(0, 'rgba(76,255,122,.16)');
        grad.addColorStop(1, 'rgba(76,255,122,0)');
      } else {
        grad.addColorStop(0, 'rgba(226,229,236,1)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
      }
      bctx.fillStyle = grad;
      bctx.fillRect(0, 0, w, h);
    }

    /* ═══════════ RENDER TICKER WITH SEAMLESS GLB-TO-PHOTO HANDOFF ═══════════ */
    let t0 = performance.now();
    let started = false;
    let isNight = false;
    let envMapBoost = 1;
    const vE = new THREE.Vector3();
    const yE = new THREE.Vector3();

    const offTick = tick((now) => {
      if (!sceneReady) return;
      p += (pTarget - p) * (REDUCE ? 1 : 0.10);
      const sec = (now - t0) / 1000;

      // 1. 3D GLB CAR POSITIONING & VISIBILITY
      const o = REDUCE ? 0 : sec * 0.15;
      const mProg = clamp01((p - 0.08) / 0.12);

      const isHeroPhase = p < 0.16;
      const isFinishPhase = p >= 0.72 && p <= 0.92;

      let carAlpha = 0;
      if (isHeroPhase) {
        // Hero: Tata Punch faces front, glides forward, and dissolves cleanly BEFORE the mountain photo arrives
        carAlpha = p < 0.08 ? 1 : Math.max(0, 1 - sstep(0.08, 0.14, p));
        vE.set(
          (1 - mProg) * (MOBILE ? 0 : 12),
          -2 - mProg * 4,
          -mProg * 35
        );
        yE.set(0.04, -0.38 * (1 - mProg) + (p < 0.08 ? Math.sin(o) * 0.04 : 0), 0);
      } else if (isFinishPhase) {
        // Phase 5: Tata Punch sits perfectly centered inside the telemetry HUD radar ring
        carAlpha = sstep(0.72, 0.76, p) * (1 - sstep(0.88, 0.92, p));
        vE.set(0, -1.2, 0);
        yE.set(0.06, 0.35 + (REDUCE ? 0 : Math.sin(o * 0.7) * 0.08), 0);
      } else {
        // 100% hidden during mountain photo, AI chat, blueprint, and footer (ZERO ghosting)
        carAlpha = 0;
      }

      carGroup.position.copy(vE);
      tilt.x += (tiltTo.x - tilt.x) * 0.06;
      tilt.y += (tiltTo.y - tilt.y) * 0.06;
      if (!dragging) {
        velYaw *= 0.92;
        velPitch *= 0.92;
        orbitYaw += velYaw;
        orbitPitch += velPitch;
      }
      carGroup.rotation.set(
        yE.x + tilt.x * 0.04 + orbitPitch,
        yE.y + tilt.y * 0.15 + orbitYaw,
        0
      );

      fg.style.opacity = carAlpha.toFixed(3);
      fg.style.display = carAlpha > 0.005 ? 'block' : 'none';

      // 2. FADE HERO TITLE AND INFO BLOCK IMMEDIATELY AS USER BEGINS TO SCROLL (NO SMUDGE)
      const heroFade = Math.max(0, 1 - sstep(0.004, 0.035, p));
      const heroTitle = $('#animated-hero-title');
      if (heroTitle) {
        heroTitle.style.opacity = heroFade.toFixed(3);
        heroTitle.style.pointerEvents = heroFade > 0.05 ? 'auto' : 'none';
      }
      const heroInfo = $('.hero-info-block');
      if (heroInfo) {
        heroInfo.style.opacity = heroFade.toFixed(3);
        heroInfo.style.pointerEvents = heroFade > 0.05 ? 'auto' : 'none';
      }

      // FADE SCROLL NARRATIVE IN ONLY AFTER HERO IS COMPLETELY GONE (PREVENTS ANY OVERLAP)
      const scrollContentWrapper = $('.scroll-content-wrapper');
      if (scrollContentWrapper) {
        const scFadeIn = sstep(0.035, 0.065, p);
        const scFadeOut = 1 - sstep(0.09, 0.13, p);
        const scFade = scFadeIn * scFadeOut;
        scrollContentWrapper.style.opacity = scFade.toFixed(3);
        scrollContentWrapper.style.display = scFade > 0.005 ? 'flex' : 'none';
        scrollContentWrapper.style.pointerEvents = scFade > 0.005 ? 'auto' : 'none';
      }

      // 3. MOUNTAIN ROAD SCENIC HANDOFF (Clean, pristine photo with zero clutter)
      const mFadeIn = sstep(0.14, 0.20, p);
      const mFadeOut = 1 - sstep(0.38, 0.44, p);
      const mountainAlpha = mFadeIn * mFadeOut;

      if (mountainSceneEl) {
        mountainSceneEl.style.opacity = mountainAlpha.toFixed(3);
        const isPhotoHolding = p > 0.18 && p < 0.40;
        mountainSceneEl.classList.toggle('active', isPhotoHolding);
        const parallaxY = (p - 0.28) * 50;
        if (mountainImgEl) {
          mountainImgEl.style.transform = `scale(1.02) translateY(${parallaxY.toFixed(1)}px)`;
        }
      }

      // 4. BLUEPRINT CUTAWAY (Clean standalone SVG, no 3D car clutter)
      const t_bp = sstep(0.55, 0.60, p) * (1 - sstep(0.70, 0.74, p));
      if (blueprintEl) {
        blueprintEl.style.opacity = t_bp.toFixed(3);
        blueprintEl.classList.toggle('on', t_bp > 0.3);
      }

      // 5. NIGHT MODE & 3D STUDIO LIGHTING
      const nightFactor = win(0.70, 0.74, 0.88, 0.92, p);
      if ((nightFactor > 0.5) !== isNight) {
        isNight = nightFactor > 0.5;
        document.body.classList.toggle('night', isNight);
      }

      if (isFinishPhase) {
        // Bright, crisp showroom lighting so the Tata Punch gleams inside the telemetry radar ring!
        keyLight.intensity = 2.6;
        rimLight.intensity = 1.9;
        ambientLight.intensity = 1.25;
        carMats.forEach((m) => {
          m.envMapIntensity = 1.6;
        });
      } else {
        keyLight.intensity = 2.0;
        rimLight.intensity = 1.2;
        ambientLight.intensity = 0.85;
        carMats.forEach((m) => {
          m.envMapIntensity = 1.2;
        });
      }

      // Color tint lerp
      currTint.lerp(targetCol, 0.1);
      currMix += (targetMix - currMix) * 0.1;
      carMats.forEach((m) => {
        if (m.userData.baseColor) {
          m.color.copy(m.userData.baseColor).lerp(currTint, currMix);
        }
      });

      // Night sky horizon background
      if (sceneEl) sceneEl.style.opacity = (1 - mountainAlpha).toFixed(3);

      // 6. KOKONUT AI CHAT COPILOT
      const M_glass = sstep(0.33, 0.40, p) * (1 - sstep(0.58, 0.64, p));
      if (glass) {
        glass.style.transform = `translateY(${((1 - M_glass) * 100).toFixed(2)}vh)`;
        glass.style.opacity = Math.min(1, M_glass * 2.5).toFixed(3);
        glass.classList.toggle('active', M_glass > 0.2);
        glass.style.pointerEvents = M_glass > 0.2 ? 'auto' : 'none';
      }
      if (glassIn) {
        glassIn.style.transform = `scale(${(0.88 + 0.12 * Math.min(1, M_glass * 1.5)).toFixed(3)})`;
      }
      if (M_glass > 0.5) showOnce('p3', titles.p3);
      else if (M_glass < 0.05) hideAgain('p3', titles.p3);

      // 7. PHASE 4 INSIDE (Clean, unblocked)
      const P4 = win(0.56, 0.60, 0.68, 0.71, p);
      if (ph4) {
        ph4.style.opacity = P4.toFixed(3);
        ph4.style.transform = `translateY(${((1 - P4) * 40).toFixed(1)}px)`;
        if (P4 > 0.6) showOnce('p4', titles.p4);
        else if (P4 < 0.05) hideAgain('p4', titles.p4);
      }

      // Flying words: Watch, Learn, Answer
      words.forEach((wEl, idx) => {
        if (!wEl) return;
        const k = 0.69 + idx * 0.027;
        const S = k + 0.042;
        const T = clamp01((p - k) / (S - k));
        wEl.style.opacity = (Math.sin(T * Math.PI) * 0.9).toFixed(3);
        wEl.style.transform = `translate3d(-50%,-50%,${((T - 0.5) * 1400).toFixed(0)}px) rotateY(${((0.5 - T) * 70).toFixed(1)}deg)`;
      });

      // 8. PHASE 5 FINISHES & TELEMETRY
      const R5 = win(0.74, 0.77, 0.89, 0.92, p);
      if (ph5) {
        ph5.style.opacity = R5.toFixed(3);
        if (R5 > 0.6) {
          showOnce('p5a', titles.p5a);
          showOnce('p5b', titles.p5b);
        } else if (R5 < 0.05) {
          hideAgain('p5a', titles.p5a);
          hideAgain('p5b', titles.p5b);
        }
      }

      // 9. PHASE 6 & FOOTER (Clean separation, zero overlapping)
      const i6 = sstep(0.88, 0.92, p);
      const footEnter = sstep(0.93, 0.98, p);
      if (ph6) {
        // Fade out "Let your car talk" completely BEFORE footer arrives so they NEVER collide
        const titleFade = Math.max(0, 1 - footEnter * 2.5);
        ph6.style.opacity = (i6 * titleFade).toFixed(3);
        ph6.style.display = (i6 * titleFade) > 0.01 ? 'flex' : 'none';
        if (i6 > 0.6 && footEnter < 0.1) showOnce('p6', titles.p6);
        else if (i6 < 0.05 || footEnter > 0.3) hideAgain('p6', titles.p6);
      }
      if (foot) {
        foot.style.transform = `translateY(${((1 - footEnter) * 100).toFixed(2)}vh)`;
      }

      // Project car center for HUD dials
      const carProj = carGroup.position.clone().project(camera);
      const cx = ((carProj.x + 1) / 2) * window.innerWidth;
      const cy = ((1 - carProj.y) / 2) * window.innerHeight;
      const dist = 2 * (camera.position.z - carGroup.position.z) * Math.tan((15 * Math.PI) / 180);
      const rPx = (13 / dist) * window.innerHeight;

      drawAmbientBackground(isNight, cx / window.innerWidth, cy / window.innerHeight);
      drawTelemetryHUD(now, win(0.775, 0.805, 0.86, 0.89, p), cx, cy, rPx, isNight);

      // Only invoke heavy 3D WebGL render when the 3D car is actually visible (saves GPU & battery on low-end machines)
      if (carAlpha > 0.005) {
        renderer.render(scene, camera);
      }
    });

    /* ═══════════ MARQUEE (VEHICLE TELEMETRY SIGNALS) ═══════════ */
    const marqueeEl = $('#marquee');
    if (marqueeEl) {
      const items = [
        'Battery voltage',
        'Tyre pressure',
        'Coolant temperature',
        'Fuel & range',
        'Fault codes',
        'Oil life',
        'Trips & economy',
        'Parked tamper events',
      ];
      marqueeEl.innerHTML = [...items, ...items].map((s) => `<span>${s}</span>`).join('');
    }

    /* ═══════════ KOKONUT AI CAN-BUS DIAGNOSTIC ENGINE ═══════════ */
    const chatLog = $('#log');
    const chatForm = $('#chatform');
    const chatInput = $('#q');
    const chatChips = $('#chips');

    const carData = {
      fuel: 62,
      range: 410,
      tyres: { FL: 32, FR: 32, RL: 31, RR: 28 },
      rec: '32 to 33',
      volt: 12.6,
      cool: 89,
      oil: 38,
      svcKm: 1240,
      svcWeeks: 5,
      eco: 6.3,
      lastTrip: '38 km yesterday evening, averaging 6.3 L/100 km',
    };

    const responses = [
      [
        /tyre|tire|pressure|psi|puncture/i,
        () =>
          `Three tyres are fine (front ${carData.tyres.FL} psi, rear left ${carData.tyres.RL}). Rear right is at ${carData.tyres.RR} psi, about 4 below the ${carData.rec} psi recommended. It has lost roughly 1 psi a day since Tuesday, so check it for a slow leak and top it up soon.`,
      ],
      [
        /batter|volt|start|dead|charge/i,
        () =>
          `Battery is healthy: ${carData.volt} V at rest and 14.1 V while charging on your last drive. Zero overnight drain recorded. Alternator output is optimal.`,
      ],
      [
        /fuel|range|tank|petrol|diesel|mileage|efficien|consum/i,
        () =>
          `The tank is at ${carData.fuel}%, good for about ${carData.range} km at your recent average of ${carData.eco} L/100 km.`,
      ],
      [
        /service|oil|maint/i,
        () =>
          `Oil life is ${carData.oil}%. Your next service is due in about ${carData.svcKm.toLocaleString()} km or ${carData.svcWeeks} weeks, whichever comes first.`,
      ],
      [
        /night|park|away|while|sleep|overnight|theft|tow|moved/i,
        () =>
          `Parked at home for 7 h 12 min. Battery steady at ${carData.volt} V, no door or motion events, and the rear right tyre dropped 1 psi. Nothing else to report.`,
      ],
      [
        /light|warning|fault|code|check engine|engine|dash|dtc/i,
        () =>
          'No fault codes are stored and no warning lights are on. Last full CAN scan was 2 minutes ago. The only flag is the low rear right tyre.',
      ],
      [
        /temp|coolant|overheat|hot|cool/i,
        () =>
          `Coolant is at ${carData.cool}°C, normal operating range. It reached 91°C on yesterday's uphill stretch and settled within a minute.`,
      ],
      [
        /trip|drive|yesterday|today|last/i,
        () => `Last trip: ${carData.lastTrip}. No harsh braking or fault events recorded.`,
      ],
      [
        /status|health|summary|how is|everything|ok\b|overall/i,
        () =>
          `All good, with one item: rear right tyre is 4 psi low. Battery ${carData.volt} V, coolant ${carData.cool}°C, ${carData.fuel}% fuel (${carData.range} km), zero DTC fault codes, next service in ${carData.svcKm.toLocaleString()} km.`,
      ],
      [
        /llm|model|ai|halo|brain/i,
        () =>
          `I am an onboard edge LLM connected directly to your vehicle's CAN-bus diagnostic transceiver. I continuously interpret live sensor frames and translate low-level OBD telemetries into conversational natural language.`,
      ],
      [
        /punch|tata|revotron|engine|spec|car/i,
        () =>
          `Tata Punch 1.2L Revotron engine: 3 cylinders, 86 PS @ 6000 rpm, 115 Nm torque. CAN-bus telemetry confirms all sensors (MAF, MAP, coolant, throttle position) are operating within factory nominal thresholds.`,
      ],
      [
        /breakdown|broke down|broken down|mechanic|service center|service centre|sos|stranded|emergency/i,
        () =>
          `EMERGENCY BREAKDOWN DETECTED · ROADSIDE ASSISTANCE DISPATCH: Vehicle Status: Immobilized / Breakdown Alert. Location: NH-48 Km 64.2, Khandala Ghat Bypass (18.7547° N, 73.4072° E). Nearest: Tata Authorized Service Centre (2.4 km, +91 98200 12345), Highway 24x7 Express Mechanic (1.8 km, +91 98765 43210). Click Initiate Automated Agent SOS Call to dispatch assistance.`,
      ],
    ];

    const defaultReply =
      'I can answer questions about tyres, battery, fuel and range, service and oil life, coolant temperature, OBD-II fault codes, trips, and parked status. Try one of the suggested prompts or ask me directly.';

    let isThinking = false;
    let vgptOnline = false;

    // ── Real User Geolocation Detection ──────────────────────
    let realUserLocation = {
      city: 'Chennai',
      region: 'Tamil Nadu',
      country: 'India',
      lat: 13.0895,
      lng: 80.2739,
      coordinates: '11.0168° N, 76.9558° E',
      formatted: 'North Coimbatore, Tamil Nadu, India',
      city: 'Coimbatore',
      region: 'Tamil Nadu',
      country: 'India',
      lat: 11.0168,
      lng: 76.9558,
      isGps: false,
    };

    let currentRadiusKm = 5;

    const detectRealLocation = async () => {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = Number(pos.coords.latitude.toFixed(4));
            const lng = Number(pos.coords.longitude.toFixed(4));
            try {
              const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&addressdetails=1`, {
                headers: { 'Accept-Language': 'en' },
                signal: AbortSignal.timeout(4500),
              });
              if (r.ok) {
                const geo = await r.json();
                const a = geo.address || {};
                const city = a.city || a.town || a.village || a.county || a.state_district || 'Local Area';
                const area = a.suburb || a.neighbourhood || a.road || '';
                const state = a.state || '';
                realUserLocation = {
                  city,
                  region: state,
                  country: a.country || 'India',
                  lat,
                  lng,
                  coordinates: `${lat}° N, ${lng}° E`,
                  formatted: [area, city, state].filter(Boolean).join(', ') || `${city}, ${state}`,
                  isGps: true,
                };
                return;
              }
            } catch {}
            realUserLocation = {
              city: 'Current Location',
              region: '',
              country: 'India',
              lat,
              lng,
              coordinates: `${lat}° N, ${lng}° E`,
              formatted: `Exact GPS: ${lat}° N, ${lng}° E`,
              isGps: true,
            };
          },
          () => {
            fetchIPLocation();
          },
          { timeout: 6000, maximumAge: 0, enableHighAccuracy: true }
        );
      } else {
        fetchIPLocation();
      }
    };

    const fetchIPLocation = async () => {
      try {
        const r = await fetch('http://ip-api.com/json');
        if (r.ok) {
          const d = await r.json();
          if (d && d.status === 'success') {
            realUserLocation = {
              city: d.city || 'Local Area',
              region: d.regionName || 'India',
              country: d.country || 'India',
              lat: Number(d.lat.toFixed(4)),
              lng: Number(d.lon.toFixed(4)),
              coordinates: `${d.lat.toFixed(4)}° N, ${d.lon.toFixed(4)}° E`,
              formatted: `${d.city}, ${d.regionName}, ${d.country}`,
              isGps: false,
            };
          }
        }
      } catch {}
    };
    detectRealLocation();

    // ── Check VehicleGPT backend connectivity ─────────────────
    const checkBackend = async () => {
      try {
        const r = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: 'ping', canData: carData, userLocation: realUserLocation }),
        });
        const d = await r.json();
        vgptOnline = d._source === 'vehiclegpt' || (d._source && d._source.startsWith('ollama'));
      } catch {
        vgptOnline = false;
      }
    };
    checkBackend();

    // Helper to render mechanics cards (accessible across AI answer formatter and dynamic event listeners)
    const renderProvidersHtml = (providers) => {
      if (!providers || providers.length === 0) {
        return `<div style="padding:0.75rem;font-size:12px;color:rgba(255,255,255,0.6);text-align:center;">No mechanics found in this immediate radius. Try selecting 10 km or 25 km above.</div>`;
      }
      return providers.map((p) => `
        <div class="ai-provider-card ${p.isOfficial ? 'official' : ''}" data-id="${p.id || ''}">
          <div class="provider-header">
            <div class="provider-name">${p.name}</div>
            <span class="provider-badge">${p.isOfficial ? 'Tata Authorized' : 'Verified 24/7'}</span>
          </div>
          <div class="provider-meta">
            <span class="provider-dist">📍 ${p.distance}</span>
            <span class="provider-eta">⚡ ETA: ${p.eta}</span>
            <span>⭐ ${p.rating}</span>
          </div>
          <div class="provider-services">${p.services}</div>
          ${p.address ? `<div style="font-size:10.5px;color:rgba(255,255,255,0.5);margin-bottom:0.45rem;">🏢 ${p.address}</div>` : ''}
          <div class="provider-actions">
            <a href="tel:${p.phone}" class="btn-provider-call" onclick="event.stopPropagation();">
              <span>📞</span>
              <span>Call ${p.displayPhone}</span>
            </a>
          </div>
        </div>
      `).join('');
    };

    // Helper to format structured automotive AI answers
    const formatStructuredAIAnswer = (rawText, meta) => {
      const text = rawText || meta?.answer || '';
      const status = meta?.status || 'OK';
      const latency = meta?._latency_ms;
      const modelSource = meta?._source || '';

      let modelLabel = 'Qwen 3.5 0.8B (Edge SLM)';
      if (modelSource === 'vehiclegpt') {
        modelLabel = 'VehicleGPT · Tata Telemetry';
      } else if (modelSource.startsWith('ollama')) {
        const tok = meta?._tokens_per_sec ? `${meta._tokens_per_sec} tok/s · ` : '';
        modelLabel = `Qwen 3.5 0.8B (${tok}950MB RAM)`;
      } else if (modelSource === 'qwen_edge_cdm') {
        modelLabel = 'Qwen 3.5 0.8B CDM (Edge SLM)';
      } else if (modelSource === 'local_engine' || modelSource === 'local_fallback') {
        modelLabel = 'Qwen 3.5 0.8B Fast-Path (0.18ms)';
      }

      // Check if this is a breakdown / emergency roadside assistance response
      const isBreakdown = meta?.data?.is_breakdown ||
        /EMERGENCY BREAKDOWN|ROADSIDE ASSISTANCE|Nearest Authorized Service|Immobilized|call.*mechanic|nearest mechanic|service center/i.test(text);

      // Check if this is a step-by-step repair guide
      const hasNumberedSteps = !isBreakdown && (/(?:^|\s)1\.\s+[^:]+:/i.test(text) || (/\b1\.\s+/i.test(text) && /\b2\.\s+/i.test(text)));

      // Check if this is a prediction response
      const isPrediction = !isBreakdown && (/\[VEHICLE PREDICTIONS/i.test(text) || /Predicted Range:/i.test(text));

      let statusClass = 'status-ok';
      let statusText = 'NOMINAL';
      if (isBreakdown) {
        statusClass = 'status-critical';
        statusText = 'EMERGENCY BREAKDOWN';
      } else if (status === 'WARNING' || (/leak|low|check/i.test(text) && /tyre|battery|coolant/i.test(text))) {
        statusClass = 'status-warning';
        statusText = 'ATTENTION';
      } else if (status === 'FAULT' || status === 'CRITICAL' || (meta?.active_faults && meta.active_faults.length > 0)) {
        statusClass = 'status-fault';
        statusText = 'DTC FAULT';
      }

      let domainTag = 'COPILOT';
      if (isBreakdown) domainTag = '24/7 ROADSIDE ASSISTANCE';
      else if (hasNumberedSteps) domainTag = 'WORKSHOP MANUAL';
      else if (isPrediction) domainTag = 'AI FORECAST';
      else if (/monthly|mileage|traffic|route|dimension|platform|gncap|revotron|alfa-arc/i.test(text)) domainTag = 'VEHICLE ADVISORY';
      else if (/tyre|battery|cool|rpm|gear|speed|fuel/i.test(text)) domainTag = 'CAN TELEMETRY';

      // Header Bar HTML
      let html = `
        <div class="ai-header-bar">
          <div class="ai-header-left">
            <span class="ai-status-pill ${statusClass}">● ${statusText}</span>
            <span class="ai-domain-tag">${domainTag}</span>
          </div>
          ${latency ? `<span class="ai-model-pill">⚡ ${latency}ms · ${modelLabel}</span>` : ''}
        </div>
      `;

      if (isBreakdown) {
        const loc = meta?.data?.location || {
          name: realUserLocation.formatted,
          coordinates: realUserLocation.coordinates,
          city: realUserLocation.city,
          lat: realUserLocation.lat,
          lng: realUserLocation.lng,
          isGps: realUserLocation.isGps,
        };
        const activeRadius = meta?.data?.radiusKm || currentRadiusKm || 5;
        const providers = meta?.data?.providers || [];

        html += `
          <div class="breakdown-loc-banner" data-lat="${loc.lat || ''}" data-lng="${loc.lng || ''}">
            <div class="breakdown-loc-header">
              <div class="breakdown-loc-title">
                <span>🚨</span>
                <span>Vehicle Immobilized · Breakdown Alert</span>
              </div>
              <span class="breakdown-gps-coords">${loc.isGps ? '🛰️ Exact Satellite GPS' : '📍 Breakdown Spot'}: ${loc.coordinates}</span>
            </div>
            <div class="breakdown-landmark">📍 Breakdown Spot: <strong class="breakdown-spot-name">${loc.name}</strong></div>

            <!-- Interactive Pinpoint & Radius Toolbar -->
            <div class="breakdown-location-toolbar">
              <div class="breakdown-search-row">
                <input type="text" class="breakdown-search-input" placeholder="Type exact breakdown road, area or landmark..." value="${loc.name || ''}" />
                <button type="button" class="btn-breakdown-search">🔍 Pinpoint</button>
                <button type="button" class="btn-breakdown-gps">🎯 Use GPS</button>
              </div>
              <div class="breakdown-radius-row">
                <span class="radius-label">Mechanic Radius:</span>
                <div class="radius-pills-group">
                  <button type="button" class="btn-radius-pill ${activeRadius === 3 ? 'active' : ''}" data-radius="3">3 km</button>
                  <button type="button" class="btn-radius-pill ${activeRadius === 5 ? 'active' : ''}" data-radius="5">5 km (Standard)</button>
                  <button type="button" class="btn-radius-pill ${activeRadius === 10 ? 'active' : ''}" data-radius="10">10 km</button>
                  <button type="button" class="btn-radius-pill ${activeRadius === 25 ? 'active' : ''}" data-radius="25">25 km (Highway)</button>
                </div>
              </div>
            </div>

            <div style="margin-top:6px;font-size:11px;color:rgba(255,255,255,0.65);">
              Live Telemetry: Tata Punch 1.2L Revotron · Battery 12.6V · Coolant 88°C · Oil 40 kPa
            </div>
          </div>

          <button type="button" class="btn-sos-trigger btn-agent-sos-call">
            <span class="sos-beacon"></span>
            <span>🚨 Initiate Automated Agent SOS Call & Dispatch</span>
          </button>

          <div class="sos-call-slot"></div>

          <div class="ai-topic-title-wrap" style="margin-top:0.4rem;margin-bottom:0.6rem;">
            <div class="ai-topic-title" style="font-size:13px;">
              <span>🛠️</span>
              <span class="mechanics-header-title">Nearest Mechanics within ${activeRadius} km Radius</span>
            </div>
          </div>

          <div class="ai-providers-container">
            ${renderProvidersHtml(providers)}
          </div>
        `;

      } else if (hasNumberedSteps) {
        // Parse Title and Steps
        let titlePart = '';
        let stepsPart = text;
        const firstStepIdx = text.search(/(?:^|\s)1\.\s+/);
        if (firstStepIdx !== -1) {
          titlePart = text.slice(0, firstStepIdx).trim();
          stepsPart = text.slice(firstStepIdx).trim();
        }

        // Clean up titlePart
        let cleanTitle = 'Air Conditioning & Climate Troubleshooting';
        let cleanSub = 'Tata Nexon & Punch Workshop Diagnostic Procedure';
        if (titlePart) {
          const catMatch = titlePart.match(/\(([^)]+)\)/);
          const domain = catMatch ? catMatch[1].toUpperCase() : 'MAINTENANCE';
          cleanTitle = titlePart.replace(/\([^)]+\)/g, '').replace(/Repair Tip for/i, '').replace(/:\s*$/, '').trim();
          cleanSub = `${domain} SYSTEM · STEP-BY-STEP REPAIR & VERIFICATION`;
        }

        html += `
          <div class="ai-topic-title-wrap">
            <div class="ai-topic-title">
              <span>🔧</span>
              <span>${cleanTitle}</span>
            </div>
            <div class="ai-topic-subtitle">${cleanSub}</div>
          </div>
        `;

        // Split by numbered step markers (1. , 2. , 3. , etc.) cleanly even if body contains numbers
        const rawStepBlocks = stepsPart.split(/(?=(?:^|\s)\d+\.\s+)/).map(s => s.trim()).filter(Boolean);
        const steps = [];
        rawStepBlocks.forEach((block, idx) => {
          const m = block.match(/^(\d+)\.\s*([^:]+?)(?::\s*(.*))?$/s);
          if (m) {
            steps.push({
              num: m[1].padStart(2, '0'),
              title: m[2].trim(),
              desc: (m[3] || '').trim(),
            });
          } else {
            steps.push({
              num: String(idx + 1).padStart(2, '0'),
              title: `Step ${idx + 1}`,
              desc: block.replace(/^\d+\.\s*/, '').trim(),
            });
          }
        });

        html += `<div class="ai-steps-container">`;
        steps.forEach((s) => {
          html += `
            <div class="ai-step-card" data-step="${s.num}">
              <div class="ai-step-top">
                <div class="ai-step-title-group">
                  <div class="ai-step-num">${s.num}</div>
                  <div class="ai-step-title">${s.title}</div>
                </div>
                <button type="button" class="ai-step-toggle-btn">Mark Done</button>
              </div>
              <div class="ai-step-desc">${s.desc}</div>
            </div>
          `;
        });
        html += `</div>`;

        // Safety Caution Box
        html += `
          <div class="ai-caution-box">
            <span class="ai-caution-icon">⚠️</span>
            <span>Safety Notice: Turn off engine and let surfaces cool before inspecting belts, moving pulleys, or high-pressure refrigerant ports.</span>
          </div>
        `;

      } else if (isPrediction) {
        // Parse Prediction Cards
        const fuelMatch = text.match(/Fuel Remaining:\s*([^-\n]+)/i);
        const rangeMatch = text.match(/Predicted Range:\s*([^-\n]+)/i);
        const thermalMatch = text.match(/Engine Thermal:\s*([^-\n]+)/i);
        const oilMatch = text.match(/Oil Pressure[^:]*:\s*([^-\n]+)/i);
        const healthMatch = text.match(/Health Assessment:\s*([^.\n]+)/i);

        html += `
          <div class="ai-topic-title-wrap">
            <div class="ai-topic-title">
              <span>🔮</span>
              <span>Predictive Vehicle Diagnostics (50 km Horizon)</span>
            </div>
            <div class="ai-topic-subtitle">CAN SENSOR MACHINE LEARNING PROJECTIONS</div>
          </div>
          <div class="ai-forecast-grid">
            <div class="ai-forecast-tile">
              <div class="forecast-tile-top"><span>⛽ Fuel Reserve</span><span>Nominal</span></div>
              <div class="forecast-tile-val">${fuelMatch ? fuelMatch[1].trim() : '60.1%'}</div>
              <div class="forecast-tile-sub">Projected rate: 6.3 L/100km</div>
            </div>
            <div class="ai-forecast-tile">
              <div class="forecast-tile-top"><span>🛣️ Projected Range</span><span>Safe</span></div>
              <div class="forecast-tile-val">${rangeMatch ? rangeMatch[1].trim() : '351 km'}</div>
              <div class="forecast-tile-sub">Horizon clearance: 100%</div>
            </div>
            <div class="ai-forecast-tile">
              <div class="forecast-tile-top"><span>🌡️ Engine Thermal</span><span>Optimal</span></div>
              <div class="forecast-tile-val">${thermalMatch ? thermalMatch[1].trim() : '89.2°C'}</div>
              <div class="forecast-tile-sub">Thermostat nominal (85–95°C)</div>
            </div>
            <div class="ai-forecast-tile">
              <div class="forecast-tile-top"><span>🛢️ Oil Pressure</span><span>Active</span></div>
              <div class="forecast-tile-val">${oilMatch ? oilMatch[1].trim() : '44.8 kPa'}</div>
              <div class="forecast-tile-sub">Full boundary lubrication</div>
            </div>
            <div class="forecast-assessment-bar">
              <span>🛡️</span>
              <span>${healthMatch ? healthMatch[1].trim() : 'All primary powertrain systems nominal.'}</span>
            </div>
          </div>
        `;
      } else {
        // Conversational / General / Telemetry Answer
        let formatted = text
          .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
          .split('\n\n')
          .filter(Boolean)
          .map((p) => `<p>${p.replace(/\n/g, '<br/>')}</p>`)
          .join('');

        if (!formatted) formatted = `<p>${text}</p>`;

        html += `<div class="ai-text-body">${formatted}</div>`;
      }

      // Active DTC line if present
      if (meta?.active_faults && meta.active_faults.length > 0) {
        html += `
          <div style="margin-top:6px;font-size:11px;color:#f87171;font-family:monospace;padding:4px 8px;background:rgba(239,68,68,0.1);border-radius:4px;border:1px solid rgba(239,68,68,0.25);">
            ⚠ Stored DTC Faults: ${meta.active_faults.join(', ')}
          </div>
        `;
      }

      // Interactive Action Toolbar (Copy & Voice Guidance)
      html += `
        <div class="ai-actions-row">
          <button type="button" class="ai-action-btn btn-copy-action">
            <span>📋</span>
            <span>Copy Text</span>
          </button>
          <button type="button" class="ai-action-btn btn-speak-action">
            <span>🔊</span>
            <span>Read Aloud</span>
          </button>
        </div>
      `;

      return html;
    };

    const addMessage = (role, text, meta) => {
      const bubble = document.createElement('div');
      const isBreakdown = meta?.data?.is_breakdown ||
        /EMERGENCY BREAKDOWN|ROADSIDE ASSISTANCE|Nearest Authorized Service|Immobilized/i.test(meta?.answer || text || '');
      bubble.className = 'msg ' + role + (isBreakdown ? ' ai-breakdown-card' : '');

      if (role === 'u') {
        bubble.innerHTML = `
          <div class="msg-u-header">
            <span class="msg-u-role">YOU · DRIVER</span>
            <span class="msg-u-dot"></span>
          </div>
          <div class="msg-u-text"></div>
        `;
        bubble.querySelector('.msg-u-text').textContent = text;
        chatLog.appendChild(bubble);
        chatLog.scrollTop = chatLog.scrollHeight;
        return bubble;
      }

      if (text === 'Thinking…') {
        bubble.innerHTML = `
          <div class="thinking-box">
            <div class="thinking-radar"></div>
            <span class="thinking-text">Querying on-board CAN bus & Qwen 3.5 0.8B…</span>
          </div>
        `;
        chatLog.appendChild(bubble);
        chatLog.scrollTop = chatLog.scrollHeight;
        return bubble;
      }

      const answer = meta?.answer || text || '';
      bubble.innerHTML = formatStructuredAIAnswer(answer, meta);

      // Attach Automated Agent SOS Call handler
      const sosBtn = bubble.querySelector('.btn-agent-sos-call');
      if (sosBtn) {
        sosBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          const slot = bubble.querySelector('.sos-call-slot');
          if (!slot) return;

          sosBtn.disabled = true;
          sosBtn.style.opacity = '0.7';
          sosBtn.innerHTML = '<span>📡</span><span>Automated Agent Call in Progress…</span>';

          const locName = meta?.data?.location?.name || realUserLocation.formatted;
          const locCoords = meta?.data?.location?.coordinates || realUserLocation.coordinates;
          const providers = meta?.data?.providers || [];
          const mainProvider = providers[0] || { name: 'Tata Quick Response Center', phone: '+91 44 2434 1234', displayPhone: '+91 44 2434 1234', eta: '7 mins' };

          slot.innerHTML = `
            <div class="sos-call-console">
              <div class="sos-call-top">
                <div class="sos-call-title">
                  <span class="sos-beacon"></span>
                  <span>AUTOMATED AGENT EMERGENCY CALL TO TATA RSA</span>
                </div>
                <span class="sos-call-duration">LIVE 00:03</span>
              </div>
              <div class="sos-call-steps">
                <div class="sos-call-step active" id="sos-step-1">
                  <span>📞</span><span>Dialing ${mainProvider.name} (${mainProvider.displayPhone || mainProvider.phone})…</span>
                </div>
                <div class="sos-call-step" id="sos-step-2">
                  <span>🛰️</span><span>Transmitting live CAN telemetry & GPS coordinates (${locCoords})…</span>
                </div>
                <div class="sos-call-step" id="sos-step-3">
                  <span>📡</span><span>Relaying vehicle location: ${locName} (Tata Punch 1.2L Revotron)…</span>
                </div>
                <div class="sos-call-step" id="sos-step-4">
                  <span>✅</span><span>Dispatch confirmed: Recovery Van assigned to ${locName}. ETA: ${mainProvider.eta || '7-8 mins'}.</span>
                </div>
              </div>
              <div class="sos-call-confirmed-banner" style="display:none;" id="sos-confirmed-box">
                <strong>🚨 Recovery Team Dispatched!</strong><br/>
                Mobile Service Van assigned to your verified location (<strong>${locName}</strong>).<br/>
                Assigned Hub: <strong>${mainProvider.name}</strong> · ETA: <strong>${mainProvider.eta || '7-8 minutes'}</strong>.
              </div>
            </div>
          `;

          // Voice announcement with real city
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            window.speechSynthesis.cancel();
            const cityName = meta?.data?.location?.city || realUserLocation.city || 'your area';
            const msg = new SpeechSynthesisUtterance(`Emergency roadside breakdown reported in ${cityName}. Live telemetry and verified GPS coordinates transmitted to ${mainProvider.name}. Mobile recovery van dispatched. Estimated arrival time is ${mainProvider.eta || 'eight minutes'}.`);
            msg.rate = 1.05;
            window.speechSynthesis.speak(msg);
          }

          setTimeout(() => {
            const s1 = slot.querySelector('#sos-step-1');
            const s2 = slot.querySelector('#sos-step-2');
            if (s1) { s1.classList.remove('active'); s1.classList.add('done'); s1.innerHTML = '<span>✓</span><span>Connected to Tata Quick Response Center (+91 98200 12345)</span>'; }
            if (s2) s2.classList.add('active');
          }, 1200);

          setTimeout(() => {
            const s2 = slot.querySelector('#sos-step-2');
            const s3 = slot.querySelector('#sos-step-3');
            if (s2) { s2.classList.remove('active'); s2.classList.add('done'); s2.innerHTML = `<span>✓</span><span>GPS Coordinates (${locCoords}) & CAN Telemetry Transmitted</span>`; }
            if (s3) s3.classList.add('active');
          }, 2400);

          setTimeout(() => {
            const s3 = slot.querySelector('#sos-step-3');
            const s4 = slot.querySelector('#sos-step-4');
            const conf = slot.querySelector('#sos-confirmed-box');
            if (s3) { s3.classList.remove('active'); s3.classList.add('done'); s3.innerHTML = '<span>✓</span><span>Vehicle Vitals & Stored DTCs Acknowledged by Dispatcher</span>'; }
            if (s4) s4.classList.add('done');
            if (conf) conf.style.display = 'block';
            sosBtn.innerHTML = '<span>✓</span><span>Agent SOS Call Completed & Van En Route</span>';
            sosBtn.style.background = 'linear-gradient(135deg, #059669 0%, #047857 100%)';
            sosBtn.style.opacity = '1';
          }, 3600);
        });
      }

      // Dynamic Radius Selection Handler
      bubble.querySelectorAll('.btn-radius-pill').forEach((pill) => {
        pill.addEventListener('click', async (e) => {
          e.stopPropagation();
          const r = parseInt(pill.getAttribute('data-radius'), 10) || 5;
          currentRadiusKm = r;
          bubble.querySelectorAll('.btn-radius-pill').forEach((p) => p.classList.remove('active'));
          pill.classList.add('active');

          const providersContainer = bubble.querySelector('.ai-providers-container');
          const headerTitle = bubble.querySelector('.mechanics-header-title');
          if (headerTitle) headerTitle.textContent = `Finding mechanics within ${r} km radius…`;
          if (providersContainer) providersContainer.innerHTML = `<div style="padding:1rem;font-size:12px;color:#00e5ff;text-align:center;">🔍 Searching OpenStreetMap workshops within ${r} km radius…</div>`;

          try {
            const res = await fetch('/api/mechanics-nearby', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                lat: meta?.data?.location?.lat || realUserLocation.lat,
                lng: meta?.data?.location?.lng || realUserLocation.lng,
                radiusKm: r,
                isGps: meta?.data?.location?.isGps || realUserLocation.isGps,
              }),
            });
            const d = await res.json();
            if (d.status === 'OK' && d.providers) {
              if (headerTitle) headerTitle.textContent = `Nearest Mechanics within ${r} km Radius (${d.foundCount || d.providers.length} found)`;
              if (providersContainer) providersContainer.innerHTML = renderProvidersHtml(d.providers);
            }
          } catch (err) {
            if (providersContainer) providersContainer.innerHTML = `<div style="padding:0.75rem;font-size:12px;color:#f87171;">Failed to refresh mechanics. Please try again.</div>`;
          }
        });
      });

      // Manual Breakdown Spot Pinpoint Search Handler
      const searchBtn = bubble.querySelector('.btn-breakdown-search');
      const searchInput = bubble.querySelector('.breakdown-search-input');
      const performSearch = async () => {
        const val = searchInput?.value.trim();
        if (!val) return;
        const providersContainer = bubble.querySelector('.ai-providers-container');
        const spotName = bubble.querySelector('.breakdown-spot-name');
        const coordsEl = bubble.querySelector('.breakdown-gps-coords');
        const headerTitle = bubble.querySelector('.mechanics-header-title');

        if (spotName) spotName.textContent = `Geocoding '${val}'…`;
        if (providersContainer) providersContainer.innerHTML = `<div style="padding:1rem;font-size:12px;color:#00e5ff;text-align:center;">📍 Pinpointing '${val}' & finding nearest mechanics…</div>`;

        try {
          const res = await fetch('/api/mechanics-nearby', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locationName: val, radiusKm: currentRadiusKm }),
          });
          const d = await res.json();
          if (d.status === 'OK' && d.location) {
            realUserLocation = d.location;
            if (meta?.data) {
              meta.data.location = d.location;
              meta.data.providers = d.providers;
            }
            if (spotName) spotName.textContent = d.location.formatted;
            if (coordsEl) coordsEl.textContent = `📍 Breakdown Spot: ${d.location.coordinates}`;
            if (headerTitle) headerTitle.textContent = `Nearest Mechanics within ${currentRadiusKm} km Radius (${d.foundCount || d.providers.length} found)`;
            if (providersContainer) providersContainer.innerHTML = renderProvidersHtml(d.providers);
          }
        } catch {
          if (providersContainer) providersContainer.innerHTML = `<div style="padding:0.75rem;font-size:12px;color:#f87171;">Unable to locate '${val}'. Please try a nearby road, landmark, or city.</div>`;
        }
      };

      if (searchBtn) searchBtn.addEventListener('click', performSearch);
      if (searchInput) {
        searchInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            performSearch();
          }
        });
      }

      // Exact Device GPS Refresh Handler
      const gpsBtn = bubble.querySelector('.btn-breakdown-gps');
      if (gpsBtn) {
        gpsBtn.addEventListener('click', () => {
          const spotName = bubble.querySelector('.breakdown-spot-name');
          const coordsEl = bubble.querySelector('.breakdown-gps-coords');
          const providersContainer = bubble.querySelector('.ai-providers-container');
          if (spotName) spotName.textContent = 'Acquiring satellite GPS coordinates…';
          if (providersContainer) providersContainer.innerHTML = `<div style="padding:1rem;font-size:12px;color:#00e5ff;text-align:center;">🛰️ Locking on exact GPS satellites…</div>`;

          if (typeof navigator !== 'undefined' && navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
              async (pos) => {
                const lat = Number(pos.coords.latitude.toFixed(4));
                const lng = Number(pos.coords.longitude.toFixed(4));
                try {
                  const res = await fetch('/api/mechanics-nearby', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ lat, lng, radiusKm: currentRadiusKm, isGps: true }),
                  });
                  const d = await res.json();
                  if (d.status === 'OK' && d.location) {
                    realUserLocation = d.location;
                    if (meta?.data) {
                      meta.data.location = d.location;
                      meta.data.providers = d.providers;
                    }
                    if (spotName) spotName.textContent = d.location.formatted;
                    if (coordsEl) coordsEl.textContent = `🛰️ Exact Satellite GPS: ${d.location.coordinates}`;
                    if (searchInput) searchInput.value = d.location.formatted;
                    if (providersContainer) providersContainer.innerHTML = renderProvidersHtml(d.providers);
                  }
                } catch {}
              },
              () => {
                if (spotName) spotName.textContent = 'Device GPS unavailable';
                if (providersContainer) providersContainer.innerHTML = `<div style="padding:0.75rem;font-size:12px;color:#f87171;">GPS permission was denied or timed out. Please enter your breakdown road or area in the input box above.</div>`;
              },
              { timeout: 8000, maximumAge: 0, enableHighAccuracy: true }
            );
          }
        });
      }

      // Attach step toggles, copy, and speech
      bubble.querySelectorAll('.ai-step-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const card = btn.closest('.ai-step-card');
          if (card) {
            const isDone = card.classList.toggle('is-done');
            btn.textContent = isDone ? '✓ Done' : 'Mark Done';
          }
        });
      });

      const copyBtn = bubble.querySelector('.btn-copy-action');
      if (copyBtn) {
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          navigator.clipboard.writeText(answer);
          const original = copyBtn.innerHTML;
          copyBtn.innerHTML = '<span>✓</span><span>Copied!</span>';
          setTimeout(() => { copyBtn.innerHTML = original; }, 2000);
        });
      }

      const speakBtn = bubble.querySelector('.btn-speak-action');
      if (speakBtn) {
        let isSpeaking = false;
        speakBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (typeof window !== 'undefined' && window.speechSynthesis) {
            if (isSpeaking) {
              window.speechSynthesis.cancel();
              isSpeaking = false;
              speakBtn.classList.remove('active');
              speakBtn.innerHTML = '<span>🔊</span><span>Read Aloud</span>';
            } else {
              window.speechSynthesis.cancel();
              const plain = answer.replace(/[*_#`]/g, '');
              const utter = new SpeechSynthesisUtterance(plain);
              utter.rate = 1.05;
              utter.onend = () => {
                isSpeaking = false;
                speakBtn.classList.remove('active');
                speakBtn.innerHTML = '<span>🔊</span><span>Read Aloud</span>';
              };
              isSpeaking = true;
              speakBtn.classList.add('active');
              speakBtn.innerHTML = '<span>⏹</span><span>Stop Voice</span>';
              window.speechSynthesis.speak(utter);
            }
          }
        });
      }

      chatLog.appendChild(bubble);
      chatLog.scrollTop = chatLog.scrollHeight;
      return bubble;
    };

    const askQuestion = async (qText) => {
      const query = qText.trim();
      if (!query || isThinking) return;
      isThinking = true;
      if (chatInput) chatInput.value = '';
      addMessage('u', query);
      const aiBubble = addMessage('a', 'Thinking…');
      const t0 = Date.now();

      try {
        const res = await fetch('/api/query', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query, canData: carData, userLocation: realUserLocation, radiusKm: currentRadiusKm }),
        });
        if (res.ok) {
          const data = await res.json();
          data._latency_ms = Date.now() - t0;
          if (data?.data?.location) {
            realUserLocation = data.data.location;
          }
          aiBubble.remove();
          addMessage('a', '', data);
          vgptOnline = data._source === 'vehiclegpt' || (data._source && data._source.startsWith('ollama'));
          isThinking = false;
          return;
        }
      } catch (err) {
        // Fall through to instant local fallback
      }

      // Bulletproof local CAN fallback — zero error screen
      const match = responses.find(([regex]) => regex.test(query));
      const fallbackAnswer = match ? match[1]() : defaultReply;
      aiBubble.remove();
      addMessage('a', '', {
        status: 'OK',
        answer: fallbackAnswer,
        severity: 'NONE',
        _latency_ms: Date.now() - t0,
        _source: 'local_engine',
      });
      isThinking = false;
    };

    const chips = [
      '🚨 Car broke down! Call nearest mechanic',
      '🔧 How to fix AC blowing warm air',
      '🔮 Predict vehicle health for next 50 km',
      '🚗 What is my speed and gear right now?',
      '⛽ Check fuel level & estimated range',
      '🔋 Diagnose battery voltage & charging',
    ];
    if (chatChips) {
      chatChips.innerHTML = '';
      chips.forEach((cText) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = cText;
        btn.onclick = () => askQuestion(cText);
        chatChips.appendChild(btn);
      });
    }

    if (chatForm && chatInput) {
      chatForm.addEventListener('submit', (e) => {
        e.preventDefault();
        askQuestion(chatInput.value);
      });
    }
    if (chatLog) {
      chatLog.innerHTML = '';
      addMessage('a', "Hello! I am VehicleGPT, your on-board vehicle AI copilot powered by Qwen 3.5 0.8B. I continuously monitor live CAN-bus sensors, provide step-by-step workshop repair guides, and answer general driving questions.", {
        status: 'OK',
        _latency_ms: 1,
        _source: 'vehiclegpt',
      });

      // Isolate chat log wheel events so internal scroll operates freely and independently
      // without triggering the outer Lenis page scroll / timeline flow.
      chatLog.addEventListener('wheel', (e) => {
        e.stopPropagation();
      }, { passive: true });
    }

    // ── Continuous CAN telemetry stream replaying sample_drive.csv ────────
    let activeFrameData = { ...carData, frameIndex: 0, isPlaying: true, gear: 'N' };

    const renderTelemetryUI = (t) => {
      if (!t) return;
      activeFrameData = { ...activeFrameData, ...t };
      carData.fuel = t.fuel;
      carData.range = t.range;
      carData.cool = t.cool;
      carData.volt = t.volt;
      carData.oil = t.oil;
      carData.speed = t.speed;
      carData.rpm = t.rpm;
      carData.gear = t.gear;
      carData.frameIndex = t.frameIndex;
      if (t.tyres) carData.tyres = t.tyres;

      // 1. Digital Meters
      const elSpeed = $('#m-speed');
      if (elSpeed) elSpeed.textContent = (t.speed || 0).toFixed(1);
      const barSpeed = $('#bar-speed');
      if (barSpeed) barSpeed.style.width = Math.min(100, ((t.speed || 0) / 140) * 100) + '%';
      const elGear = $('#m-gear');
      if (elGear) elGear.textContent = 'GEAR ' + (t.gear || 'N');

      const elRpm = $('#m-rpm');
      if (elRpm) elRpm.textContent = (t.rpm || 820).toLocaleString();
      const barRpm = $('#bar-rpm');
      if (barRpm) barRpm.style.width = Math.min(100, ((t.rpm || 820) / 6000) * 100) + '%';
      const elRpmPill = $('#m-rpm-pill');
      if (elRpmPill) {
        elRpmPill.textContent = t.rpm > 3500 ? 'HIGH' : t.rpm > 1200 ? 'ACTIVE' : 'IDLE';
        elRpmPill.className = 'meter-pill ' + (t.rpm > 3500 ? 'amber' : '');
      }

      const elFuel = $('#m-fuel');
      if (elFuel) elFuel.textContent = (t.fuel || 64.8).toFixed(1);
      const barFuel = $('#bar-fuel');
      if (barFuel) barFuel.style.width = (t.fuel || 64.8) + '%';
      const elRange = $('#m-range');
      if (elRange) elRange.textContent = '~' + (t.range || 420) + ' km';

      const elCool = $('#m-cool');
      if (elCool) elCool.textContent = (t.cool || 85.0).toFixed(1);
      const barCool = $('#bar-cool');
      if (barCool) barCool.style.width = Math.min(100, ((t.cool || 85.0) / 120) * 100) + '%';
      const elCoolPill = $('#m-cool-pill');
      if (elCoolPill) {
        elCoolPill.textContent = t.cool > 100 ? 'HOT' : t.cool > 92 ? 'WARM' : 'NOMINAL';
        elCoolPill.className = 'meter-pill ' + (t.cool > 95 ? 'amber' : '');
      }

      const elVolt = $('#m-volt');
      if (elVolt) elVolt.textContent = (t.volt || 12.6).toFixed(2);
      const barVolt = $('#bar-volt');
      if (barVolt) barVolt.style.width = Math.min(100, Math.max(10, (((t.volt || 12.6) - 10) / 5) * 100)) + '%';
      const elVoltPill = $('#m-volt-pill');
      if (elVoltPill) {
        elVoltPill.textContent = t.volt >= 13.8 ? 'CHARGING' : t.volt >= 12.4 ? 'HEALTHY' : 'LOW';
        elVoltPill.className = 'meter-pill ' + (t.volt < 12.2 ? 'amber' : 'blue');
      }

      const elOil = $('#m-oil');
      if (elOil) elOil.textContent = (t.oil || 40.0).toFixed(1);
      const barOil = $('#bar-oil');
      if (barOil) barOil.style.width = Math.min(100, ((t.oil || 40.0) / 75) * 100) + '%';

      const elTyreFL = $('#m-tyre-fl');
      if (elTyreFL && t.tyres) elTyreFL.textContent = (t.tyres.FL || 32.0).toFixed(1);

      // 2. Playback Badges & Controls
      const elBadge = $('#cockpit-frame-badge');
      if (elBadge) {
        const framePad = String(t.frameIndex || 0).padStart(4, '0');
        const totPad = String(t.totalFrames || 1000).padStart(4, '0');
        elBadge.textContent = `FRAME ${framePad} / ${totPad}`;
      }

      const elTime = $('#cockpit-time-readout');
      if (elTime) {
        const sec = t.frameIndex || 0;
        const m = String(Math.floor(sec / 60)).padStart(2, '0');
        const s = String(sec % 60).padStart(2, '0');
        elTime.textContent = `${m}:${s}`;
      }

      const elRawTs = $('#cockpit-ts-raw');
      if (elRawTs) elRawTs.textContent = `TS: ${t.timestamp_us || '0'} µs`;

      const elSlider = $('#cockpit-scrubber');
      if (elSlider && document.activeElement !== elSlider) {
        elSlider.value = t.frameIndex || 0;
      }

      // Play/Pause button state
      const btnPlay = $('#btn-toggle-play');
      if (btnPlay) {
        btnPlay.innerHTML = t.isPlaying ? '⏸ Pause' : '▶ Play';
        btnPlay.className = 'btn-ctrl btn-play-pause ' + (t.isPlaying ? '' : 'is-paused');
      }

      const dot = $('#cockpit-pulse-dot');
      if (dot) {
        if (t.isPlaying) dot.classList.remove('paused');
        else dot.classList.add('paused');
      }

      // Live status line in chat
      const liveEl = $('#live');
      if (liveEl) {
        const icon = vgptOnline ? '🟢' : '🟡';
        const src = vgptOnline ? 'Qwen 3.5 0.8B (Edge SLM)' : 'Edge local';
        const spd = t.speed !== undefined ? ` · ${t.speed.toFixed(1)} km/h · Fuel ${t.fuel.toFixed(1)}%` : '';
        const playState = t.isPlaying ? 'Playing' : 'Paused';
        liveEl.textContent = `${icon} ${playState} Frame ${t.frameIndex}${spd} · ${src}`;
      }

      // Floating Mini HUD elements
      const hudSpd = $('#hud-speed');
      if (hudSpd) hudSpd.textContent = (t.speed || 0).toFixed(0);
      const hudFuel = $('#hud-fuel');
      if (hudFuel) hudFuel.textContent = (t.fuel || 64.8).toFixed(1) + '%';
      const hudBtn = $('#hud-btn-play');
      if (hudBtn) hudBtn.textContent = t.isPlaying ? '⏸' : '▶';
    };

    const updateTelemetry = async () => {
      try {
        const res = await fetch('/api/telemetry');
        if (res.ok) {
          const t = await res.json();
          renderTelemetryUI(t);
        }
      } catch {}
    };

    const sendTelemetryAction = async (payload) => {
      try {
        const res = await fetch('/api/telemetry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (res.ok) {
          const t = await res.json();
          renderTelemetryUI(t);
        }
      } catch {}
    };

    // Wire Playback Buttons
    const btnPlay = $('#btn-toggle-play');
    if (btnPlay) btnPlay.onclick = () => sendTelemetryAction({ action: 'toggle' });

    const btnPrev = $('#btn-step-prev');
    if (btnPrev) btnPrev.onclick = () => sendTelemetryAction({ action: 'step', delta: -10 });

    const btnNext = $('#btn-step-next');
    if (btnNext) btnNext.onclick = () => sendTelemetryAction({ action: 'step', delta: 10 });

    const btnReset = $('#btn-reset-sim');
    if (btnReset) btnReset.onclick = () => sendTelemetryAction({ action: 'seek', frame: 0 });

    const scrubber = $('#cockpit-scrubber');
    if (scrubber) {
      scrubber.oninput = (e) => sendTelemetryAction({ action: 'seek', frame: +e.target.value });
    }

    const btnAskFrame = $('#btn-ask-telemetry');
    if (btnAskFrame) {
      btnAskFrame.onclick = () => {
        const q = `Explain my vehicle's current status at Frame ${activeFrameData.frameIndex}: traveling at ${activeFrameData.speed} km/h in Gear ${activeFrameData.gear}, engine RPM ${activeFrameData.rpm}, fuel level ${activeFrameData.fuel}%, and coolant temp ${activeFrameData.cool}°C.`;
        askQuestion(q);
      };
    }

    // Mini floating HUD play toggle
    const hudBtn = $('#hud-btn-play');
    if (hudBtn) hudBtn.onclick = () => sendTelemetryAction({ action: 'toggle' });

    // Initial load + 1s periodic polling
    updateTelemetry();
    const liveTimer = setInterval(updateTelemetry, 1000);

    /* ═══════════ ODOMETER PRELOADER ═══════════ */
    const pre = $('#preloader'), col = $('#odometer-numbers');
    let offOdo = null;
    if (pre && col) {
      col.innerHTML = Array.from({ length: 101 }, (_, i) => `<div>${String(i).padStart(3, '0')}</div>`).join('');
      const heroChars = maskChars($('#animated-hero-title'));
      const reveal = () => {
        $$('.reveal-anim').forEach((el) => el.classList.remove('preload-hidden'));
        revealChars(heroChars, 30, 200);
        started = true;
        t0 = performance.now();
      };
      if (REDUCE) {
        pre.remove();
        heroChars.forEach((c) => c.classList.add('revealed'));
        $$('.reveal-anim').forEach((el) => el.classList.remove('preload-hidden'));
        started = true;
      } else {
        let v = 0, done = false;
        const tStart = performance.now();
        offOdo = tick((now) => {
          const fontsLoaded = typeof document.fonts !== 'undefined' ? document.fonts.status === 'loaded' : true;
          const elapsed = now - tStart;
          const gate = (sceneReady && fontsLoaded && elapsed > 500) || elapsed > 1600;
          const to = gate ? 100 : 86;
          v += (to - v) * (gate ? 0.12 : 0.04);
          const n = Math.round(v);
          col.style.transform = `translateY(-${n * 4}rem)`;
          if (!done && gate && v > 99.4) {
            done = true;
            col.style.transform = 'translateY(-400rem)';
            pre.style.opacity = '0';
            reveal();
            setTimeout(() => {
              pre.remove();
              if (offOdo) offOdo();
            }, 1000);
          }
        });
      }
    }

    return () => {
      cancelAnimationFrame(raf);
      clearInterval(liveTimer);
      if (lenis) lenis.destroy();
      window.removeEventListener('resize', fit);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      cleanupNavLinks.forEach((fn) => fn());
      cleanupSwatches.forEach((fn) => fn());
      if (offTick) offTick();
      if (offOdo) offOdo();
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m.map) m.map.dispose();
            if (m.metalnessMap) m.metalnessMap.dispose();
            if (m.normalMap) m.normalMap.dispose();
            m.dispose();
          });
        }
      });
      if (scene.environment) scene.environment.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div ref={rootRef} style={{ width: '100%', height: '1200vh', minHeight: '1200vh', position: 'relative' }}>
      {/* PRELOADER ODOMETER */}
      <div id="preloader">
        <div className="odo">
          [&nbsp;
          <div className="odo-win">
            <div id="odometer-numbers"></div>
          </div>
          &nbsp;/ 100 ]
        </div>
      </div>

      {/* AMBIENT & SCENE CANVAS / LAYERS */}
      <canvas id="bg" aria-hidden="true"></canvas>

      {/* ═════ HIGH-DEFINITION MOUNTAIN SCENE (CRYSTAL-CLEAR 16:9 4K TATA PUNCH PHOTO) ═════ */}
      <div id="mountain-scene" aria-hidden="true">
        <div className="mountain-img-wrap">
          <img
            id="mountain-img"
            src="/assets/tata-punch-mountain.jpg"
            alt="Tata Punch in scenic mountain landscape"
            className="mountain-bg-img"
          />
          <div className="mountain-vignette"></div>
        </div>

        {/* Sleek Automotive Telemetry HUD (Cleanly Docked at Bottom) */}
        <div className="mountain-hud-bottom">
          <div className="mountain-hud-capsule">
            <div className="mountain-capsule-header">
              <div className="mountain-capsule-badge">
                <i className="pulse-indicator" aria-hidden="true"></i>
                <span>TERRAIN ADAPTATION · LIVE CAN 2.0B</span>
              </div>
              <span className="mountain-capsule-sub">1.2L REVOTRON · HIGH-ALTITUDE ECU CALIBRATION</span>
            </div>
            <div className="mountain-specs-grid">
              <div className="mountain-spec-col">
                <span className="mountain-spec-val">1,840<small>m</small></span>
                <span className="mountain-spec-tag">ELEVATION</span>
              </div>
              <div className="mountain-spec-col">
                <span className="mountain-spec-val">18<small>°C</small></span>
                <span className="mountain-spec-tag">AMBIENT</span>
              </div>
              <div className="mountain-spec-col">
                <span className="mountain-spec-val">89<small>°C</small></span>
                <span className="mountain-spec-tag">COOLANT</span>
              </div>
              <div className="mountain-spec-col">
                <span className="mountain-spec-val green-text">0<small>DTC</small></span>
                <span className="mountain-spec-tag">DIAGNOSTICS: OK</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* NIGHT SKY SCENE */}
      <div id="scene" aria-hidden="true">
        <i className="day"></i>
        <i className="night"></i>
      </div>

      {/* HERO SECTION */}
      <h1 className="hero-title ink" id="animated-hero-title">
        The LLM that
        <br />
        <span className="hero-subtitle">watches your car</span>
      </h1>
      <canvas id="fg" aria-label="Halo, an automotive LLM module, rotating in 3D; drag to spin"></canvas>
      <canvas id="read" aria-hidden="true"></canvas>

      <a className="hero-logo ink preload-hidden reveal-anim from-top" href="#top">
        <i aria-hidden="true"></i>Halo AI
      </a>
      <div className="hero-nav ink preload-hidden reveal-anim from-top">
        <a data-to="0.28">
          scenic <span className="nav-arrow">↗</span>
        </a>
        <a data-to="0.45">
          ask llm <span className="nav-arrow">↗</span>
        </a>
        <a data-to="0.62">
          inside <span className="nav-arrow">↗</span>
        </a>
        <a data-to="0.84">
          finish <span className="nav-arrow">↗</span>
        </a>
        <a data-to="1.0">
          early access <span className="nav-arrow">↗</span>
        </a>
      </div>

      {/* FLOATING MINI TELEMETRY HUD */}
      <div className="floating-hud-pill" title="Live Telemetry HUD — click to jump to cockpit">
        <button id="hud-btn-play" className="hud-btn-toggle" type="button" title="Play / Pause Replay">
          ⏸
        </button>
        <div className="hud-item">
          <span>SPD:</span>
          <strong id="hud-speed">0</strong>
          <small style={{ opacity: 0.6 }}>km/h</small>
        </div>
        <div className="hud-item fuel-item">
          <span>FUEL:</span>
          <strong id="hud-fuel">64.8%</strong>
        </div>
        <a
          href="#glass-container"
          data-to="0.45"
          style={{
            color: '#00e5ff',
            textDecoration: 'none',
            fontSize: '11px',
            display: 'flex',
            alignItems: 'center',
            gap: '3px',
            marginLeft: '0.25rem',
          }}
        >
          COCKPIT ↘
        </a>
      </div>

      <div className="hero-info-block ink preload-hidden reveal-anim from-bottom">
        <div className="hi-top">
          <span>( A )</span>
          <span>[ 001 / 004 ]</span>
        </div>
        <div className="hi-text">
          Halo plugs into your car’s diagnostic port, reads it around the clock, and answers in plain language.{' '}
          <a
            href="#llm"
            data-to="0.45"
            style={{
              textDecoration: 'underline',
              textUnderlineOffset: '4px',
              textDecorationThickness: '1px',
              fontWeight: '500',
              cursor: 'pointer',
              display: 'inline-block',
              marginTop: '0.4rem',
            }}
          >
            Talk to the LLM copilot →
          </a>
        </div>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <a href="#llm" className="hi-btn" data-to="0.45" style={{ padding: '0.875rem 1.6rem' }}>
            TALK TO LLM ↗
          </a>
          <a href="#early-access" className="hi-btn" data-to="1.0" style={{ padding: '0.875rem 1.6rem' }}>
            EARLY ACCESS
          </a>
        </div>
      </div>

      {/* SCROLL-TIDE CINEMATIC NARRATIVE */}
      <div className="scroll-content-wrapper ink">
        <div className="scroll-title-container" id="scroll-title">
          <h3 className="animated-title flow-title">
            Always on, even parked,
            <br />
            reading every signal,
            <br />
            <span style={{ fontWeight: '500' }}>and ready when you ask.</span>
          </h3>
        </div>
        <div className="clients-container">
          <div className="clients-subtitle">It watches</div>
          <div className="clients-line"></div>
          <div className="marquee-container">
            <div className="marquee-content" id="marquee"></div>
          </div>
        </div>
        <div
          className="feature-container"
          style={{
            alignItems: 'flex-end',
            paddingRight: 'var(--raw-inset)',
            paddingLeft: 'var(--raw-inset)',
          }}
        >
          <h3 className="feature-title animated-title flow-title" style={{ textAlign: 'right' }}>
            No dashboards to learn,
            <br />
            no codes to decode,
            <br />
            <span style={{ fontWeight: '500' }}>just ask</span>
          </h3>
        </div>
      </div>

      {/* BLUEPRINT / X-RAY CAR CUTAWAY OVERLAY */}
      <div id="blueprint" className="ink" aria-hidden="true">
        <svg viewBox="0 0 1200 560" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Cutaway of the car showing live diagnostic tap points">
          <g className="l">
            <path
              d="M222 402 L222 290 C222 262 228 244 238 224 L262 130 L272 122 L690 120 C716 120 736 130 756 154 L836 238 C846 248 860 252 876 256 L962 268 C976 270 984 282 984 300 L984 402 L912 402 A74 74 0 1 0 770 402 L426 402 A74 74 0 1 0 284 402 Z"
              pathLength="1"
              style={{ '--i': 0 }}
            />
            <circle cx="355" cy="382" r="58" pathLength="1" style={{ '--i': 2 }} />
            <circle cx="841" cy="382" r="58" pathLength="1" style={{ '--i': 2 }} />
            <circle cx="355" cy="382" r="36" pathLength="1" className="t" style={{ '--i': 3 }} />
            <circle cx="841" cy="382" r="36" pathLength="1" className="t" style={{ '--i': 3 }} />
            <circle cx="355" cy="382" r="10" pathLength="1" className="t" style={{ '--i': 3 }} />
            <circle cx="841" cy="382" r="10" pathLength="1" className="t" style={{ '--i': 3 }} />
            <path d="M276 146 L688 144 C708 144 722 152 738 168 L800 240 L270 240 C268 200 270 170 276 146 Z" pathLength="1" style={{ '--i': 3 }} />
            <path d="M492 146 L490 240 M508 145 L507 240" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M500 240 L498 396" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M772 244 L776 392" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M276 240 L274 392" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M440 268 L470 268" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M690 268 L720 268" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M290 112 L690 110" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M770 214 L792 212 L798 226 L776 228 Z" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M930 266 L976 276 L974 300 L928 292 Z" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M224 262 L246 260 L244 296 L222 298 Z" pathLength="1" className="t" style={{ '--i': 4 }} />
            <path d="M610 164 C594 164 588 188 594 238 L606 262" pathLength="1" style={{ '--i': 5 }} />
            <path d="M594 238 L670 262 L680 270 L620 272" pathLength="1" style={{ '--i': 5 }} />
            <path d="M360 170 C346 170 342 194 348 238 L360 262" pathLength="1" style={{ '--i': 5 }} />
            <path d="M348 238 L428 262" pathLength="1" style={{ '--i': 5 }} />
            <path d="M684 188 L704 226" pathLength="1" style={{ '--i': 5 }} />
            <path d="M694 220 L718 256" pathLength="1" style={{ '--i': 5 }} />
            <path d="M718 236 C746 236 770 240 780 244" pathLength="1" style={{ '--i': 5 }} />
            <path d="M830 262 L900 262 L900 304 L830 304 Z" pathLength="1" style={{ '--i': 6 }} />
            <path d="M908 270 L954 270 L954 300 L908 300 Z M918 266 L918 270 M944 266 L944 270" pathLength="1" style={{ '--i': 6 }} />
            <path d="M962 308 L962 380 M970 308 L970 380 M978 308 L978 380" pathLength="1" style={{ '--i': 6 }} />
            <path d="M470 372 C470 366 478 362 488 362 L700 362 C710 362 718 366 718 372 L718 396 L470 396 Z" pathLength="1" style={{ '--i': 6 }} />
            <path d="M60 440 L1140 440" pathLength="1" className="t dash" style={{ '--i': 1 }} />
            <path d="M718 246 L718 84 L572 84" pathLength="1" className="t g" style={{ '--i': 7 }} />
            <path d="M931 285 L931 84 L944 84" pathLength="1" className="t g" style={{ '--i': 7 }} />
            <path d="M970 345 L970 484" pathLength="1" className="t g" style={{ '--i': 7 }} />
            <path d="M594 380 L594 484" pathLength="1" className="t g" style={{ '--i': 7 }} />
            <path d="M355 440 L355 484" pathLength="1" className="t a" style={{ '--i': 7 }} />
          </g>
          <g className="lb">
            <circle className="pulse" cx="718" cy="246" r="7" />
            <circle className="dot" cx="718" cy="246" r="6" />
          </g>
          <g className="lb">
            <circle className="pulse" cx="931" cy="285" r="7" />
            <circle className="dot" cx="931" cy="285" r="6" />
          </g>
          <g className="lb">
            <circle className="pulse" cx="970" cy="345" r="7" />
            <circle className="dot" cx="970" cy="345" r="6" />
          </g>
          <g className="lb">
            <circle className="pulse" cx="594" cy="380" r="7" />
            <circle className="dot" cx="594" cy="380" r="6" />
          </g>
          <g className="lb">
            <circle className="pulse amber" cx="355" cy="440" r="7" />
            <circle className="dot amber" cx="355" cy="440" r="6" />
          </g>
          <g className="lb">
            <text x="562" y="40" textAnchor="end" className="nm">
              HALO MODULE
            </text>
            <text x="562" y="66" textAnchor="end" className="vl">
              OBD-II · live
            </text>
          </g>
          <g className="lb">
            <text x="952" y="40" textAnchor="start" className="nm">
              BATTERY
            </text>
            <text x="952" y="66" textAnchor="start" className="vl">
              12.6 V
            </text>
          </g>
          <g className="lb">
            <text x="970" y="512" textAnchor="middle" className="nm">
              COOLANT
            </text>
            <text x="970" y="538" textAnchor="middle" className="vl">
              89°C
            </text>
          </g>
          <g className="lb">
            <text x="594" y="512" textAnchor="middle" className="nm">
              FUEL
            </text>
            <text x="594" y="538" textAnchor="middle" className="vl">
              62% · 410 km
            </text>
          </g>
          <g className="lb am">
            <text x="355" y="512" textAnchor="middle" className="nm">
              REAR RIGHT TYRE
            </text>
            <text x="355" y="538" textAnchor="middle" className="vl">
              28 psi · low
            </text>
          </g>
        </svg>
      </div>

      {/* PHASE 4: INSIDE THE VEHICLE HARDWARE */}
      <div className="phase4-container ink" id="phase4-container">
        <div className="split-feature-container">
          <div
            className="hi-top"
            style={{ width: '100%', minWidth: '15rem', maxWidth: '20rem', marginBottom: '0' }}
          >
            <span>( B )</span>
            <span>[ 002 / 004 ]</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div className="split-top" style={{ textAlign: 'left', display: 'inline-block' }}>
              <span className="pill-badge">Inside the car</span>
              <h3
                className="feature-title animated-title"
                id="phase4-title"
                style={{ textAlign: 'left', marginTop: '1.5rem' }}
              >
                A bus reader, a cell,
                <br />
                <span style={{ fontWeight: '500' }}>and a model that listens</span>
              </h3>
              <div className="clients-line" style={{ margin: '3rem 0', width: '100%' }}></div>
            </div>
            <div className="split-bottom" style={{ alignItems: 'flex-start' }}>
              <div className="hi-text" style={{ textAlign: 'left', maxWidth: '32rem' }}>
                A small module reads the car’s own signals through the diagnostic port: battery, temperature, pressure, fault codes. It sleeps between events to spare the battery and wakes the moment something changes. A language model turns it all into answers.
              </div>
              <a href="#inside" className="hi-btn" data-to="0.62" style={{ marginTop: '1.5rem', textTransform: 'uppercase' }}>
                SEE INSIDE
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* FLYING WORDS (REACT BITS PERSPECTIVE) */}
      <div className="words-container ink">
        <div className="flying-word" id="word1">Watch</div>
        <div className="flying-word" id="word2">Learn</div>
        <div className="flying-word" id="word3">Answer</div>
      </div>

      {/* PHASE 3: KOKONUT UI AI DIAGNOSTIC CHAT */}
      <div className="glass-container" id="glass-container">
        <div id="glass-gradient" className="glass-gradient-wrapper">
          <div className="gradient-content">
            <div className="llm-header">
              <div className="llm-header-badge">
                <span className="pulse-dot"></span>
                <span>ONBOARD EDGE LLM · TATA PUNCH CAN-BUS INTERPRETER</span>
              </div>
              <h2 className="llm-title animated-title" id="phase3-title">
                Ask it anything,
                <br />
                it already knows
              </h2>
              <p className="llm-subtitle">
                Continuously processing real-time ECU signals, battery telemetry, tyre pressures, and powertrain vitals.
              </p>
            </div>

            {/* Cockpit Grid: Left = Live CAN Meters & Playback, Right = Kokonut AI Chat */}
            <div className="cockpit-grid">
              {/* LEFT COLUMN: LIVE CAN METERS COCKPIT & REPLAY CONTROLS */}
              <div className="telemetry-cockpit" aria-label="Vehicle CAN Telemetry Cockpit" data-lenis-prevent="true">
                {/* Header with status pulse & frame badge */}
                <div className="cockpit-header">
                  <div className="cockpit-title-wrap">
                    <span id="cockpit-pulse-dot" className="status-pulse-dot"></span>
                    <span className="cockpit-title">CAN BUS REPLAY ENGINE</span>
                  </div>
                  <div className="cockpit-badges">
                    <span id="cockpit-frame-badge" className="badge-frame">FRAME 0000 / 1000</span>
                    <span className="badge-rate">1s / FRAME</span>
                  </div>
                </div>

                {/* Playback Controls & Scrubber */}
                <div className="playback-bar">
                  <div className="playback-controls-row">
                    <div className="playback-btn-group">
                      <button id="btn-toggle-play" className="btn-ctrl btn-play-pause" type="button">
                        ⏸ Pause
                      </button>
                      <button id="btn-step-prev" className="btn-ctrl" type="button" title="Step back 10 seconds">
                        ⏮ -10s
                      </button>
                      <button id="btn-step-next" className="btn-ctrl" type="button" title="Step forward 10 seconds">
                        ⏭ +10s
                      </button>
                      <button id="btn-reset-sim" className="btn-ctrl" type="button" title="Reset to start">
                        ↺ Reset
                      </button>
                    </div>
                    <div className="playback-time-readout">
                      TIME: <span id="cockpit-time-readout" style={{ color: '#4cff7a' }}>00:00</span>
                    </div>
                  </div>

                  <div className="scrubber-wrap">
                    <span style={{ fontSize: '10px', opacity: 0.5 }}>0s</span>
                    <input
                      type="range"
                      id="cockpit-scrubber"
                      min="0"
                      max="999"
                      defaultValue="0"
                      className="scrubber-slider"
                      aria-label="Seek replay frame"
                    />
                    <span style={{ fontSize: '10px', opacity: 0.5 }}>1000s</span>
                  </div>
                </div>

                {/* Meter Cards Grid */}
                <div className="meter-cards-grid">
                  {/* Speedometer */}
                  <div className="meter-card">
                    <div className="meter-card-header">
                      <span className="meter-label">Vehicle Speed</span>
                      <span id="m-gear" className="meter-pill blue">GEAR N</span>
                    </div>
                    <div className="meter-value-wrap">
                      <span id="m-speed" className="meter-val-num">0.0</span>
                      <span className="meter-unit">km/h</span>
                    </div>
                    <div className="gauge-track">
                      <div id="bar-speed" className="gauge-fill speed-bar" style={{ width: '0%' }}></div>
                    </div>
                    <span className="meter-subtext">Powertrain CAN ID: 0x120</span>
                  </div>

                  {/* Tachometer (RPM) */}
                  <div className="meter-card">
                    <div className="meter-card-header">
                      <span className="meter-label">Engine Tachometer</span>
                      <span id="m-rpm-pill" className="meter-pill">IDLE</span>
                    </div>
                    <div className="meter-value-wrap">
                      <span id="m-rpm" className="meter-val-num">820</span>
                      <span className="meter-unit">RPM</span>
                    </div>
                    <div className="gauge-track">
                      <div id="bar-rpm" className="gauge-fill rpm-bar" style={{ width: '13%' }}></div>
                    </div>
                    <span className="meter-subtext">Revotron 1.2L 3-Cyl</span>
                  </div>

                  {/* Fuel & Range */}
                  <div className="meter-card">
                    <div className="meter-card-header">
                      <span className="meter-label">Fuel Level & Range</span>
                      <span id="m-range" className="meter-pill blue">~421 km</span>
                    </div>
                    <div className="meter-value-wrap">
                      <span id="m-fuel" className="meter-val-num">64.8</span>
                      <span className="meter-unit">%</span>
                    </div>
                    <div className="gauge-track">
                      <div id="bar-fuel" className="gauge-fill fuel-bar" style={{ width: '64.8%' }}></div>
                    </div>
                    <span className="meter-subtext">Tank: 37L • Eco: 6.3 L/100km</span>
                  </div>

                  {/* Coolant Temperature */}
                  <div className="meter-card">
                    <div className="meter-card-header">
                      <span className="meter-label">Engine Coolant</span>
                      <span id="m-cool-pill" className="meter-pill">NOMINAL</span>
                    </div>
                    <div className="meter-value-wrap">
                      <span id="m-cool" className="meter-val-num">78.0</span>
                      <span className="meter-unit">°C</span>
                    </div>
                    <div className="gauge-track">
                      <div id="bar-cool" className="gauge-fill cool-bar" style={{ width: '65%' }}></div>
                    </div>
                    <span className="meter-subtext">Thermostat target: 89–91°C</span>
                  </div>

                  {/* 12V Battery Voltage */}
                  <div className="meter-card">
                    <div className="meter-card-header">
                      <span className="meter-label">12V Battery</span>
                      <span id="m-volt-pill" className="meter-pill blue">HEALTHY</span>
                    </div>
                    <div className="meter-value-wrap">
                      <span id="m-volt" className="meter-val-num">12.6</span>
                      <span className="meter-unit">V</span>
                    </div>
                    <div className="gauge-track">
                      <div id="bar-volt" className="gauge-fill volt-bar" style={{ width: '70%' }}></div>
                    </div>
                    <span className="meter-subtext">Alternator Output Circuit</span>
                  </div>

                  {/* Oil Pressure */}
                  <div className="meter-card">
                    <div className="meter-card-header">
                      <span className="meter-label">Oil Pressure</span>
                      <span className="meter-pill">NOMINAL</span>
                    </div>
                    <div className="meter-value-wrap">
                      <span id="m-oil" className="meter-val-num">41.5</span>
                      <span className="meter-unit">kPa</span>
                    </div>
                    <div className="gauge-track">
                      <div id="bar-oil" className="gauge-fill oil-bar" style={{ width: '55%' }}></div>
                    </div>
                    <span className="meter-subtext">Vane pump lubrication</span>
                  </div>

                  {/* 4-Wheel TPMS Card */}
                  <div className="tpms-card">
                    <div className="meter-card-header">
                      <span className="meter-label">Tyre Pressure Monitoring (TPMS)</span>
                      <span className="meter-pill amber">RR Slow Leak (28 psi)</span>
                    </div>
                    <div className="tpms-grid">
                      <div className="tpms-tile">
                        <div className="tpms-wheel-name">Front Left</div>
                        <div className="tpms-wheel-val"><span id="m-tyre-fl">32.0</span> <small style={{ fontSize: '10px', opacity: 0.6 }}>psi</small></div>
                      </div>
                      <div className="tpms-tile">
                        <div className="tpms-wheel-name">Front Right</div>
                        <div className="tpms-wheel-val">32.0 <small style={{ fontSize: '10px', opacity: 0.6 }}>psi</small></div>
                      </div>
                      <div className="tpms-tile">
                        <div className="tpms-wheel-name">Rear Left</div>
                        <div className="tpms-wheel-val">31.0 <small style={{ fontSize: '10px', opacity: 0.6 }}>psi</small></div>
                      </div>
                      <div className="tpms-tile warning">
                        <div className="tpms-wheel-name">Rear Right</div>
                        <div className="tpms-wheel-val">28.0 <small style={{ fontSize: '10px', opacity: 0.6 }}>psi</small></div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Footer with raw microsecond TS and one-click query */}
                <div className="cockpit-footer">
                  <span id="cockpit-ts-raw" className="frame-ts-label">TS: 1791830000000000 µs</span>
                  <button id="btn-ask-telemetry" type="button" className="btn-ask-frame">
                    ✨ Ask AI to analyze this frame
                  </button>
                </div>
              </div>

              {/* RIGHT COLUMN: KOKONUT AI DIAGNOSTIC CHAT */}
              <div className="chat" aria-label="Halo automotive LLM copilot" data-lenis-prevent="true">
                <div className="chat-status">
                  <div className="chat-status-left">
                    <i aria-hidden="true"></i>
                    <span id="live">Live · reading the CAN bus · updated 2 s ago</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                    <span className="chat-badge">CAN-BUS • QWEN 3.5 SLM</span>
                    <span className="chat-badge" style={{ background: 'linear-gradient(135deg,rgba(16,185,129,.18),rgba(5,150,105,.12))', border: '1px solid rgba(16,185,129,.35)', color: '#6ee7b7', letterSpacing: '.04em' }} title="Constrained Decoding Model v1.0 — schema-enforced structured LLM output">CDM v1.0 ✓</span>
                    <a href="#top" data-to="0" style={{ fontSize: '11px', opacity: 0.6, cursor: 'pointer', textDecoration: 'none', color: 'inherit' }}>
                      ↑ 3D CAR
                    </a>
                  </div>
                </div>

                <div className="chat-log" id="log" aria-live="polite" data-lenis-prevent="true"></div>

                <div className="chat-chips" id="chips"></div>

                <form className="chat-form" id="chatform">
                  <input
                    id="q"
                    autoComplete="off"
                    placeholder="Ask like ChatGPT: science, driving tips, car questions, or live telemetry…"
                    aria-label="Ask about your car"
                  />
                  <button type="submit">Ask AI</button>
                </form>

                <div className="chat-note">
                  <span>Demo: Real-time simulated CAN frames & edge generative reasoning.</span>
                  <span style={{ opacity: 0.8 }}>ECU: Tata Punch 1.2L Revotron</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* PHASE 5: COLOR FINISHES & PLUG-IN PORT */}
      <div className="phase5-container ink" id="phase5-container">
        <div className="hi-top phase5-label-right">
          <span>( C )</span>
          <span>[ 003 / 004 ]</span>
        </div>
        <h3 className="feature-title phase5-title-left animated-title" id="phase5-title-1">
          Orcus White. Daytona Grey. Atomic Orange.
        </h3>
        <div className="hi-text phase5-desc-left">
          Three factory dual-tone finishes. Select a finish to repaint the live Tata Punch 3D model.
        </div>
        <div className="swatches" role="radiogroup" aria-label="Tata Punch dual-tone finish">
          <button className="sw" data-c="0" aria-pressed="true" style={{ '--c': '#ffffff' }} aria-label="Orcus White"></button>
          <button className="sw" data-c="1" aria-pressed="false" style={{ '--c': '#4a4e55' }} aria-label="Daytona Grey"></button>
          <button className="sw" data-c="2" aria-pressed="false" style={{ '--c': '#d35400' }} aria-label="Atomic Orange"></button>
        </div>
        <h3 className="phase5-title-right animated-title" id="phase5-title-2">
          Plugs into the port
          <br />
          <span style={{ fontWeight: '500' }}>under your dashboard</span>
        </h3>
      </div>

      {/* PHASE 6: TALK & FOOTER */}
      <div className="phase6-container ink" id="phase6-container">
        <h3 className="phase6-title animated-title" id="phase6-title">
          Let your car
          <br />
          <span style={{ fontWeight: '400' }}>talk</span>
        </h3>
      </div>

      <div className="phase6-footer-wrapper" id="phase6-footer">
        <div className="glass-footer">
          <div className="footer-top">
            <div className="footer-left">
              <h2 style={{ margin: '0 0 1.5rem', fontWeight: '500', fontSize: '1.5rem', letterSpacing: '-.02em' }}>
                Halo
              </h2>
              <div className="footer-heading">Early access opens soon. Leave an email.</div>
              <form className="footer-input-group" onSubmit={(e) => e.preventDefault()}>
                <input type="email" placeholder="Enter your email" className="footer-input" aria-label="Email" />
                <button className="footer-submit" type="submit">Submit</button>
              </form>
              <div className="footer-subtext">
                By subscribing you agree to our Privacy Policy and provide consent to receive updates from Halo.
              </div>
            </div>
            <div className="footer-right">
              <div className="footer-col">
                <div className="footer-col-title">Module</div>
                <a href="#">Compatibility</a>
                <a href="#">Finishes</a>
                <a href="#">Install</a>
              </div>
              <div className="footer-col">
                <div className="footer-col-title">Learn</div>
                <a href="#">How it works</a>
                <a href="#">Privacy</a>
                <a href="#">CAN-Bus Engine</a>
              </div>
              <div className="footer-col">
                <div className="footer-col-title">About</div>
                <a href="#">Company</a>
                <a href="#">Careers</a>
                <a href="#">Contact</a>
              </div>
              <div className="footer-col">
                <div className="footer-col-title">Legal</div>
                <a href="#">Terms</a>
                <a href="#">Privacy</a>
              </div>
            </div>
          </div>
          <div className="footer-line"></div>
          <div className="footer-bottom">
            © 2026 Halo. Concept demo: real-time automotive LLM vehicle diagnostics assistant.
          </div>
        </div>
      </div>
    </div>
  );
}
