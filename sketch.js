
/*
* Each typed letter spawns a sphere whose grid pulses out from its pole.
* Click a sphere to select it, drag to move it, shift+drag to rotate it.
* Arrow keys stretch the selection into an ellipsoid ([ and ] for depth),
* f freezes the pulse at the current size, r resets the shape (hold shift),
* shift+g toggles the longitude/latitude grid on all spheres (with it on,
* the letter separates into the grid cells its pixels occupy),
* shift+s saves the scene as JSON, shift+l loads one back in,
* shift+i (or right-click) exports the square crop guide as a PNG,
* backspace deletes the selection; buttons grouped in sections sit on the
* left of the square, the gesture reference on its right.
*
* Edit vs deployed (ADR-029): the sketch boots from settings.js, the saved
* arrangement of spheres, the grid toggle and the camera. Under `next dev`
* the adapter adds ?edit: the left panel, file tools, recording, the square
* crop guide, and "save settings", which writes the current arrangement
* (hand-built or loaded from a JSON) to settings.js. Deployed, it is
* view-only: visitors orbit and zoom around the saved arrangement, nothing
* else (typing and grabbing spheres were too fiddly to steer).
*/

const EDIT_MODE = new URLSearchParams(location.search).has('edit');

let buffer;
let easycam;
let sphereR = 220; // radius of the sphere
const SPAWN_RX = -90; // spawn tilt that points the north pole at the camera, so the letter blooms toward the viewer

let rays = 90; // how many rays (longitude sections)
let divs = 80; // how many divisions for each ray
let divSize = 0; // size of each div
let inc;

let elements = []; // shared grid template, same for every sphere
let spheres = [];
let selectedIndex = -1;
let drag = null;
let showGrid = false; // show the longitude/latitude grid on all spheres
// edit mode, ⇧A: the scene turns about its vertical (y) axis like a
// turntable, one turn per turnFrames() frames, so a record loop with it on
// is one full 360° turn
let autoRotate = false;
// the turn counts whole frames, and the angle is computed from the count:
// accumulating a small angle per frame drifts by float rounding, enough
// that a take's last frame no longer leads exactly into its first
let spinFrame = 0;
let spinFrames = 0; // the turn length spinFrame counts within
let gridGeom;
let menuButtons = {};
let menuState = '';
let menuEl; // left panel: sectioned buttons
let hintEl; // right panel: gesture reference
let fileEl; // hidden <input type=file> used by load
let frameEl; // DOM overlay: square crop guide for recording and export

let rendererGL;
let myFont;

function preload() {
  myFont = loadFont('Aladin-Regular.ttf');
}


function setup(){
  const s = fitSize();
  createCanvas(s[0], s[1], WEBGL);
  pixelDensity(1); // keep the render buffer at CSS size; remove for retina sharpness
  angleMode(DEGREES);
  colorMode(HSB, 100);
  frameRate(60);
  easycam = createEasyCam({ distance: 750 }); // pulled back: the pole-borne letter sits nearer to the camera than the sphere centre
  if (SETTINGS.camera) easycam.setState(SETTINGS.camera, 0);
  noStroke();
  buffer = createGraphics(800, 800);
  buffer.pixelDensity(1);
  buffer.textFont(myFont);
  buffer.textAlign(CENTER, CENTER);

  // inc = buffer.width / divs;
  inc = int(360/rays);
  divSize = int(800/divs);

  createPolarGrid();
  buildGridGeometry();
  // the saved arrangement, or a lone X when none has been saved
  spheres = Array.isArray(SETTINGS.scene) && SETTINGS.scene.length
    ? SETTINGS.scene.map(sphereFromSaved)
    : [new LetterSphere('X')];
  showGrid = !!SETTINGS.showGrid;

  rendererGL = p5.instance._renderer;
  addSquareFrame(); // first: the panels parent into the square frame
  if (EDIT_MODE) addMenu();
  addHint();
  updateSquareFrame(); // size the panels now that they exist
  if (EDIT_MODE) addLoader();
  if (EDIT_MODE) addGrabInterceptor(); // deployed: every drag goes to the camera
  if (EDIT_MODE) addSquareExport();
}

