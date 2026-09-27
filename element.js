class Element {
  // one longitude section x one latitude division of the sphere grid.
  // all geometry is precomputed once: only `bit` (on/off from the buffer) changes each frame
  constructor (r, theta) {
    this.r = r;
    this.theta = theta;
    this.phi = map(r, 0, divs * divSize, 0, 180); // grid center -> edge becomes north -> south pole
    this.bit = false;

    // sample at the cell's centre, precomputed into the buffer's pixel array
    const sampleR = r + divSize / 2;
    const sampleTheta = theta + inc / 2;
    const x = sampleR * cos(sampleTheta) + buffer.width / 2;
    const y = sampleR * sin(sampleTheta) + buffer.height / 2;
    this.inBuffer = x >= 0 && x < buffer.width && y >= 0 && y < buffer.height;
    this.pixIndex = (int(y) * buffer.width + int(x)) * 4;

    // corners of the cell on the sphere: [phi, phi+dphi] x [theta, theta+inc]
    const phi2 = map(r + divSize, 0, divs * divSize, 0, 180);
    const theta2 = theta + inc;
    this.setCorner('a', this.phi, theta);
    this.setCorner('b', this.phi, theta2);
    this.setCorner('c', phi2, theta2);
    this.setCorner('d', phi2, theta);
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
    this.x = random(-140, 140);
    this.y = random(-90, 90);
    this.z = random(-140, 140);
    this.sx = 1; this.sy = 1; this.sz = 1; // scale: distort into an ellipsoid
    this.rx = 0; this.ry = 0;             // turntable tilt and spin
    this.fontSize = 100;
    this.direction = 1;
    this.tick = 0;
    this.frozen = false; // freeze the pulse at the current size
    this.bits = new Uint8Array(elements.length);
    this.lastSampled = -1;
  }
}
