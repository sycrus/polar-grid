
/*
* Each typed letter spawns a sphere whose grid pulses out from its pole.
* Click a sphere to select it, drag to move it, shift+drag to rotate it.
* Arrow keys stretch the selection into an ellipsoid ([ and ] for depth),
* f freezes the pulse at the current size, r resets the shape (hold shift),
* shift+g toggles the longitude/latitude grid on all spheres,
* shift+s saves the scene as JSON, shift+l loads one back in,
* backspace deletes the selection; the bottom bar mirrors it all as buttons.
*/

let buffer;
let easycam;
let sphereR = 220; // radius of the sphere

let rays = 90; // how many rays (longitude sections)
let divs = 80; // how many divisions for each ray
let divSize = 0; // size of each div
let inc;

let elements = []; // shared grid template, same for every sphere
let spheres = [];
let selectedIndex = -1;
let drag = null;
let showGrid = false; // show the longitude/latitude grid on all spheres
let gridGeom;
let menuButtons = {};
let menuState = '';
let fileEl; // hidden <input type=file> used by load
let frameEl; // DOM overlay: square crop guide for recording

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
  easycam = createEasyCam();
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
  spheres.push(new LetterSphere('X'));

  rendererGL = p5.instance._renderer;
  addMenu();
  addLoader();
  addSquareFrame();
  addGrabInterceptor();
  addContextMenuRelease();
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

// right-click -> "save image as" leaves easycam stuck: its mouseup is on
// the canvas, but the native menu swallows it, so the right-button bit in
// its held-button bitmask never clears and every later drag also zooms.
// release the button synthetically when the menu opens; the menu still works
function addContextMenuRelease() {
  canvas.addEventListener('contextmenu', () => {
    canvas.dispatchEvent(new MouseEvent('mouseup', { button: 2, bubbles: true }));
  });
}

// largest 16:9 rectangle that fits the viewport
function fitSize() {
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
  frameEl.style('border', '1px solid rgba(0,0,0,0.35)');
  frameEl.style('box-shadow', '0 0 0 1px rgba(255,255,255,0.35)');
  frameEl.style('pointer-events', 'none');
  updateSquareFrame();
}

function updateSquareFrame() {
  if (!frameEl) return;
  const side = height; // largest square inscribed in the 16:9 canvas
  frameEl.style('width', side + 'px');
  frameEl.style('height', side + 'px');
  frameEl.style('left', (windowWidth - width) / 2 + (width - side) / 2 + 'px');
  frameEl.style('top', (windowHeight - height) / 2 + 'px');
}

// clickable control bar pinned to the bottom of the page: buttons for the
// toggles and file actions, hint text for the mouse/keyboard gestures.
// DOM, so it never appears in recorded frames
function addMenu() {
  const bar = createDiv('');
  bar.id('menu');
  const btn = (label, fn) => {
    const b = createButton(label);
    b.parent(bar);
    b.mousePressed(fn);
    return b;
  };
  const sep = () => createSpan('|').parent(bar).class('sep');

  menuButtons.freeze = btn('freeze (F)', () => { const s = selSphere(); if (s) s.frozen = !s.frozen; });
  menuButtons.reset  = btn('reset (R)',  () => { const s = selSphere(); if (s) { s.sx = s.sy = s.sz = 1; s.rx = s.ry = 0; } });
  menuButtons.del    = btn('delete (⌫)', deleteSphere);
  sep();
  menuButtons.grid   = btn('grid: off (G)', () => { showGrid = !showGrid; });
  sep();
  menuButtons.save   = btn('save (S)', saveScene);
  menuButtons.load   = btn('load (L)', () => fileEl.elt.click());
  menuButtons.record = btn('record (`)', recordKeypress);

  const hint = createDiv(
    'type a letter or number: spawn &nbsp;&nbsp; click sphere: select &nbsp;&nbsp; drag: move &nbsp;&nbsp; shift+drag: rotate &nbsp;&nbsp; arrows / [ ]: stretch<br>' +
    'drag empty space: orbit &nbsp;&nbsp; scroll: zoom &nbsp;&nbsp; right-click: save image &nbsp;&nbsp;·&nbsp;&nbsp; ' +
    'typeface: <a href="https://fonts.google.com/specimen/Aladin" target="_blank">Aladin by Santiago Orozco (SIL OFL)</a>'
  );
  hint.parent(bar);
  hint.class('hint');
}

function selSphere() {
  return selectedIndex >= 0 ? spheres[selectedIndex] : null;
}