// capture-phase mousedown on window: runs before easycam's canvas
// listeners, so grabbing a sphere can stop the event before the camera
// controls ever see it (otherwise their drag state goes stale and
// the scene keeps rotating after release). The grab can't go through
// p5's mouseDragged either: stopPropagation keeps p5 from seeing the
// mousedown, so mouseIsPressed stays false and p5 never fires it --
// hence the manual mousemove/mouseup handling here.
function addGrabInterceptor() {
  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.target !== canvas) return;
    const [mx, my] = eventOffset(e);
    const hit = pickSphere(mx, my);
    if (hit < 0) return;
    e.stopPropagation(); // easycam and p5 skip this mousedown entirely
    startDrag(hit, mx, my, e.shiftKey);
  }, true);
  window.addEventListener('mousemove', (e) => {
    if (drag) applyDrag(...eventOffset(e));
  });
  window.addEventListener('mouseup', () => { drag = null; });
}

function eventOffset(e) {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}

// right-click exports the square crop instead of opening the browser's
// "save image as" (which saved the whole 16:9 canvas, and its swallowed
// mouseup left easycam's right-button bit stuck). with no native menu the
// mouseup lands on the canvas as usual, so easycam clears its own state
function addSquareExport() {
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    saveSquare();
  });
}

// edit mode: the largest 16:9 rectangle that fits the viewport, with the
// square crop guide marking the piece. Deployed: just that square, the
// largest that fits; same height-driven perspective, so it frames exactly
// what the guide does
function fitSize() {
  if (!EDIT_MODE) {
    const s = min(windowWidth, windowHeight);
    return [s, s];
  }
  let w = windowWidth, h = w * 9 / 16;
  if (h > windowHeight) {
    h = windowHeight;
    w = h * 16 / 9;
  }
  return [floor(w), floor(h)];
}

function windowResized(){
  const s = fitSize();
  resizeCanvas(s[0], s[1]);
  updateSquareFrame();
}

// thin square outline over the canvas marking a square crop;
// lives in the DOM so it never appears in recorded frames
function addSquareFrame() {
  frameEl = createDiv('');
  frameEl.style('position', 'fixed');
  if (EDIT_MODE) { // the crop guide is an export aid; deployed, the frame only hosts the hint panel
    frameEl.style('border', '1px solid rgba(0,0,0,0.35)');
    frameEl.style('box-shadow', '0 0 0 1px rgba(255,255,255,0.35)');
  }
  frameEl.style('pointer-events', 'none');
  updateSquareFrame();
}

function updateSquareFrame() {
  if (!frameEl) return;
  const side = height; // largest square inscribed in the 16:9 canvas
  const left = (windowWidth - width) / 2 + (width - side) / 2;
  frameEl.style('width', side + 'px');
  frameEl.style('height', side + 'px');
  frameEl.style('left', left + 'px');
  frameEl.style('top', (windowHeight - height) / 2 + 'px');
  // the panels hang off the square's edges: 28px out from the square, and
  // never closer than 40px to the window edge (the square is centred, so
  // both sides are symmetric)
  const panelW = max(150, min(230, left - 28 - 40));
  if (menuEl) menuEl.style('width', panelW + 'px');
  if (hintEl) hintEl.style('width', panelW + 'px');
}

// a titled section inside one of the flanking panels
function addSection(panel, title) {
  const sec = createDiv('');
  sec.class('sec');
  sec.parent(panel);
  createDiv(title).class('sec-title').parent(sec);
  return sec;
}

