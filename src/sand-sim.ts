// Framework-agnostic falling-sand cellular automaton, shaped into an
// hourglass silhouette. No DOM/React deps so it's easy to reason about and
// re-use (e.g. from a canvas-drawing React component).

export const enum Cell {
  Empty = 0,
  Sand = 1,
  Wall = 2, // the glass outline — blocks movement, gets drawn
  Outside = 3, // outside the glass entirely — blocks movement, not drawn
}

export interface HourglassOptions {
  width: number;
  height: number;
  wallThickness?: number;
  neckHalfWidth?: number;
  bulbHalfWidth?: number;
  capRows?: number;
}

// The 8 compass directions as (dx, dy), index 0 = south (down), stepping
// toward east. Angle 0 = straight down, matching a screen where +y is down.
const OCTANTS: [number, number][] = [
  [0, 1], // S
  [1, 1], // SE
  [1, 0], // E
  [1, -1], // NE
  [0, -1], // N
  [-1, -1], // NW
  [-1, 0], // W
  [-1, 1], // SW
];

/** Angle in units of octants, wrapped into [0, 8). */
function octantsForAngle(angleRad: number): number {
  const normalized = ((angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return (normalized / (Math.PI / 4)) % 8;
}

export class SandGrid {
  readonly width: number;
  readonly height: number;
  private cells: Uint8Array;
  private moved: Uint8Array;
  // A per-grain random byte that travels with the grain, so a renderer can
  // tint each grain individually instead of by where it happens to be.
  private shades: Uint8Array;
  private neckY: number;
  private sweepRight = false;
  private pending: Int8Array; // per-row scratch: octant of each grain still waiting to slide

  constructor(opts: HourglassOptions) {
    const {
      width,
      height,
      wallThickness = 2,
      neckHalfWidth = 3,
      bulbHalfWidth = Math.floor(width * 0.42),
      capRows = Math.round(height * 0.09),
    } = opts;

    this.width = width;
    this.height = height;
    this.cells = new Uint8Array(width * height);
    this.moved = new Uint8Array(width * height);
    this.shades = new Uint8Array(width * height);
    this.pending = new Int8Array(width);
    this.neckY = Math.floor(height / 2);

    this.buildMask({ wallThickness, neckHalfWidth, bulbHalfWidth, capRows });
  }

  private idx(x: number, y: number) {
    return y * this.width + x;
  }

  private halfWidthAt(y: number, neckHalfWidth: number, bulbHalfWidth: number, capRows: number) {
    const maxDist = this.height / 2;
    const distFromNeck = Math.abs(y - this.neckY);
    const t = Math.min(1, distFromNeck / maxDist);
    let hw = neckHalfWidth + (bulbHalfWidth - neckHalfWidth) * Math.pow(t, 1.5);

    const distFromTop = y;
    const distFromBottom = this.height - 1 - y;
    if (distFromTop < capRows) {
      const ct = distFromTop / capRows;
      hw *= Math.sqrt(1 - Math.pow(1 - ct, 2));
    }
    if (distFromBottom < capRows) {
      const ct = distFromBottom / capRows;
      hw *= Math.sqrt(1 - Math.pow(1 - ct, 2));
    }
    return hw;
  }

  private buildMask(opts: { wallThickness: number; neckHalfWidth: number; bulbHalfWidth: number; capRows: number }) {
    const { wallThickness, neckHalfWidth, bulbHalfWidth, capRows } = opts;
    const centerX = (this.width - 1) / 2;

    // Carve the interior first, from the outer profile inset by the wall
    // thickness (rounded to a whole pixel so the staircase stays even), and
    // keep it clear of the top and bottom edges so the caps have room for
    // glass above and below them.
    this.cells.fill(Cell.Outside);
    for (let y = wallThickness; y < this.height - wallThickness; y++) {
      const rawHw = this.halfWidthAt(y, neckHalfWidth, bulbHalfWidth, capRows);
      const innerHw = Math.max(1, Math.round(rawHw) - wallThickness);
      for (let x = 0; x < this.width; x++) {
        if (Math.abs(x - centerX) <= innerHw) this.cells[this.idx(x, y)] = Cell.Empty;
      }
    }

    // Then grow the glass outward from the interior. Deriving the wall from
    // each row's own half-width instead leaves gaps wherever the profile
    // changes by more than the wall thickness between rows (the domed caps),
    // and leaves the first and last rows open to the canvas edge. Reaching
    // at least the diagonal neighbours keeps the outline sealed.
    const reachSq = Math.max(2, wallThickness * wallThickness);
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (this.cells[this.idx(x, y)] !== Cell.Outside) continue;
        search: for (let dy = -wallThickness; dy <= wallThickness; dy++) {
          for (let dx = -wallThickness; dx <= wallThickness; dx++) {
            if (dx * dx + dy * dy > reachSq) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) continue;
            if (this.cells[this.idx(nx, ny)] === Cell.Empty) {
              this.cells[this.idx(x, y)] = Cell.Wall;
              break search;
            }
          }
        }
      }
    }
  }

  /** Fill the top bulb with sand up to a given fraction of its height (0-1). */
  fillTopBulb(fraction: number) {
    const fillUntilY = Math.floor(this.neckY * (1 - fraction));
    for (let y = fillUntilY; y < this.neckY; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = this.idx(x, y);
        if (this.cells[i] === Cell.Empty) {
          this.cells[i] = Cell.Sand;
          this.shades[i] = Math.floor(Math.random() * 256);
        }
      }
    }
  }

  get(x: number, y: number): Cell {
    return this.cells[this.idx(x, y)] as Cell;
  }

  /** The random 0-255 shade of the grain at (x, y). Only meaningful for sand cells. */
  shadeAt(x: number, y: number): number {
    return this.shades[this.idx(x, y)];
  }

  private tryMove(i: number, x: number, y: number, dir: [number, number]): boolean {
    const nx = x + dir[0];
    const ny = y + dir[1];
    if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) return false;
    const ni = this.idx(nx, ny);
    if (this.cells[ni] !== Cell.Empty) return false;
    this.cells[ni] = Cell.Sand;
    this.shades[ni] = this.shades[i];
    this.cells[i] = Cell.Empty;
    this.moved[ni] = 1;
    return true;
  }

  /** Advance the simulation by one tick under gravity pointing at `angleRad` (0 = down). */
  step(angleRad: number) {
    // A grain can only move to one of 8 neighbours, but gravity is a
    // continuous angle. Rather than snapping to the nearest octant (which
    // makes falling sand veer off true-down and then lurch every 45deg as
    // the glass turns), each grain picks between the two octants either side
    // of the real angle, weighted by how close it is to each. On average the
    // sand then falls along the real angle.
    const octants = octantsForAngle(angleRad);
    const lower = Math.floor(octants);
    const upperWeight = octants - lower;

    this.moved.fill(0);

    // Iterate in the order sand is falling so a cell that just moved isn't
    // immediately reprocessed lower in the same pass.
    const scan = OCTANTS[Math.round(octants) % 8];
    const yStart = scan[1] >= 0 ? this.height - 1 : 0;
    const yEnd = scan[1] >= 0 ? -1 : this.height;
    const yStep = scan[1] >= 0 ? -1 : 1;

    // With no sideways component to gravity there's no natural sweep
    // direction, and always sweeping the same way drifts the pile to one
    // side — so alternate.
    this.sweepRight = !this.sweepRight;
    const rightToLeft = scan[0] !== 0 ? scan[0] > 0 : this.sweepRight;
    const xStart = rightToLeft ? this.width - 1 : 0;
    const xEnd = rightToLeft ? -1 : this.width;
    const xStep = rightToLeft ? -1 : 1;

    for (let y = yStart; y !== yEnd; y += yStep) {
      // Two passes per row: every grain gets its straight fall before any
      // grain slides diagonally. In a single pass, whichever neighbour the
      // sweep reaches first slides sideways into a gap ahead of the grain
      // sitting directly above it, so the bulb empties from its edges and
      // leaves a mound in the middle. Straight-first lets the gap rise up
      // the centre and the surface dish in, the way a real one drains.
      this.pending.fill(-1);
      for (let x = xStart; x !== xEnd; x += xStep) {
        const i = this.idx(x, y);
        if (this.cells[i] !== Cell.Sand || this.moved[i]) continue;
        const octant = (Math.random() < upperWeight ? lower + 1 : lower) % 8;
        if (!this.tryMove(i, x, y, OCTANTS[octant])) this.pending[x] = octant;
      }
      for (let x = xStart; x !== xEnd; x += xStep) {
        const octant = this.pending[x];
        if (octant < 0) continue;
        const i = this.idx(x, y);
        // Randomize which diagonal is tried first to avoid a directional bias.
        const first = Math.random() < 0.5 ? 1 : 7;
        if (this.tryMove(i, x, y, OCTANTS[(octant + first) % 8])) continue;
        this.tryMove(i, x, y, OCTANTS[(octant + 8 - first) % 8]);
      }
    }
  }
}
