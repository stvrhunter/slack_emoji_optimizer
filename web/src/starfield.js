// Flying through space, 2003-style: a canvas of stars rushing past, with real
// emoji from the library tumbling among them.
//
// The emoji have to be DOM <img> elements rather than canvas draws — a GIF
// painted with drawImage() freezes on whatever frame it happened to be on.

const SPEED = 0.06875;  // deliberately slow drift

const STAR_COUNT = 460;
const FLYER_COUNT = 11;
const paused = () => document.hidden;

export function startStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  let stars = [], w = 0, h = 0, dpr = 1;

  const reset = (s, far) => {
    s.x = (Math.random() - 0.5) * 2200;
    s.y = (Math.random() - 0.5) * 2200;
    s.z = far ? 1100 : Math.random() * 1100;
    s.hue = Math.random() < 0.12 ? 38 : 210;
  };

  const sizeCanvas = () => {
    dpr = Math.min(devicePixelRatio || 1, 2);
    w = canvas.width = innerWidth * dpr;
    h = canvas.height = innerHeight * dpr;
    canvas.style.width = `${innerWidth}px`;
    canvas.style.height = `${innerHeight}px`;

    // Reconcile the particle budget if a tablet rotates or a window crosses a
    // breakpoint; otherwise a desktop-opened tab keeps all desktop particles.
    const target = STAR_COUNT;
    if (stars.length > target) stars.length = target;
    while (stars.length < target) {
      const star = {};
      reset(star);
      stars.push(star);
    }
  };
  let resizeFrame = 0;
  const resize = () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(sizeCanvas);
  };
  addEventListener('resize', resize);
  sizeCanvas();

  let last = performance.now();
  (function frame(now) {
    if (paused()) { last = now; requestAnimationFrame(frame); return; }
    const dt = Math.min(now - last, 50); last = now;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2, cy = h / 2;
    for (const s of stars) {
      s.z -= SPEED * dt;
      if (s.z <= 1) reset(s, true);
      const k = 320 / s.z;
      const x = cx + s.x * k * dpr, y = cy + s.y * k * dpr;
      if (x < 0 || x > w || y < 0 || y > h) { reset(s, true); continue; }
      const a = Math.min(1, (1100 - s.z) / 700);
      const r = Math.max(0.4, (1 - s.z / 1100) * 1.9) * dpr;
      ctx.fillStyle = `hsla(${s.hue}, ${s.hue === 38 ? 90 : 25}%, ${70 + a * 25}%, ${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  })(last);
}

/** The emoji drifting through the starfield. `onPick` gets the manifest entry. */
export function startFlyby(host, manifest, onPick) {
  if (!manifest.length) return;
  const pool = [];

  const spawn = (el) => {
    const pick = manifest[(Math.random() * manifest.length) | 0];
    el.src = pick.path;
    el.dataset.name = pick.name;
    el._e = pick;
    el._z = 900 + Math.random() * 500;
    // push them out of the middle of the screen, where the controls live
    const ang = Math.random() * Math.PI * 2;
    const rad = 620 + Math.random() * 900;
    el._x = Math.cos(ang) * rad;
    el._y = Math.sin(ang) * rad * 0.9;
    el._v = 0.10 + Math.random() * 0.11;
  };

  for (let i = 0; i < FLYER_COUNT; i++) {
    const el = document.createElement('img');
    el.loading = 'lazy';
    el.alt = '';
    el.addEventListener('click', () => onPick(el._e));
    spawn(el);
    el._z = 120 + Math.random() * 1300; // stagger the first pass
    host.appendChild(el);
    pool.push(el);
  }

  let last = performance.now();
  (function frame(now) {
    if (paused()) { last = now; requestAnimationFrame(frame); return; }
    const dt = Math.min(now - last, 50); last = now;
    const cx = innerWidth / 2, cy = innerHeight / 2;

    for (const el of pool) {
      el._z -= el._v * dt;
      if (el._z <= 60) { spawn(el); continue; }

      const k = 320 / el._z;
      const x = cx + el._x * k, y = cy + el._y * k;
      if (x < -300 || x > innerWidth + 300 || y < -300 || y > innerHeight + 300) {
        spawn(el);
        continue;
      }
      const scale = Math.max(0.1, k * 1.15);
      // fade out near the camera and while still far away
      const alpha = Math.min(1, (1400 - el._z) / 500) * Math.min(1, (el._z - 60) / 260) * 0.42;
      el.style.opacity = alpha.toFixed(3);
      el.style.transform =
        `translate3d(${x - 48}px, ${y - 48}px, 0) scale(${scale.toFixed(3)})`;
    }
    requestAnimationFrame(frame);
  })(last);
}