// left panel, hugging the square's left edge: the on-screen buttons, grouped
// into sections. Child of the square frame element, so it follows it on
// resize; DOM, so it never appears in recorded frames
function addMenu() {
  menuEl = createDiv('');
  menuEl.id('menu');
  menuEl.class('panel');
  menuEl.parent(frameEl);

  const btnRow = (sec) => {
    const btns = createDiv('');
    btns.class('btns');
    btns.parent(sec);
    return btns;
  };
  // each button is a full-width row: action on the left, shortcut chip on
  // the right (syncMenu rewrites the action half as state changes)
  const btn = (btns, action, key, fn) => {
    const b = createButton('');
    b.html('<span class="action">' + action + '</span><span class="key">' + key + '</span>');
    b.parent(btns);
    b.mousePressed(fn);
    return b;
  };

  const selection = btnRow(addSection(menuEl, 'selection'));
  menuButtons.freeze = btn(selection, 'freeze', '⇧F', () => { const s = selSphere(); if (s) s.frozen = !s.frozen; });
  menuButtons.reset  = btn(selection, 'reset', '⇧R',  () => { const s = selSphere(); if (s) { s.sx = s.sy = s.sz = 1; faceCamera(s); } });
  menuButtons.del    = btn(selection, 'delete', '⌫', deleteSphere);

  const view = btnRow(addSection(menuEl, 'view'));
  menuButtons.grid = btn(view, 'grid: off', '⇧G', () => { showGrid = !showGrid; });
  menuButtons.spin = btn(view, 'auto-rotate: off', '⇧A', () => { autoRotate = !autoRotate; });

  const fileSec = addSection(menuEl, 'file');
  const file = btnRow(fileSec);
  menuButtons.save   = btn(file, 'save', '⇧S', saveScene);
  menuButtons.load   = btn(file, 'load', '⇧L', () => fileEl.elt.click());
  menuButtons.record = btn(file, 'record loop', '`', recordKeypress);
  menuButtons.square = btn(file, 'save square', '⇧I', saveSquare);
  addRecordStatus(fileSec);

  const deploySec = addSection(menuEl, 'deploy');
  btn(btnRow(deploySec), 'save settings', '', saveSettings);
  menuButtons.status = createDiv('deployed version boots from this arrangement');
  menuButtons.status.class('save-status');
  menuButtons.status.parent(deploySec);
}

// writes the current arrangement (spheres, grid toggle, camera) to
// settings.js via the dev-only route, for the deployed sketch to boot from
async function saveSettings() {
  const status = menuButtons.status.elt;
  status.textContent = 'saving…';
  try {
    const res = await fetch('/api/dev/sketch-settings?slug=sphixel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        settings: { scene: sceneData(), showGrid, camera: easycam.getState() },
      }),
    });
    const out = await res.json();
    status.textContent = out.ok ? 'saved settings.js — commit to deploy' : 'not saved: ' + out.reason;
  } catch {
    status.textContent = 'not saved — saving needs next dev';
  }
}

// right panel, hugging the square's right edge: one row per gesture
function addHint() {
  hintEl = createDiv('');
  hintEl.id('hint');
  hintEl.class('panel');
  hintEl.parent(frameEl);

  const controls = addSection(hintEl, 'controls');
  // deployed is view-only: just the camera
  const gestures = EDIT_MODE
    ? [
        ['type a-z 0-9', 'spawn'],
        ['click', 'select sphere'],
        ['drag', 'move'],
        ['shift+drag', 'rotate'],
        ['arrows / [ ]', 'stretch'],
        ['drag space', 'orbit'],
        ['scroll', 'zoom'],
        ['right-click', 'save square'],
        ['backspace', 'delete'],
      ]
    : [
        ['drag', 'orbit'],
        ['scroll / pinch', 'zoom'],
      ];
  for (const [gesture, effect] of gestures) {
    const row = createDiv('');
    row.class('row');
    row.parent(controls);
    createSpan(gesture).parent(row);
    createSpan(effect).parent(row);
  }
  // typeface credit: the overlay's credits list (experiment record)
}

function selSphere() {
  return selectedIndex >= 0 ? spheres[selectedIndex] : null;
}

function deleteSphere() {
  if (!spheres.length) return;
  spheres.splice(selectedIndex >= 0 ? selectedIndex : spheres.length - 1, 1);
  selectedIndex = -1;
}

// rewrite a button's action half, leaving the shortcut chip alone
function setAction(button, text) {
  button.elt.querySelector('.action').textContent = text;
}

