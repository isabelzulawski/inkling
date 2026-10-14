/**
 * an inkling — plain JavaScript, no build step.
 *
 * Sections below follow the instrument from gesture to sound:
 *   1. state and pitch mapping
 *   2. paper deformation and drawing helpers
 *   3. audio voice and pointer interactions
 *   4. notation, playback, and rendering
 *   5. Undo and expression edits
 *   6. DSP and visual sound tools
 *   7. walkthrough and startup
 *
 * Coordinates x/y are normalized (0–1). Times are recorded seconds.
 * Stored points are the source gesture; edits and animation stay separate.
 * See EDITING.md for common changes and where to make them.
 */
"use strict";
const canvas = document.querySelector("#score"),
  ctx = canvas.getContext("2d");
const $ = (id) => document.getElementById(id),
  clamp = (x, a, b) => Math.max(a, Math.min(b, x));
// 1. State: current drawing, reversible edits, and sound settings.
const state = {
  points: [], // Source samples: { x, y, t, midi, ink, stroke, start }.
  notes: [], // Stable notation events derived from those samples.
  mode: "draw",
  playing: false,
  drawing: false,
  drag: null,
  field: { center: 0.5, amount: 0, target: 0 }, // Local stretch and release easing.
  phase: 0, // Playback position measured in ORIGINAL drawing seconds.
  trails: [],
  pointer: null,
  ink: 0.5,
  preserve: true,
  articulation: "legato",
  edits: [], // Dynamics adjustments; never overwrite the source points.
  history: [], // Snapshots for Undo (up to 40 committed actions).
  fx: { pan: 0, space: 0, edge: 0, boundary: 0, eq: 0 },
  bypass: { pan: false, space: false, edge: false, boundary: false, eq: false },
  tool: "pan",
};
let w = 0,
  h = 0,
  texture,
  ac,
  osc,
  gain,
  master,
  output,
  panner,
  convolver,
  wet,
  dry,
  distortion,
  compressor,
  eq,
  distortionDrive,
  distortionLevel,
  distortionDry,
  distortionWet,
  lastClock = 0,
  drawStart = 0,
  drawOffset = 0,
  drawingStroke = 0,
  voiceOn = false,
  previewUntil = 0;
// MIDI notes for C-major pentatonic, C3–C5. Change these to try another scale.
const scale = [48, 50, 52, 55, 57, 60, 62, 64, 67, 69, 72];
const pitch = (y) => scale[clamp(Math.round((1 - y) * 10), 0, 10)];
const hz = (m) => 440 * 2 ** ((m - 69) / 12);
// A positive density integrated into a monotone spatial map. Its derivative IS local time dilation.
const N = 512,
  map = new Float64Array(N + 1),
  sigma = 0.115;
