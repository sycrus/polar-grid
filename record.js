// Record loop (` or the button, edit mode only): one seamless pulse cycle of
// the square crop guide, the view the deployed sketch shows, as MP4.
//
// Each sphere's pulse is a fixed state machine (size ±50 every 4 frames,
// bouncing between bounds), so the scene returns to exactly where it
// started after a whole number of frames: the take is exactly that many.
//
// The take renders offline, not in real time: p5's loop pauses, each frame
// is drawn on demand and encoded (WebCodecs, H.264) with an exact 1/60 s
// timestamp, then muxed into an MP4. Sphixel's frames often take longer
// than 1/60 s (re-sampling the letters), and a real-time capture shows
// those as freeze frames and judder; here a slow frame only makes the take
// slower to render. Everything is locked meanwhile (camera pinned, panels,
// keys and pointer blocked). Frames are copied off the canvas, so the
// panels and the guide never appear.

const RECORD_FPS = 60;
const STILL_FRAMES = 120; // every sphere frozen: a 2 s still
const MAX_LOOP_FRAMES = 3600;
// H.264 High then Main, at level 4.0 (up to ~1080p) and then 5.1 for
// squares bigger than that (a tall window)
const RECORD_CODECS = ['avc1.640028', 'avc1.4d0028', 'avc1.640033', 'avc1.4d0033'];

let take = null; // { camState, shield, drawing } while a take renders
let recordCanvas;
let recordStatusEl;

function recordKeypress() {
  if (take) return; // a take stops itself once the loop closes
  recordLoop().catch((e) => {
    console.error(e);
    setRecordStatus('not recorded: ' + e.message);
    finishTake();
  });
}

// The take's length: one full turn with auto-rotate on, otherwise one
// pulse cycle
function loopFrames() {
  if (autoRotate) return turnFrames();
  const pulse = pulseLoop();
  return pulse === 1 ? STILL_FRAMES : pulse;
}

// frames until every pulsing sphere is back in its starting state at once
// (1 when every sphere is frozen)
function pulseLoop() {
  let frames = 1;
  for (const s of spheres) {
    if (s.frozen) continue;
    frames = lcm(frames, pulsePeriod(s));
    if (frames > MAX_LOOP_FRAMES) return MAX_LOOP_FRAMES;
  }
  return frames;
}

// One auto-rotate turn: ~16 s, rounded to a whole number of pulse cycles,
// so a 360° take also ends with every pulse back where it began
const TURN_TARGET_FRAMES = 960;
function turnFrames() {
  const pulse = pulseLoop();
  return pulse * Math.max(1, Math.round(TURN_TARGET_FRAMES / pulse));
}

// the status line, while idle: what a take would capture right now
function describeLoop() {
  if (take) return;
  const frames = loopFrames();
  const secs = (frames / RECORD_FPS).toFixed(1) + ' s';
  setRecordStatus(autoRotate
    ? `one ${secs} turn (360°), seamless`
    : frames === STILL_FRAMES && pulseLoop() === 1
      ? `a ${secs} still (every sphere frozen)`
      : `one ${secs} pulse loop, seamless`);
}

// steps a copy of updatePulse() until (size, direction, tick phase) repeats
function pulsePeriod(s) {
  const start = { fontSize: s.fontSize, direction: s.direction, tick: s.tick };
  const p = { ...start };
  for (let n = 1; n <= MAX_LOOP_FRAMES; n++) {
    p.tick++;
    if (p.tick % 4 == 0) {
      if (p.fontSize > 1200 || p.fontSize < 100) p.direction *= -1;
      p.fontSize += p.direction * 50;
    }
    if (p.fontSize === start.fontSize && p.direction === start.direction &&
        p.tick % 4 === start.tick % 4) return n;
  }
  return MAX_LOOP_FRAMES;
}

function lcm(a, b) {
  const gcd = (x, y) => (y ? gcd(y, x % y) : x);
  return (a / gcd(a, b)) * b;
}