// enable/disable and relabel the buttons to match selection, grid and
// frozen state; skipped unless something changed
function syncMenu() {
  if (!menuEl) return;
  const sel = selSphere();
  const state = selectedIndex + ',' + (sel && sel.frozen) + ',' + showGrid + ',' + spheres.length +
    ',' + autoRotate + ',' + spheres.filter((s) => s.frozen).length;
  if (state === menuState) return;
  menuState = state;
  setAction(menuButtons.freeze, sel && sel.frozen ? 'unfreeze' : 'freeze');
  menuButtons.freeze.elt.disabled = !sel;
  menuButtons.reset.elt.disabled = !sel;
  menuButtons.del.elt.disabled = !spheres.length;
  setAction(menuButtons.grid, showGrid ? 'grid: on' : 'grid: off');
  setAction(menuButtons.spin, autoRotate ? 'auto-rotate: on' : 'auto-rotate: off');
  describeLoop(); // what record loop would capture now
}

function addLoader() {
  fileEl = createElement('input');
  fileEl.attribute('type', 'file');
  fileEl.attribute('accept', '.json,application/json');
  fileEl.style('display', 'none');
  fileEl.changed(loadSceneFile);
}

function loadSceneFile(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let scene;
    try {
      scene = JSON.parse(reader.result);
    } catch (err) {
      console.error('load: invalid JSON', err);
      return;
    }
    if (!Array.isArray(scene)) { console.error('load: expected a list of spheres'); return; }
    spheres = scene.map(d => sphereFromSaved(d));
    selectedIndex = -1;
  };
  reader.readAsText(file);
  evt.target.value = ''; // allow re-loading the same file later
}

function sphereFromSaved(d) {
  const s = new LetterSphere(typeof d.letter == 'string' && d.letter.length ? d.letter : '?');
  s.x = +d.x || 0;   s.y = +d.y || 0;   s.z = +d.z || 0;
  s.sx = +d.sx || 1; s.sy = +d.sy || 1; s.sz = +d.sz || 1;
  s.rx = +d.rx || 0; s.ry = +d.ry || 0; s.rz = +d.rz || 0;
  s.fontSize = +d.fontSize || 100;
  s.frozen = !!d.frozen;
  s.direction = d.direction < 0 ? -1 : 1;
  return s;
}

// draws a letter to the buffer; its distance from the buffer centre maps to latitude
function drawToBuffer(letter, size) {
  buffer.background(255);
  buffer.fill(0);
  buffer.push();
  buffer.translate(buffer.width/2, buffer.height/2 - 60);
  buffer.rotate(0);
  buffer.textSize(size);
  buffer.text(letter, 0, 0);
  buffer.pop();
}

// the grid geometry never changes, so build it once and share it
function createPolarGrid() {
  for (let i = 0 ; i < 360 ; i += inc) {
    for (let j = 0 ; j < divs ; j++){
      elements.push(new Element(j * divSize, i));
    }
  }
}

// grid lines (meridians + parallels) as retained geometry. p5 refuses
// wireframe strokes on ellipsoids above detail 24, so the lines are encoded
// as degenerate faces [a, b, b]: model()'s edge builder then emits exactly
// the grid segments, with no triangulation diagonals
function buildGridGeometry() {
  gridGeom = new p5.Geometry(1, 0);
  const addLine = (a, b) => {
    const n = gridGeom.vertices.length;
    gridGeom.vertices.push(
      new p5.Vector(a[0], a[1], a[2]),
      new p5.Vector(b[0], b[1], b[2])
    );
    gridGeom.faces.push([n, n + 1, n + 1]);
  };
  for (const el of elements) {
    addLine([el.ax, el.ay, el.az], [el.bx, el.by, el.bz]); // parallel
    addLine([el.ax, el.ay, el.az], [el.dx, el.dy, el.dz]); // meridian
    if (el.r + divSize >= divs * divSize) {
      addLine([el.dx, el.dy, el.dz], [el.cx, el.cy, el.cz]); // last parallel
    }
  }
}

// each cell votes from its sub-samples straight in the buffer's pixel
// array: ink is anything darker than mid-gray (the font antialiases its
// edges), and the cell lights when at least half the votes are ink
function sampleSphere(s) {
  drawToBuffer(s.letter, s.fontSize);
  buffer.loadPixels();
  const px = buffer.pixels;
  for (let n = 0 ; n < elements.length ; n++) {
    const idx = elements[n].pixIdx;
    let ink = 0, seen = 0;
    for (let i = 0 ; i < idx.length ; i++) {
      const p = idx[i];
      if (p < 0) continue; // sub-sample outside the buffer
      seen++;
      if (px[p] < 128) ink++;
    }
    s.bits[n] = seen > 0 && ink * 2 >= seen ? 1 : 0;
  }
  s.lastSampled = s.fontSize;
}