// 2. Paper deformation. The same field drives visual width AND musical duration.
function gaussian(x) {
  return Math.exp(-0.5 * ((x - state.field.center) / sigma) ** 2);
}
function updateMap() {
  map[0] = 0;
  for (let i = 1; i <= N; i++)
    map[i] =
      map[i - 1] + (1 + state.field.amount * gaussian((i - 0.5) / N)) / N;
  const total = map[N];
  for (let i = 1; i <= N; i++) map[i] /= total;
}
// Original x → displayed x. The integral is normalized to keep the paper edges fixed.
function mx(x) {
  let t = clamp(x, 0, 1) * N,
    i = Math.min(N - 1, Math.floor(t));
  return map[i] + (map[i + 1] - map[i]) * (t - i);
}
// The derivative of that map is the actual local duration multiplier.
function density(x) {
  let i = Math.min(N - 1, Math.floor(clamp(x, 0, 1) * N));
  return (map[i + 1] - map[i]) * N;
}
// Displayed x → original x, so the pointer follows the deformed paper.
function inverse(x) {
  let lo = 0,
    hi = 1;
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if (mx(mid) < x) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
function flex(x, y) {
  return state.field.amount * gaussian(x) * Math.sin(y * Math.PI) * 0.006;
}
let active = null,
  visualTime = 0;
// Apply stretch and temporary playback tremble without changing p.
function pos(p, animated = true) {
  let y = p.y + flex(p.x, p.y);
  if (animated && active) {
    let d = ((p.x - active.x) / 0.065) ** 2 + ((p.y - active.y) / 0.08) ** 2;
    y += Math.exp(-d) * Math.sin(visualTime * 19 + p.x * 40) * 0.0015;
  }
  return [mx(p.x) * w, y * h];
}
function line(points, color = "#514633", width = 0.6, animated = true) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  points.forEach((p, i) => {
    const a = pos(p, animated);
    i ? ctx.lineTo(...a) : ctx.moveTo(...a);
  });
  ctx.stroke();
}
function segment(x, y, x2, y2, color, width) {
  line(
    [
      { x, y },
      { x: x2, y: y2 },
    ],
    color,
    width,
  );
}
function text(str, x, y, size = 10, opacity = 0.5, italic = false) {
  const p = pos({ x, y });
  ctx.save();
  ctx.translate(...p);
  ctx.scale(density(x), 1);
  ctx.font = `${size + 2}px "Apple Chancery", cursive`;
  ctx.fillStyle = `rgba(62,53,38,${opacity})`;
  ctx.fillText(str.toLowerCase(), 0, 0);
  ctx.restore();
}
function seeded(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
// Generate the static ivory texture once per resize, not on every animation frame.
function paper() {
  texture = document.createElement("canvas");
  texture.width = w;
  texture.height = h;
  const c = texture.getContext("2d");
  c.fillStyle = "#eee4cf";
  c.fillRect(0, 0, w, h);
  const r = seeded(19);
  for (let i = 0; i < 40; i++) {
    let x = r() * w,
      y = r() * h,
      rad = 60 + r() * 250,
      g = c.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(159,120,58,${r() * 0.035})`);
    g.addColorStop(1, "rgba(159,120,58,0)");
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
  }
  for (let i = 0; i < (w * h) / 8; i++) {
    c.fillStyle = `rgba(${r() > 0.5 ? "80,65,40" : "255,250,230"},${r() * 0.065})`;
    c.fillRect(r() * w, r() * h, r() * 1.3 + 0.3, r() * 0.8 + 0.3);
  }
  let g = c.createRadialGradient(
    w * 0.5,
    h * 0.5,
    h * 0.25,
    w * 0.5,
    h * 0.5,
    w * 0.75,
  );
  g.addColorStop(0, "#8f653000");
  g.addColorStop(1, "#8f653021");
  c.fillStyle = g;
  c.fillRect(0, 0, w, h);
}
function resize() {
  w = innerWidth;
  h = innerHeight;
  const d = Math.min(devicePixelRatio || 1, 3);
  canvas.width = Math.round(w * d);
  canvas.height = Math.round(h * d);
  ctx.setTransform(d, 0, 0, d, 0, 0);
  paper();
  fitTitle();
}
// 3. A single persistent sine voice. Only user gestures unlock browser audio.
async function audio() {
  if (!ac) {
    ac = new (window.AudioContext || window.webkitAudioContext)();
    osc = ac.createOscillator();
    osc.type = "sine";
    gain = ac.createGain();
    gain.gain.value = 0;
    master = ac.createGain();
    master.gain.value = +$("volume").value * 0.22;
    buildDSP();
    osc.start();
  }
  await ac.resume();
  lastClock = ac.currentTime;
  $("begin").textContent = "Sound enabled";
  $("begin").classList.add("ready");
  fitTitle(); // The enabled label is wider; refit the title beside it.
}
function tone(m, level = 1) {
  if (!ac || ac.state !== "running") return;
  const t = ac.currentTime;
  osc.frequency.setTargetAtTime(
    frequency(m, active?.x ?? state.points.at(-1)?.x ?? 0.5),
    t,
    0.025,
  );
  gain.gain.setTargetAtTime(clamp(level, 0, 0.72), t, 0.012);
  voiceOn = level > 0;
}
function silence() {
  if (!gain) return;
  gain.gain.setTargetAtTime(0, ac.currentTime, 0.035);
  voiceOn = false;
}
function setPlaying(v) {
  previewUntil = 0;
  state.playing = v;
  $("play").textContent = v ? "Pause" : "Play";
  if (!v) {
    silence();
    muteTail();
  } else if (output) output.gain.setTargetAtTime(1, ac.currentTime, 0.025);
  lastClock = ac?.currentTime || 0;
}
function mode(m) {
  if (state.drawing) finish();
  state.mode = m;
  document.body.classList.toggle("stretch", m === "stretch");
  $("draw").setAttribute("aria-pressed", m === "draw");
  $("stretch").setAttribute("aria-pressed", m === "stretch");
  $("dynamics").setAttribute("aria-pressed", m === "dynamics");
  document.body.classList.toggle("dynamics", m === "dynamics");
  $("hint").textContent = m === "stretch" ? "" : m === "dynamics" ? "" : "";
}
function pointer(e) {
  const b = canvas.getBoundingClientRect();
  const x = clamp((e.clientX - b.left) / b.width, 0, 1);
  let ox = inverse(x),
    y = clamp((e.clientY - b.top) / b.height, 0, 1);
  for (let i = 0; i < 3; i++)
    y = clamp((e.clientY - b.top) / b.height - flex(ox, y), 0, 1);
  return { x: ox, y, screenX: x };
}
// Append a sample to the current stroke; keep recorded drawing time and source pitch.
function record(e) {
  const p = pointer(e),
    t = drawOffset + (performance.now() - drawStart) / 1000;
  if (
    state.points.length &&
    state.points.at(-1).stroke === drawingStroke &&
    t - state.points.at(-1).t < 0.012
  )
    return;
  state.points.push({
    x: p.x,
    y: p.y,
    t,
    midi: pitch(p.y),
    ink: state.ink,
    stroke: drawingStroke,
    start: !state.points.length || state.points.at(-1).stroke !== drawingStroke,
  });
  tone(pitch(p.y), levelAt({ ...p, ink: state.ink }));
}
// Pointer capture lets a drag finish even when the pointer leaves the canvas.
// Draw adds a stroke; Dynamics records a separate edit; Stretch reshapes the field.
canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || state.drawing || state.drag) return;
  if (!ac || ac.state !== "running") {
    $("hint").textContent = "Choose Begin to enable sound, then draw.";
    return;
  }
  canvas.setPointerCapture(e.pointerId);
  const p = pointer(e);
  if (state.mode === "draw") {
    commit();
    setPlaying(false);
    drawOffset = state.points.length ? state.points.at(-1).t + 0.18 : 0;
    drawingStroke = state.points.length
      ? (state.points.at(-1).stroke ?? 0) + 1
      : 0;
    state.trails = [];
    state.phase = 0;
    state.drawing = true;
    active = null;
    output.gain.setTargetAtTime(1, ac.currentTime, 0.025);
    drawStart = performance.now();
    record(e);
    $("empty").style.opacity = 0;
    $("empty").setAttribute("aria-hidden", "true");
  } else if (state.mode === "dynamics") {
    if (!state.points.length) return;
    const near = nearest(p);
    if (near.distance > 50) {
      $("hint").textContent = "Grab a section of your stroke to edit it.";
      return;
    }
    commit();
    state.edits.push({
      t: near.point.t,
      stroke: near.point.stroke ?? 0,
      amount: 0,
    });
    state.drag = {
      kind: "dynamics",
      startY: e.clientY,
      edit: state.edits.at(-1),
    };
  } else {
    commit();
    state.field.center = p.x;
    state.field.amount = 0;
    state.field.target = 0;
    updateMap();
    state.drag = { kind: "stretch", start: e.clientX };
  }
});
canvas.addEventListener("pointermove", (e) => {
  state.pointer = pointer(e);
  if (state.drawing) {
    for (const event of e.getCoalescedEvents?.() || [e]) record(event);
  } else if (state.drag?.kind === "dynamics") {
    state.drag.edit.amount = clamp(
      (state.drag.startY - e.clientY) / 100,
      -1,
      1,
    );
  } else if (state.drag) {
    state.field.target = clamp(
      (e.clientX - state.drag.start) / (w * 0.1),
      -0.82,
      4.5,
    );
    state.field.amount = state.field.target;
    updateMap();
  }
});
// 4. Select meaningful pitch changes and held sections. Never beam across pen lifts.
function notation() {
  const pts = state.points;
  state.notes = [];
  let last = -1;
  for (let i = 0; i < pts.length - 1; i++) {
    if (pts[i + 1].start) continue;
    const p = pts[i];
    if (
      last < 0 ||
      p.start ||
      (p.midi !== pts[last].midi && p.t - pts[last].t > 0.12) ||
      p.t - pts[last].t > 0.8
    ) {
      state.notes.push({ index: i, ...p });
      last = i;
    }
  }
  for (let n = 0; n < state.notes.length; n++) {
    const a = state.notes[n],
      strokeEnd = pts.findLast((p) => (p.stroke ?? 0) === (a.stroke ?? 0)).t,
      end = Math.min(state.notes[n + 1]?.t ?? strokeEnd, strokeEnd);
    a.hold = end - a.t;
    a.hollow = a.hold > 0.42;
    a.weight = inkAt(a);
  }
}
function finish() {
  if (state.drawing) {
    state.points.push({
      ...state.points.at(-1),
      t: drawOffset + Math.max(0.12, (performance.now() - drawStart) / 1000),
      start: false,
    });
    if (state.points.at(-1).t < 0.12) state.points.at(-1).t = 0.12;
    state.drawing = false;
    notation();
    $("play").disabled = false;
    setPlaying(true);
    $("hint").textContent = "";
  }
  if (state.drag) notation();
  state.drag = null;
}
canvas.addEventListener("pointerup", finish);
canvas.addEventListener("pointercancel", () => {
  finish();
  setPlaying(false);
});
canvas.addEventListener("lostpointercapture", () => {
  if (state.drawing || state.drag) finish();
});
canvas.addEventListener("pointerleave", () => {
  state.pointer = null;
});
$("begin").onclick = () =>
  audio().catch(() => {
    $("hint").textContent = "Audio could not start. Try Begin again.";
  });
$("draw").onclick = () => mode("draw");
$("dynamics").onclick = () => mode("dynamics");
$("stretch").onclick = () => mode("stretch");
$("play").onclick = async () => {
  await audio();
  setPlaying(!state.playing);
};
$("reset").onclick = () => {
  commit();
  state.field.target = 0;
  $("hint").textContent = "";
};
$("clear").onclick = () => {
  commit();
  state.edits = [];
  state.drawing = false;
  state.drag = null;
  setPlaying(false);
  muteTail();
  state.points = [];
  state.notes = [];
  state.trails = [];
  state.phase = 0;
  $("play").disabled = true;
  $("empty").style.opacity = 1;
  $("empty").setAttribute("aria-hidden", "false");
  $("duration").textContent = "";
};
$("volume").oninput = (e) => {
  if (master)
    master.gain.setTargetAtTime(+e.target.value * 0.22, ac.currentTime, 0.04);
};
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    shapeDrag = null;
    if (state.drawing || state.drag) finish();
    setPlaying(false);
  }
});
window.addEventListener("blur", () => {
  shapeDrag = null;
  if (state.drawing) finish();
  state.drag = null;
  setPlaying(false);
});
window.addEventListener("resize", resize);
// Original recorded seconds advance at 1 / spatial dilation, using the AudioContext clock.
// Find the original gesture position at t. Pen-up gaps are silent and never interpolated.
function sample(t) {
  const a = state.points;
  let lo = 0,
    hi = a.length - 1;
  while (lo < hi) {
    let m = (lo + hi + 1) >> 1;
    if (a[m].t <= t) lo = m;
    else hi = m - 1;
  }
  const p = a[lo],
    q = a[Math.min(lo + 1, a.length - 1)],
    u = clamp((t - p.t) / (q.t - p.t || 1), 0, 1);
  return {
    x: q.start ? p.x : p.x + (q.x - p.x) * u,
    y: q.start ? p.y : p.y + (q.y - p.y) * u,
    midi: p.midi,
    ink: p.ink,
    t,
    silent: !!q.start && t > p.t,
    stroke: p.stroke ?? 0,
  };
}
function duration() {
  let total = 0;
  for (let i = 1; i < state.points.length; i++) {
    const a = state.points[i - 1],
      b = state.points[i];
    total += (b.t - a.t) * density(b.start ? a.x : (a.x + b.x) / 2);
  }
  return total;
}
// Staff groups and sparse margin diagrams; all use the same deformation as the ink.
function printed() {
  for (let group = 0; group < 11; group++) {
    const y = 0.245 + group * 0.059;
    for (let j = 0; j < 5; j++) {
      let ps = [];
      for (let k = 0; k <= 100; k++)
        ps.push({ x: 0.04 + (0.92 * k) / 100, y: y + j * 0.006 });
      line(ps, `rgba(89,73,47,${j === 0 ? 0.38 : 0.31})`, 0.65);
    }
    text(String(group + 1).padStart(2, "0"), 0.022, y + 0.015, 8, 0.38);
  }
  // Engraved fragments inhabit the margins, leaving the gesture's central space open.

  for (let k = 0; k < 12; k++) {
    let x = 0.074 + k * 0.005;
    segment(x, 0.72, x, 0.81, "#73644a44", 0.55);
    segment(0.07, 0.72 + k * 0.007, 0.135, 0.72 + k * 0.007, "#73644a44", 0.55);
  }
  let contour = [];
  for (let i = 0; i <= 30; i++) {
    let x = 0.07 + i * 0.003,
      y = 0.756 + Math.sin(i * 0.24) * 0.021;
    contour.push({ x, y });
    segment(x, y, x, 0.81, "#594d3555", 0.55);
  }
  line(contour, "#55472f99", 0.8);
  for (let j = 0; j < 6; j++) {
    let x = 0.835 + j * 0.017,
      y = 0.76 + Math.sin(j * 1.7) * 0.013;
    segment(x, y, x, y - 0.044, "#4b402988", 0.8);
    let p = pos({ x, y });
    ctx.fillStyle = "#51452eaa";
    ctx.beginPath();
    ctx.ellipse(...p, 3.5, 2, -0.35, 0, Math.PI * 2);
    ctx.fill();
    if (j < 5) segment(x, y - 0.044, x + 0.017, 0.716, "#51452e88", 1.6);
  }
  for (const x of [0.04, 0.96])
    for (const y of [0.195, 0.884]) {
      segment(x - 0.006, y, x + 0.006, y, "#67563888", 0.6);
      segment(x, y - 0.009, x, y + 0.009, "#67563888", 0.6);
    }
}
function drawNotation() {
  state.notes.forEach((n, i) => {
    let glow = active ? Math.exp(-(((active.t - n.t) / 0.15) ** 2)) : 0;
    const p = pos(n),
      stemEnd = {
        x: n.x + 0.004 + glow * 0.002 * Math.sin(visualTime * 12),
        y: n.y - 0.043,
      };
    ctx.strokeStyle = `rgba(44,39,30,${0.6 + glow * 0.35})`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.ellipse(
      ...p,
      (3 + inkAt(n) * 2) * density(n.x),
      2.3 + inkAt(n) * 0.6,
      -0.35,
      0,
      Math.PI * 2,
    );
    n.hollow ? ctx.stroke() : ctx.fill();
    line([{ x: n.x + 0.003, y: n.y }, stemEnd], "#403a2aaa", 0.85);
    text(String(i + 1), n.x - 0.004, n.y - 0.057, 8, 0.55);
    const next = state.notes[i + 1];
    if (
      state.articulation === "legato" &&
      next &&
      (next.stroke ?? 0) === (n.stroke ?? 0) &&
      i % 3 !== 2 &&
      Math.abs(next.x - n.x) < 0.12
    )
      line(
        [stemEnd, { x: next.x + 0.004, y: next.y - 0.043 }],
        "#393126aa",
        1.8,
      );
    if (state.articulation === "detached") {
      segment(
        n.x - 0.003,
        n.y + 0.013,
        n.x + 0.003,
        n.y + 0.013,
        "#403a2aaa",
        1.4,
      );
    }
    if (n.hold > 0.42) {
      segment(
        n.x + 0.009,
        n.y - 0.009,
        n.x + 0.009 + Math.min(n.hold * 0.026, 0.09),
        n.y - 0.009,
        "#51473088",
        1,
      );
      for (let j = 0; j < 5; j++)
        segment(
          n.x + j * 0.005,
          n.y + 0.015,
          n.x + j * 0.005 + 0.012,
          n.y + 0.038,
          "#5c503344",
          0.6,
        );
    }
  });
}
// Main loop: use AudioContext time to advance the phrase, then draw its active position.
// Small integration steps keep local stretching continuous; updates are frame-scheduled.
function frame(now) {
  visualTime = now / 1000;
  if (!state.drag) {
    state.field.amount += (state.field.target - state.field.amount) * 0.15;
  }
  updateMap();
  active = null;
  if (state.playing && state.points.length) {
    const time = ac.currentTime,
      dt = clamp(time - lastClock, 0, 0.1);
    lastClock = time;
    const end = state.points.at(-1).t;
    let remain = dt;
    while (remain > 0) {
      let step = Math.min(0.004, remain);
      state.phase += step / density(sample(Math.min(state.phase, end)).x);
      remain -= step;
    }
    if (state.phase > end + 0.18) {
      state.phase = 0;
      state.trails = [];
    }
    if (state.phase <= end) {
      const playingPoint = sample(state.phase);
      if (playingPoint.silent) {
        silence();
      } else {
        active = playingPoint;
        const strokePoints = state.points.filter(
            (p) => (p.stroke ?? 0) === active.stroke,
          ),
          begin = strokePoints[0].t,
          finish = strokePoints.at(-1).t;
        const envelope = Math.min(
          1,
          (state.phase - begin) / 0.06,
          (finish - state.phase) / 0.08,
        );
        tone(
          active.midi,
          clamp(envelope, 0, 1) * levelAt(active) * articulationAt(state.phase),
        );
        state.trails.push({ ...active, age: now });
      }
    } else silence();
  } else if (!state.drawing) {
    if (ac && ac.currentTime < previewUntil) {
      tone(60, 0.32);
    } else if (voiceOn) {
      silence();
      if (previewUntil) {
        muteTail();
        previewUntil = 0;
      }
    }
  }
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(texture, 0, 0);
  printed();
  state.trails = state.trails.filter((t) => now - t.age < trailLife());
  for (let i = 0; i < state.trails.length; i += 3) {
    let p = pos(state.trails[i]);
    ctx.fillStyle = `rgba(72,58,35,${0.12 * (1 - (now - state.trails[i].age) / trailLife())})`;
    ctx.beginPath();
    ctx.ellipse(p[0] + 2, p[1] + 3, 3, 1.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const pts = state.points;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].start) continue;
    line(
      [rough(pts[i - 1], i - 1), rough(pts[i], i)],
      `rgba(45,40,32,${0.65 + 0.15 * Math.sin(i * 0.51)})`,
      0.4 + 1.7 * inkAt(pts[i]) + 0.1 * Math.sin(i * 0.35),
    );
  }
  drawNotation();
  if (active) {
    let p = pos(active);
    ctx.fillStyle = "#302e25";
    ctx.beginPath();
    ctx.arc(...p, 3.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#473b2a33";
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.arc(...p, 9, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (state.mode === "stretch" && state.pointer) {
    let p = pos(state.pointer, false);
    ctx.strokeStyle = "#51483166";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.ellipse(...p, 21, 13, 0, 0, Math.PI * 2);
    ctx.moveTo(p[0] - 34, p[1]);
    ctx.lineTo(p[0] - 24, p[1]);
    ctx.moveTo(p[0] + 24, p[1]);
    ctx.lineTo(p[0] + 34, p[1]);
    ctx.stroke();
  }
  if (pts.length && !state.drawing)
    $("duration").textContent =
      `${pts.at(-1).t.toFixed(2)} s → ${duration().toFixed(2)} s / loop`;
  renderShaper();
  if (now - (frame.lastInfo || 0) > 150) {
    technical();
    frame.lastInfo = now;
  }
  requestAnimationFrame(frame);
}

// Musical edits never rewrite source positions, times, pitches, or recorded ink choices.
// 5. Undo and musical expression. One pointer drag is one committed action.
function snapshot() {
  return JSON.parse(
    JSON.stringify({
      points: state.points,
      edits: state.edits,
      field: state.field,
      fx: state.fx,
      bypass: state.bypass,
      preserve: state.preserve,
      articulation: state.articulation,
      ink: state.ink,
    }),
  );
}
function commit() {
  state.history.push(snapshot());
  if (state.history.length > 40) state.history.shift();
  $("undo").disabled = false;
}
function undo() {
  if (!state.history.length) return;
  setPlaying(false);
  Object.assign(state, state.history.pop());
  state.phase = 0;
  state.drag = null;
  state.drawing = false;
  state.trails = [];
  updateMap();
  notation();
  syncControls();
  applyDSP();
  $("play").disabled = !state.points.length;
  $("empty").style.opacity = state.points.length ? 0 : 1;
  $("empty").setAttribute("aria-hidden", !!state.points.length);
  $("undo").disabled = !state.history.length;
  $("hint").textContent = "";
}
function syncControls() {
  $("preserve").checked = state.preserve;
  $("articulation").value = state.articulation;
  $("ink").value = state.ink;
  $("bypass").setAttribute("aria-pressed", !!state.bypass[state.tool]);
}
// Source ink + time-local Dynamics edits on the same stroke. Clamp to safe limits.
function inkAt(p) {
  let ink = p.ink ?? 0.5;
  for (const e of state.edits)
    if (e.stroke === undefined || e.stroke === (p.stroke ?? 0))
      ink += e.amount * Math.exp(-0.5 * ((p.t - e.t) / 0.28) ** 2);
  return clamp(ink, 0.08, 1);
}
// Ink-to-gain mapping. Visual line width is separately set in frame().
function levelAt(p) {
  return 0.12 + 0.56 * inkAt(p);
}
// Preserve pitch on: source frequency. Off: tape-like frequency / local duration.
function frequency(m, x) {
  return hz(m) / (state.preserve ? 1 : density(x));
}
// Detached shapes each event envelope but does not change the event duration.
function articulationAt(t) {
  if (state.articulation === "legato") return 1;
  let n = state.notes[0];
  for (const a of state.notes) {
    if (a.t > t) break;
    n = a;
  }
  if (!n) return 1;
  const u = (t - n.t) / (n.hold || 0.12);
  return clamp(u / 0.06, 0, 1) * clamp((0.78 - u) / 0.1, 0, 1);
}
function nearest(p) {
  let best = { distance: Infinity, point: null };
  const a = pos(p, false);
  for (const q of state.points) {
    const b = pos(q, false),
      d = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (d < best.distance) best = { distance: d, point: q };
  }
  return best;
}
$("undo").onclick = undo;
$("ink").onchange = (e) => {
  commit();
  state.ink = +e.target.value;
};
$("preserve").onchange = (e) => {
  commit();
  state.preserve = e.target.checked;
};
$("articulation").onchange = (e) => {
  commit();
  state.articulation = e.target.value;
  notation();
};
function effective(k) {
  return state.bypass[k] ? 0 : state.fx[k];
}
function rough(p, i) {
  const e = effective("edge");
  return { ...p, y: p.y + e * Math.sin(i * 2.399) * 0.0018 };
}
function trailLife() {
  return 520 + effective("space") * 2100;
}
function muteTail() {
  if (output) output.gain.setTargetAtTime(0, ac.currentTime, 0.025);
}
function curve(amount) {
  const drive = 1 + amount * 19,
    arr = new Float32Array(4096);
  for (let i = 0; i < arr.length; i++) {
    const x = (i * 2) / (arr.length - 1) - 1;
    arr[i] = Math.tanh(x * drive) / Math.tanh(drive);
  }
  return arr;
}
// 6. DSP graph: voice → distortion → EQ → compression → pan → dry/reverb → volume.
// The final output gate also silences lingering reverb when paused or cleared.
function buildDSP() {
  distortion = ac.createWaveShaper();
  distortion.oversample = "4x";
  distortion.curve = curve(1);
  distortionDrive = ac.createGain();
  distortionLevel = ac.createGain();
  distortionDry = ac.createGain();
  distortionWet = ac.createGain();
  eq = ac.createBiquadFilter();
  eq.type = "highshelf";
  eq.frequency.value = 1200;
  compressor = ac.createDynamicsCompressor();
  compressor.knee.value = 12;
  compressor.ratio.value = 1;
  compressor.threshold.value = -6;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.18;
  panner = ac.createStereoPanner();
  convolver = ac.createConvolver();
  convolver.normalize = false;
  const length = Math.round(ac.sampleRate * 2.4),
    impulse = ac.createBuffer(2, length, ac.sampleRate),
    r = seeded(128);
  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    for (let i = 0; i < length; i++)
      data[i] = (r() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.42)) * 0.012;
  }
  convolver.buffer = impulse;
  wet = ac.createGain();
  wet.gain.value = 0;
  dry = ac.createGain();
  output = ac.createGain();
  distortionDrive.gain.value = 1 / 20;
  distortionLevel.gain.value = Math.tanh(20) / Math.tanh(1);
  distortionDry.gain.value = 1;
  distortionWet.gain.value = 0;
  osc.connect(gain);
  gain.connect(distortionDry).connect(eq);
  gain
    .connect(distortionDrive)
    .connect(distortion)
    .connect(distortionLevel)
    .connect(distortionWet)
    .connect(eq);
  eq.connect(compressor).connect(panner);
  panner.connect(dry).connect(master);
  panner.connect(convolver).connect(wet).connect(master);
  master.connect(output).connect(ac.destination);
  applyDSP();
}
// Translate visual tool state to actual Web Audio parameter targets.
// setTargetAtTime smooths changes to avoid abrupt jumps.
function applyDSP() {
  if (!ac) return;
  const t = ac.currentTime,
    e = effective("edge"),
    space = effective("space");
  const drive = 1 + e * 19;
  distortionDrive.gain.setTargetAtTime(drive / 20, t, 0.04);
  distortionLevel.gain.setTargetAtTime(
    Math.tanh(20) / Math.tanh(drive),
    t,
    0.04,
  );
  distortionDry.gain.setTargetAtTime(e === 0 ? 1 : 0, t, 0.025);
  distortionWet.gain.setTargetAtTime(e === 0 ? 0 : 1, t, 0.025);
  eq.gain.setTargetAtTime(effective("eq") * 12, t, 0.04);
  compressor.threshold.setTargetAtTime(
    -6 - effective("boundary") * 30,
    t,
    0.04,
  );
  compressor.ratio.setTargetAtTime(
    effective("boundary") === 0 ? 1 : 4,
    t,
    0.04,
  );
  panner.pan.setTargetAtTime(effective("pan"), t, 0.04);
  wet.gain.setTargetAtTime(space * 0.7, t, 0.04);
  dry.gain.setTargetAtTime(1 - space * 0.2, t, 0.04);
}
const shaper = $("shaper"),
  sc = shaper.getContext("2d");
let shapeDrag = null;
const toolCopy = {
  pan: [
    "Move the sound left or right.",
    "Sound source: drag horizontally to place the sound.",
  ],
  space: [
    "Pull the surrounding space open.",
    "Space: drag right to expand the reverberant space.",
  ],
  edge: [
    "Pull outward to roughen its edge.",
    "Edge: drag right to roughen the sound contour.",
  ],
  boundary: [
    "Pull the boundary inward to contain peaks.",
    "Boundary: drag left to tighten the enclosure.",
  ],
  eq: [
    "Lift or lower the bright end of the silhouette.",
    "Tone: drag vertically to reshape the high-frequency silhouette.",
  ],
};
function chooseTool(k) {
  state.tool = k;
  document
    .querySelectorAll("[data-tool]")
    .forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === k));
  $("shape-hint").textContent = toolCopy[k][0];
  shaper.setAttribute(
    "aria-label",
    toolCopy[k][1] + " Arrow keys adjust; double-click resets.",
  );
  syncControls();
}
document
  .querySelectorAll("[data-tool]")
  .forEach((b) => (b.onclick = () => chooseTool(b.dataset.tool)));
$("bypass").onclick = () => {
  commit();
  state.bypass[state.tool] = !state.bypass[state.tool];
  applyDSP();
  syncControls();
  audition();
};
function audition() {
  if (!ac || ac.state !== "running") {
    $("hint").textContent =
      "Begin enables sound. Play your phrase while shaping it.";
    return;
  }
  if (!state.playing && !state.drawing) {
    previewUntil = ac.currentTime + 0.4;
    output.gain.setTargetAtTime(1, ac.currentTime, 0.02);
    tone(60, 0.32);
  }
}
// Map direct manipulation of the small sound drawing to one effect parameter.
function changeShape(e) {
  const b = shaper.getBoundingClientRect(),
    x = clamp((e.clientX - b.left) / b.width, 0, 1),
    y = clamp((e.clientY - b.top) / b.height, 0, 1),
    k = state.tool;
  state.fx[k] =
    k === "pan"
      ? x * 2 - 1
      : k === "eq"
        ? 1 - y * 2
        : k === "boundary"
          ? 1 - x
          : x;
  applyDSP();
  audition();
}
shaper.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  commit();
  shapeDrag = e.pointerId;
  shaper.setPointerCapture(e.pointerId);
  changeShape(e);
});
shaper.addEventListener("pointermove", (e) => {
  if (shapeDrag !== null) changeShape(e);
});
for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
  shaper.addEventListener(event, () => (shapeDrag = null));
shaper.addEventListener("dblclick", () => {
  commit();
  state.fx[state.tool] = 0;
  applyDSP();
  audition();
});
shaper.addEventListener("keydown", (e) => {
  if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key))
    return;
  e.preventDefault();
  commit();
  const k = state.tool;
  state.fx[k] = clamp(
    state.fx[k] + (["ArrowRight", "ArrowUp"].includes(e.key) ? 0.05 : -0.05),
    k === "pan" || k === "eq" ? -1 : 0,
    1,
  );
  applyDSP();
  audition();
});
// Draw the selected effect representation from its stored parameter, not random decoration.
function renderShaper() {
  if (!$("soundtools").open) return;
  const b = shaper.getBoundingClientRect(),
    d = Math.min(devicePixelRatio || 1, 3);
  if (
    shaper.width !== Math.round(b.width * d) ||
    shaper.height !== Math.round(b.height * d)
  ) {
    shaper.width = Math.round(b.width * d);
    shaper.height = Math.round(b.height * d);
  }
  sc.setTransform(d, 0, 0, d, 0, 0);
  const W = b.width,
    H = b.height,
    cx = W / 2,
    cy = H / 2,
    k = state.tool,
    v = state.fx[k];
  sc.clearRect(0, 0, W, H);
  sc.strokeStyle = "#61543833";
  sc.lineWidth = 0.5;
  for (let i = 10; i < W; i += 12) {
    sc.beginPath();
    sc.moveTo(i, 10);
    sc.lineTo(i, H - 10);
    sc.stroke();
  }
  sc.strokeStyle = state.bypass[k] ? "#625a4166" : "#443b2ccc";
  sc.lineWidth = 1;
  if (k === "pan") {
    sc.beginPath();
    sc.moveTo(15, cy);
    sc.lineTo(W - 15, cy);
    sc.stroke();
    sc.beginPath();
    sc.arc(15 + ((W - 30) * (v + 1)) / 2, cy, 6, 0, Math.PI * 2);
    sc.fillStyle = "#443b2c";
    sc.fill();
  }
  if (k === "space") {
    for (let i = 0; i < 4; i++) {
      sc.globalAlpha = 1 - i * 0.21;
      sc.beginPath();
      sc.ellipse(
        cx,
        cy,
        14 + v * (20 + i * 15),
        9 + v * (8 + i * 7),
        0,
        0,
        Math.PI * 2,
      );
      sc.stroke();
    }
    sc.globalAlpha = 1;
  }
  if (k === "edge") {
    sc.beginPath();
    for (let i = 0; i <= 100; i++) {
      const x = 15 + ((W - 30) * i) / 100,
        y = cy + Math.sin(i * 0.12) * 9 + Math.sin(i * 2.3) * v * 10;
      i ? sc.lineTo(x, y) : sc.moveTo(x, y);
    }
    sc.stroke();
  }
  if (k === "boundary") {
    let radius = W * 0.43 * (1 - v * 0.7);
    sc.strokeRect(cx - radius, 15, radius * 2, H - 30);
    sc.beginPath();
    for (let i = 0; i < 80; i++) {
      let x = cx - radius + (2 * radius * i) / 79,
        y = cy + Math.sin(i * 0.2) * Math.min(H * 0.31, 22) * (1 - v * 0.45);
      i ? sc.lineTo(x, y) : sc.moveTo(x, y);
    }
    sc.stroke();
  }
  if (k === "eq") {
    sc.beginPath();
    sc.moveTo(15, cy);
    for (let i = 0; i <= 70; i++) {
      const x = 15 + ((W - 30) * i) / 70,
        y = cy - (v * (H * 0.32)) / (1 + Math.exp(-(i - 42) / 5));
      sc.lineTo(x, y);
    }
    sc.stroke();
    sc.fillStyle = "#4f432f";
    sc.beginPath();
    sc.arc(W - 20, cy - v * H * 0.32, 4, 0, Math.PI * 2);
    sc.fill();
  }
  sc.font = '12px "Apple Chancery", cursive';
  sc.fillStyle = "#786a51";
  sc.fillText(
    k === "pan"
      ? "left                         right"
      : k === "eq"
        ? "low                          bright"
        : k === "boundary"
          ? "contained                    open"
          : "less                         more",
    12,
    H - 3,
  );
}
function technical() {
  const s = active ? density(active.x) : 1;
  $("technical").innerHTML = `<b>Gesture → performance</b><br>
      Higher → C3–C5 pentatonic.<br>
      Ink → gain ${(active ? levelAt(active) : 0.12 + 0.56 * state.ink).toFixed(2)} (linear, capped 0.68).<br>
      Articulation: ${state.articulation}; Detached gate 78% of each event.<br>
      Local duration ×${s.toFixed(2)}; frequency ${active ? frequency(active.midi, active.x).toFixed(1) : "—"} Hz.<br>
      Preserve pitch: ${state.preserve ? "on" : "off; frequency ÷ local duration factor"}.<br>
      <br>
      <b>Actual DSP targets</b><br>
      Source / Stereo pan: ${effective("pan").toFixed(2)} (−1 left, +1 right).<br>
      Space / Convolution reverb: wet ${(effective("space") * 0.7).toFixed(2)}, dry ${(1 - effective("space") * 0.2).toFixed(2)}; 2.4 s impulse.<br>
      Edge / Distortion: drive ×${(1 + effective("edge") * 19).toFixed(1)} ${effective("edge") === 0 ? "(bypassed)" : ""}; tanh, 4× oversampling.<br>
      Boundary / Compressor: ${(-6 - effective("boundary") * 30).toFixed(1)} dB threshold; ${effective("boundary") === 0 ? "1:1 (bypassed)" : "4:1"}; 12 dB knee, 10 ms attack, 180 ms release.<br>
      Tone / EQ: 1200 Hz high shelf, ${(effective("eq") * 12).toFixed(1)} dB.<br>
      <br>
      Oscillator → note envelope → distortion → EQ → compressor → stereo pan → parallel dry / reverb → volume → stop gate.<br>
      <br>
      This changes synthesized-note timing and frequency. It does not stretch recorded waveforms. Audio-clock phase with animation-frame parameter updates; not sample-accurate scheduling.`;
}
// 7. Optional guide. Text is editable here; demo actions below use the real instrument.
const steps = [
  [
    "Draw a rising phrase",
    "Begin, then draw slowly from low to high. Your vertical gesture becomes pitch; the time you take becomes the phrase.",
    "draw",
  ],
  [
    "Give a moment weight",
    "Choose Dynamics and grab your stroke. Drag up: thicker ink sounds louder. Drag down: thinner ink sounds quieter.",
    "dynamics",
  ],
  [
    "Let a moment linger",
    "Stretch near the phrase and pull right. Compare Preserve pitch on and off: the latter slows and lowers the tone, like tape.",
    "stretch",
  ],
  [
    "Change the touch",
    "Compare Legato and Detached. Detached leaves a small silence inside each event; your gesture’s timing stays intact.",
    "draw",
  ],
  [
    "Give the sound more space",
    "Open Shape the sound → Space. Pull its rings outward, listen, and notice the fading impressions. Pause silences the tail.",
    "draw",
  ],
];
let step = 0;
function showStep() {
  const a = steps[step];
  $("walkthrough").hidden = false;
  $("step-count").textContent = `EXPLORATION ${step + 1} / ${steps.length}`;
  $("step-title").textContent = a[0];
  $("step-text").textContent = a[1];
  $("next").textContent = step === 4 ? "Finish" : "Next →";
  mode(a[2]);
  if (step === 4) {
    $("soundtools").open = true;
    chooseTool("space");
  }
}
$("learn").onclick = () => {
  step = 0;
  showStep();
};
$("skip").onclick = () => {
  $("walkthrough").hidden = true;
};
$("next").onclick = () => {
  if (++step === steps.length) {
    $("walkthrough").hidden = true;
    return;
  }
  showStep();
};
$("demo").onclick = async () => {
  await audio();
  commit();
  if (step === 0 || !state.points.length) {
    state.edits = [];
    state.points = Array.from({ length: 100 }, (_, i) => {
      let y = 0.66 - (i / 99) * 0.28 + 0.018 * Math.sin((i / 99) * Math.PI * 2);
      return {
        x: 0.25 + (i / 99) * 0.38,
        y,
        t: (i / 99) * 4,
        midi: pitch(y),
        ink: 0.5,
      };
    });
    state.phase = 0;
    notation();
    $("empty").style.opacity = 0;
    $("empty").setAttribute("aria-hidden", "true");
    $("play").disabled = false;
  }
  if (step === 1) {
    state.edits.push({ t: 2, amount: 0.45 });
    notation();
  }
  if (step === 2) {
    state.field.center = 0.44;
    state.field.target = 3;
    state.preserve = !state.preserve;
    syncControls();
  }
  if (step === 3) {
    state.articulation =
      state.articulation === "legato" ? "detached" : "legato";
    notation();
    syncControls();
  }
  if (step === 4) {
    state.fx.space = 0.75;
    state.bypass.space = false;
    applyDSP();
    syncControls();
  }
  setPlaying(true);
};
// Start the canvas. Audio stays silent until Begin, Play, or a guide example.
resize();
updateMap();
requestAnimationFrame(frame);
// Script lettering has generous overhangs. Fit the actual title to its own grid track.
function fitTitle() {
  const title = document.querySelector("h1");
  if (!title || !title.clientWidth) return;
  title.style.fontSize = "";
  let size = parseFloat(getComputedStyle(title).fontSize);
  for (let i = 0; i < 5 && title.scrollWidth > title.clientWidth + 1; i++) {
    size *= (title.clientWidth / title.scrollWidth) * 0.97;
    title.style.fontSize = `${size}px`;
  }
}
if (typeof ResizeObserver !== "undefined")
  new ResizeObserver(fitTitle).observe(document.querySelector("header"));
if (document.fonts) document.fonts.ready.then(fitTitle);
fitTitle();