function deleteSphere() {
  if (!spheres.length) return;
  spheres.splice(selectedIndex >= 0 ? selectedIndex : spheres.length - 1, 1);
  selectedIndex = -1;
}

// enable/disable and relabel the buttons to match selection, grid and
// frozen state; skipped unless something changed
function syncMenu() {
  const sel = selSphere();
  const state = selectedIndex + ',' + (sel && sel.frozen) + ',' + showGrid + ',' + spheres.length;
  if (state === menuState) return;
  menuState = state;
  menuButtons.freeze.elt.disabled = !sel;
  menuButtons.freeze.elt.textContent = sel && sel.frozen ? 'unfreeze (F)' : 'freeze (F)';
  menuButtons.reset.elt.disabled = !sel;
  menuButtons.del.elt.disabled = !spheres.length;
  menuButtons.grid.elt.textContent = showGrid ? 'grid: on (G)' : 'grid: off (G)';
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
  s.rx = +d.rx || 0; s.ry = +d.ry || 0;
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

// read each cell's bit straight from the buffer's pixel array
function sampleSphere(s) {
  drawToBuffer(s.letter, s.fontSize);
  buffer.loadPixels();
  const px = buffer.pixels;
  for (let n = 0 ; n < elements.length ; n++) {
    const el = elements[n];
    s.bits[n] = el.inBuffer && px[el.pixIndex] === 0 ? 1 : 0;
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

// each on-cell is a quad spanning its full longitude section
function drawSphere(s, selected) {
  push();
  translate(s.x, s.y, s.z);
  rotateX(s.rx);
  rotateY(s.ry);
  scale(s.sx, s.sy, s.sz);
  noStroke();
  fill(20);
  beginShape(TRIANGLES);
  for (let n = 0 ; n < elements.length ; n++) {
    if (!s.bits[n]) continue;
    const el = elements[n];
    vertex(el.ax, el.ay, el.az);
    vertex(el.bx, el.by, el.bz);
    vertex(el.cx, el.cy, el.cz);
    vertex(el.ax, el.ay, el.az);
    vertex(el.cx, el.cy, el.cz);
    vertex(el.dx, el.dy, el.dz);
  }
  endShape();
  if (showGrid) {
    noFill();
    stroke(0, 0, 70);
    strokeWeight(0.5);
    push();
    scale(1.003); // float just above the letter cells so lines never z-fight
    model(gridGeom);
    pop();
  }
  if (selected) {
    noFill();
    stroke(s.frozen ? 8 : 50, 100, 100); // orange when the pulse is frozen, cyan otherwise
    sphere(sphereR, 24, 16);
  }
  pop();
}

function draw(){
  myRecord();
  background(255);
  syncMenu();

  if (drag) easycam.setState(drag.camState); // keep the camera still while dragging a letter

  for (let i = 0 ; i < spheres.length ; i++) {
    const s = spheres[i];
    updatePulse(s);
    if (s.fontSize != s.lastSampled) sampleSphere(s);
    drawSphere(s, i == selectedIndex);
  }
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
// i.e. the click was on empty space
function mousePressed(){
  if (mouseButton != LEFT) return;
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
    s.rx += dy * 0.4;
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
  if (keyCode == 192) { // ` key
    recordKeypress();
    return false;
  }

  if (key.length == 1 && key.match(/[a-zA-Z0-9]/)) {
    const sel = selectedIndex >= 0 ? spheres[selectedIndex] : null;
    if (keyIsDown(SHIFT)) {
      if (key == 'G') {
        showGrid = !showGrid;
      } else if (key == 'F' && sel) {
        sel.frozen = !sel.frozen;
      } else if (key == 'R' && sel) {
        sel.sx = sel.sy = sel.sz = 1;
        sel.rx = sel.ry = 0;
      } else if (key == 'S') {
        saveScene();
      } else if (key == 'L') {
        fileEl.elt.click();
      }
    } else {
      spheres.push(new LetterSphere(key.toUpperCase()));
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

// shift+s: dump every sphere's letter, transform and pulse state to a
// downloaded JSON file
function saveScene() {
  const scene = spheres.map(s => ({
    letter: s.letter,
    x: s.x, y: s.y, z: s.z,
    sx: s.sx, sy: s.sy, sz: s.sz,
    rx: s.rx, ry: s.ry,
    fontSize: s.fontSize,
    frozen: s.frozen,
    direction: s.direction
  }));
  saveJSON(scene, 'polar-grid-letters.json');
}