// the letter grows from the pole until it spans the sphere, then contracts
function updatePulse(s) {
  if (s.frozen) return;
  s.tick++;
  if (s.tick % 4 == 0) {
    if (s.fontSize > 1200 || s.fontSize < 100) {
      s.direction *= -1;
    }
    s.fontSize += s.direction * 50;
  }
}

// each on-cell is a quad spanning its full longitude section. with the
// grid on the cells draw inset, so the letter separates into the cells
// its pixels occupy instead of merging into one solid blob
function drawSphere(s, selected) {
  push();
  translate(s.x, s.y, s.z);
  rotateX(s.rx);
  rotateY(s.ry);
  rotateZ(s.rz);
  scale(s.sx, s.sy, s.sz);
  noStroke();
  fill(20);
  beginShape(TRIANGLES);
  for (let n = 0 ; n < elements.length ; n++) {
    if (!s.bits[n]) continue;
    const el = elements[n];
    if (showGrid) {
      vertex(el.iax, el.iay, el.iaz);
      vertex(el.ibx, el.iby, el.ibz);
      vertex(el.icx, el.icy, el.icz);
      vertex(el.iax, el.iay, el.iaz);
      vertex(el.icx, el.icy, el.icz);
      vertex(el.idx, el.idy, el.idz);
    } else {
      vertex(el.ax, el.ay, el.az);
      vertex(el.bx, el.by, el.bz);
      vertex(el.cx, el.cy, el.cz);
      vertex(el.ax, el.ay, el.az);
      vertex(el.cx, el.cy, el.cz);
      vertex(el.dx, el.dy, el.dz);
    }
  }
  endShape();
  // the lattice doubles as the selection indicator: gray context lines for
  // the unselected, the selection hue at full weight for the selected --
  // orange when the pulse is frozen, cyan otherwise
  if (showGrid || selected) {
    noFill();
    if (selected) {
      stroke(s.frozen ? 8 : 50, 100, 100);
      strokeWeight(1);
    } else {
      stroke(0, 0, 70);
      strokeWeight(0.5);
    }
    push();
    scale(1.003); // float just above the letter cells so lines never z-fight
    model(gridGeom);
    pop();
  }
  pop();
}

function draw(){
  if (!recordBeforeFrame()) return;
  background(255);
  syncMenu();

  if (drag) easycam.setState(drag.camState); // keep the camera still while dragging a letter

  // turntable: the whole scene turns about the world's y axis. Left on the
  // matrix (no push/pop), so picking, which projects with the matrix the
  // frame ended on, still finds the spheres where they're drawn
  if (autoRotate) {
    const frames = turnFrames();
    // the turn's length follows the pulse loop; keep the angle if it changes
    if (spinFrames && frames !== spinFrames) spinFrame = Math.round(spinFrame * frames / spinFrames);
    spinFrames = frames;
    spinFrame = (spinFrame + 1) % frames;
    rotateY(360 * spinFrame / frames); // angleMode is DEGREES
  }

  for (let i = 0 ; i < spheres.length ; i++) {
    const s = spheres[i];
    updatePulse(s);
    if (s.fontSize != s.lastSampled) sampleSphere(s);
    drawSphere(s, i == selectedIndex);
  }
}

// Turn a sphere so its letter faces the camera as the scene stands right now
// (camera orbit and turntable spin), upright on screen. SPAWN_RX faces the
// identity camera; this undoes the view's rotation (the matrix the last frame
// ended on: camera × spin, which spheres push/pop around) and applies that
// pose, decomposed into the rotateX·rotateY·rotateZ drawSphere applies.
function faceCamera(s) {
  const m = rendererGL.uMVMatrix.mat4; // column-major
  const V = (r, c) => m[c * 4 + r];
  const t = radians(SPAWN_RX); // angleMode is DEGREES
  const D = [[1, 0, 0], [0, Math.cos(t), -Math.sin(t)], [0, Math.sin(t), Math.cos(t)]];
  // W = Vᵀ·D: the view's inverse rotation, then the face-on pose
  const W = [0, 1, 2].map((r) => [0, 1, 2].map((c) =>
    V(0, r) * D[0][c] + V(1, r) * D[1][c] + V(2, r) * D[2][c]));
  const b = Math.asin(Math.max(-1, Math.min(1, W[0][2])));
  let a, c;
  if (Math.abs(Math.cos(b)) > 1e-6) {
    a = Math.atan2(-W[1][2], W[2][2]);
    c = Math.atan2(-W[0][1], W[0][0]);
  } else { // gimbal lock: fold the roll into rx
    a = Math.atan2(W[2][1], W[1][1]);
    c = 0;
  }
  s.rx = degrees(a);
  s.ry = degrees(b);
  s.rz = degrees(c);
}