async function recordLoop() {
  if (!('VideoEncoder' in window)) {
    setRecordStatus('this browser can’t encode video');
    return;
  }
  const frames = loopFrames();
  const side = height - (height % 2); // H.264 needs even dimensions
  const config = await encoderConfig(side);
  if (!config) {
    setRecordStatus('this browser can’t encode H.264');
    return;
  }

  take = { camState: easycam.getState(), shield: lock(), drawing: false };
  // freeze the camera where it is: duration 0 sets it outright and cancels
  // any easing or orbit momentum still running (easycam animates setState
  // in real time otherwise, so a camera still settling from the last orbit
  // or zoom drifted through the take and the loop ended on a different view)
  easycam.setState(take.camState, 0);
  noLoop(); // frames are drawn on demand, one per encoded frame
  recordCanvas = document.createElement('canvas');
  recordCanvas.width = recordCanvas.height = side;

  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: 'avc', width: side, height: side },
    fastStart: 'in-memory',
  });
  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { failure = e; },
  });
  encoder.configure(config);

  for (let i = 0; i < frames; i++) {
    if (failure) throw failure;
    take.drawing = true;
    redraw();
    take.drawing = false;
    copySquare(side);
    const timestamp = Math.round((i * 1e6) / RECORD_FPS);
    const frame = new VideoFrame(recordCanvas, {
      timestamp,
      duration: Math.round(((i + 1) * 1e6) / RECORD_FPS) - timestamp,
    });
    encoder.encode(frame, { keyFrame: i % RECORD_FPS === 0 });
    frame.close();
    if (encoder.encodeQueueSize > 8) {
      await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
    }
    if (i % 12 === 0) {
      setRecordStatus(`rendering ${i} / ${frames} frames…`);
      await new Promise((r) => setTimeout(r)); // let the status paint
    }
  }
  await encoder.flush();
  if (failure) throw failure;
  muxer.finalize();
  encoder.close();

  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([muxer.target.buffer], { type: 'video/mp4' }));
  a.download = 'spx-' + spxStamp() + '.mp4';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  finishTake();
  setRecordStatus(`downloaded ${a.download} (${(frames / RECORD_FPS).toFixed(1)} s ` +
    (autoRotate ? 'turn)' : 'loop)'));
}

async function encoderConfig(side) {
  for (const codec of RECORD_CODECS) {
    const config = { codec, width: side, height: side, bitrate: 16_000_000, framerate: RECORD_FPS };
    const { supported } = await VideoEncoder.isConfigSupported(config);
    if (supported) return config;
  }
  return null;
}

function finishTake() {
  if (!take) return;
  unlock();
  loop();
}

// pointer, panels and keys all off for the take (keyPressed checks take)
function lock() {
  if (menuEl) menuEl.elt.inert = true;
  const shield = document.createElement('div');
  shield.style.cssText = 'position:fixed;inset:0;z-index:1000;cursor:progress';
  for (const type of ['mousedown', 'wheel', 'contextmenu', 'touchstart']) {
    shield.addEventListener(type, (e) => { e.preventDefault(); e.stopPropagation(); }, { passive: false });
  }
  document.body.appendChild(shield);
  return shield;
}

function unlock() {
  if (menuEl) menuEl.elt.inert = false;
  take.shield.remove();
  take = null;
}

// top of draw(): during a take, only the renderer's own frames draw. p5
// still runs the animation frame it had queued when the loop paused, and
// that stray draw would step every pulse one frame mid-take: a skipped frame
// in the video, and a loop that ends one frame past its start. Returns
// whether draw() should go ahead; the camera holds its pose for the take,
// set outright (duration 0), never eased.
function recordBeforeFrame() {
  if (!take) return true;
  if (!take.drawing) return false;
  easycam.setState(take.camState, 0);
  return true;
}

function copySquare(side) {
  const crop = height; // largest square inscribed in the 16:9 canvas
  recordCanvas.getContext('2d').drawImage(
    canvas, (width - crop) / 2, 0, crop, crop, 0, 0, side, side);
}

function setRecordStatus(text) {
  if (recordStatusEl) recordStatusEl.textContent = text;
}

// the file section's status line
function addRecordStatus(section) {
  recordStatusEl = document.createElement('div');
  recordStatusEl.className = 'save-status';
  section.elt.appendChild(recordStatusEl);
  describeLoop();
}
