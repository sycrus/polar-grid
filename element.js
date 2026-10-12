const SAMPLES = 4; // sub-samples along each cell edge: 4x4 = 16 votes per cell
const INSET = 0.12; // grid-on shrink per cell edge, as a fraction of the cell

class Element {
  // one longitude section x one latitude division of the sphere grid.
  // all geometry is precomputed once: only `bit` (on/off from the buffer) changes each frame
  constructor (r, theta) {
    this.r = r;
    this.theta = theta;
    this.phi = map(r, 0, divs * divSize, 0, 180); // grid center -> edge becomes north -> south pole
    this.bit = false;

    // a SAMPLES x SAMPLES ballot spread over the cell's footprint, each
    // point precomputed into the buffer's pixel array (-1 when it falls
    // outside the buffer). sampleSphere lights the cell when at least half
    // the votes hit ink, so its edges follow the lattice instead of
    // hinging on one lucky centre pixel
    this.pixIdx = [];
    for (let i = 0 ; i < SAMPLES ; i++) {
      for (let j = 0 ; j < SAMPLES ; j++) {
        const sampleR = r + divSize * (i + 0.5) / SAMPLES;
        const sampleTheta = theta + inc * (j + 0.5) / SAMPLES;
        const x = sampleR * cos(sampleTheta) + buffer.width / 2;
        const y = sampleR * sin(sampleTheta) + buffer.height / 2;
        this.pixIdx.push(
          x >= 0 && x < buffer.width && y >= 0 && y < buffer.height
            ? (int(y) * buffer.width + int(x)) * 4
            : -1
        );
      }
    }

    // corners of the cell on the sphere: [phi, phi+dphi] x [theta, theta+inc]
    const phi2 = map(r + divSize, 0, divs * divSize, 0, 180);
    const theta2 = theta + inc;
    this.setCorner('a', this.phi, theta);
    this.setCorner('b', this.phi, theta2);
    this.setCorner('c', phi2, theta2);
    this.setCorner('d', phi2, theta);

    // the same corners pulled toward the cell centre. with the grid on, lit
    // cells draw from these instead, leaving a hairline between neighbours:
    // the letter then reads as the mosaic of cells its pixels occupy
    const mx = (this.ax + this.bx + this.cx + this.dx) / 4;
    const my = (this.ay + this.by + this.cy + this.dy) / 4;
    const mz = (this.az + this.bz + this.cz + this.dz) / 4;
    this.setInset('a', mx, my, mz);
    this.setInset('b', mx, my, mz);
    this.setInset('c', mx, my, mz);
    this.setInset('d', mx, my, mz);
  }
  setInset(name, mx, my, mz) {
    const k = 1 - INSET;
    this['i' + name + 'x'] = mx + (this[name + 'x'] - mx) * k;
    this['i' + name + 'y'] = my + (this[name + 'y'] - my) * k;
    this['i' + name + 'z'] = mz + (this[name + 'z'] - mz) * k;
  }
  setCorner(name, phi, theta) {
    this[name + 'x'] = sphereR * sin(phi) * cos(theta);
    this[name + 'y'] = -sphereR * cos(phi);
    this[name + 'z'] = sphereR * sin(phi) * sin(theta);
  }
}

class LetterSphere {
  constructor (letter) {
    this.letter = letter;
    this.x = 0;
    this.y = 0;
    this.z = 0; // spawn centred, directly in front of the camera
    this.sx = 1; this.sy = 1; this.sz = 1; // scale: distort into an ellipsoid
    this.rx = SPAWN_RX; this.ry = 0;      // turntable tilt and spin; spawn pole-toward-camera
    this.rz = 0; // roll: lets a sphere face any camera pose (faceCamera)
    this.fontSize = 100;
    this.direction = 1;
    this.tick = 0;
    this.frozen = false; // freeze the pulse at the current size
    this.bits = new Uint8Array(elements.length);
    this.lastSampled = -1;
  }
}