// world -> screen pixels, or null if behind the camera
function project(x, y, z) {
  const m = rendererGL.uMVMatrix.mat4;
  const p = rendererGL.uPMatrix.mat4;
  const ex = m[0]*x + m[4]*y + m[8]*z + m[12];
  const ey = m[1]*x + m[5]*y + m[9]*z + m[13];
  const ez = m[2]*x + m[6]*y + m[10]*z + m[14];
  const w = p[3]*ex + p[7]*ey + p[11]*ez + p[15];
  if (w <= 0) return null;
  const cx = p[0]*ex + p[4]*ey + p[8]*ez + p[12];
  const cy = p[1]*ex + p[5]*ey + p[9]*ez + p[13];
  return [width/2 * (1 + cx/w), height/2 * (1 - cy/w), w];
}

// screen-space hit test against each sphere's projected bounding disc,
// closest to the camera wins
function pickSphere(mx, my) {
  let best = -1, bestW = Infinity;
  for (let i = 0 ; i < spheres.length ; i++) {
    const s = spheres[i];
    const c = project(s.x, s.y, s.z);
    if (!c) continue;
    const rMax = sphereR * max(s.sx, s.sy, s.sz);
    const e = project(s.x + rMax, s.y, s.z);
    const rad = e ? dist(c[0], c[1], e[0], e[1]) : rMax;
    if (dist(mx, my, c[0], c[1]) > max(rad, 25)) continue;
    if (c[2] < bestW) { bestW = c[2]; best = i; }
  }
  return best;
}

// only reached when the grab interceptor let the event through,
// i.e. the click was on empty space. p5 fires this from a window-level
// listener, so it also sees mousedowns on the panels' buttons -- those
// must not deselect (the button's own handler already ran by then)
function mousePressed(e){
  if (!EDIT_MODE) return;
  if (mouseButton != LEFT) return;
  if (e && e.target !== canvas) return;
  selectedIndex = -1;
}

function startDrag(index, mx, my, shiftKey) {
  selectedIndex = index;
  const s = spheres[index];
  const p0 = project(s.x, s.y, s.z);
  const mv = rendererGL.uMVMatrix.mat4;
  const right = [mv[0], mv[4], mv[8]];
  const up = [mv[1], mv[5], mv[9]];
  const pr = project(s.x + right[0], s.y + right[1], s.z + right[2]);
  const pu = project(s.x + up[0], s.y + up[1], s.z + up[2]);
  if (!p0 || !pr || !pu) return;
  const det = (pr[0]-p0[0])*(pu[1]-p0[1]) - (pu[0]-p0[0])*(pr[1]-p0[1]);
  if (abs(det) < 1e-6) return;
  drag = {
    index: index,
    mode: shiftKey ? 'rotate' : 'move',
    mx: mx, my: my,
    c0: [s.x, s.y, s.z],
    right: right, up: up,
    pr: [pr[0]-p0[0], pr[1]-p0[1]],
    pu: [pu[0]-p0[0], pu[1]-p0[1]],
    det: det,
    camState: easycam.getState()
  };
}

// apply one step of the active grab, in canvas pixels
function applyDrag(mx, my){
  const s = spheres[drag.index];
  const dx = mx - drag.mx, dy = my - drag.my;
  if (drag.mode == 'rotate') {
    s.ry += dx * 0.4;
    s.rx -= dy * 0.4; // reversed: a face-on letter's surface follows the drag
    drag.mx = mx; drag.my = my;
  } else {
    // solve the screen-space drag against the camera-plane basis;
    // delta stays relative to the press point so moves accumulate
    const a = ( dx*drag.pu[1] - dy*drag.pu[0]) / drag.det;
    const b = ( drag.pr[0]*dy - drag.pr[1]*dx) / drag.det;
    s.x = drag.c0[0] + a*drag.right[0] + b*drag.up[0];
    s.y = drag.c0[1] + a*drag.right[1] + b*drag.up[1];
    s.z = drag.c0[2] + a*drag.right[2] + b*drag.up[2];
  }
}

function keyPressed(){
  if (!EDIT_MODE) return; // deployed is view-only: no typing, no edits
  if (take) return false; // locked while a take renders the loop
  if (keyCode == 192) { // ` key
    recordKeypress();
    return false;
  }

  if (key.length == 1 && key.match(/[a-zA-Z0-9]/)) {
    const sel = selectedIndex >= 0 ? spheres[selectedIndex] : null;
    if (keyIsDown(SHIFT)) {
      if (key == 'G') {
        showGrid = !showGrid;
      } else if (key == 'A') {
        autoRotate = !autoRotate;
      } else if (key == 'F' && sel) {
        sel.frozen = !sel.frozen;
      } else if (key == 'R' && sel) {
        sel.sx = sel.sy = sel.sz = 1;
        faceCamera(sel);
      } else if (EDIT_MODE && key == 'S') {
        saveScene();
      } else if (EDIT_MODE && key == 'L') {
        fileEl.elt.click();
      } else if (EDIT_MODE && key == 'I') {
        saveSquare();
      }
    } else {
      const s = new LetterSphere(key.toUpperCase());
      faceCamera(s);
      spheres.push(s);
    }
    return false;
  }

  const sel = selectedIndex >= 0 ? spheres[selectedIndex] : null;

  if (keyCode == BACKSPACE || keyCode == DELETE) {
    deleteSphere();
    return false;
  }

  if (!sel) return false;

  const step = 0.05;
  if (keyCode == LEFT_ARROW)       sel.sx = max(0.1, sel.sx - step);
  else if (keyCode == RIGHT_ARROW) sel.sx = min(4, sel.sx + step);
  else if (keyCode == UP_ARROW)    sel.sy = min(4, sel.sy + step);
  else if (keyCode == DOWN_ARROW)  sel.sy = max(0.1, sel.sy - step);
  else if (keyCode == 91)          sel.sz = max(0.1, sel.sz - step); // [
  else if (keyCode == 93)          sel.sz = min(4, sel.sz + step);  // ]
  return false;
}

// export filenames carry a spx-<DDMMYYYY>-<HHMM> stamp, so successive saves
// never collide and a still sorts beside the scene it came from
function spxStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return p(d.getDate()) + p(d.getMonth() + 1) + d.getFullYear() + '-' + p(d.getHours()) + p(d.getMinutes());
}

// shift+s: dump every sphere's letter, transform and pulse state to a
// downloaded JSON file
function saveScene() {
  saveJSON(sceneData(), 'spx-json-' + spxStamp() + '.json');
}

// every sphere's letter, transform and pulse state: the shape of both the
// downloaded JSON and settings.js's `scene`
function sceneData() {
  return spheres.map(s => ({
    letter: s.letter,
    x: s.x, y: s.y, z: s.z,
    sx: s.sx, sy: s.sy, sz: s.sz,
    rx: s.rx, ry: s.ry, rz: s.rz,
    fontSize: s.fontSize,
    frozen: s.frozen,
    direction: s.direction
  }));
}

// shift+i: export the square crop guide's region as a PNG. the WebGL canvas
// is drawImage'd into a 2D canvas (composited, so no readPixels Y-flip to
// worry about); the guide itself is DOM, so it never appears in the export
function saveSquare() {
  const side = height; // largest square inscribed in the 16:9 canvas
  const out = document.createElement('canvas');
  out.width = side;
  out.height = side;
  out.getContext('2d').drawImage(canvas, (width - side) / 2, 0, side, side, 0, 0, side, side);
  const a = document.createElement('a');
  a.href = out.toDataURL('image/png');
  a.download = 'spx-' + spxStamp() + '.png';
  a.click();
}
