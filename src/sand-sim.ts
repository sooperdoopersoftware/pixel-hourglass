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

// The 8 compass directions as (dx, dy), index 0 = south (down), increasing
// clockwise. Angle 0 = straight down, matching a screen where +y is down.
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

function octantIndexForAngle(angleRad: number): number {
  const normalized = ((angleRad % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  return Math.round(normalized / (Math.PI / 4)) % 8;
}

export class SandGrid {
  readonly width: number;
  readonly height: number;
  private cells: Uint8Array;
  private moved: Uint8Array;
  private neckY: number;

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

    for (let y = 0; y < this.height; y++) {
      // Round the outer radius to a whole pixel *before* deriving the inner
      // radius from it, and never let it collapse below the wall's own
      // thickness. Otherwise the fractional dome/funnel curve produces an
      // uneven, sometimes-1px-sometimes-2px staircase, and the wall ring
      // can shrink to less than a pixel wide near the cap tips and break
      // apart into stray isolated dots instead of a continuous outline.
      const rawHw = this.halfWidthAt(y, neckHalfWidth, bulbHalfWidth, capRows);
      const hw = Math.max(wallThickness + 1, Math.round(rawHw));
      const innerHw = Math.max(0, hw - wallThickness);
      for (let x = 0; x < this.width; x++) {
        const dist = Math.abs(x - centerX);
        let cell: Cell;
        if (dist <= innerHw) cell = Cell.Empty;
        else if (dist <= hw) cell = Cell.Wall;
        else cell = Cell.Outside;
        this.cells[this.idx(x, y)] = cell;
      }
    }
  }

  /** Fill the top bulb with sand up to a given fraction of its height (0-1). */
  fillTopBulb(fraction: number) {
    const fillUntilY = Math.floor(this.neckY * (1 - fraction));
    for (let y = fillUntilY; y < this.neckY; y++) {
      for (let x = 0; x < this.width; x++) {
        const i = this.idx(x, y);
        if (this.cells[i] === Cell.Empty) this.cells[i] = Cell.Sand;
      }
    }
  }

  get(x: number, y: number): Cell {
    return this.cells[this.idx(x, y)] as Cell;
  }

  /** Advance the simulation by one tick under gravity pointing at `angleRad` (0 = down). */
  step(angleRad: number) {
    const idx = octantIndexForAngle(angleRad);
    const primary = OCTANTS[idx];
    const diagA = OCTANTS[(idx + 7) % 8];
    const diagB = OCTANTS[(idx + 1) % 8];

    this.moved.fill(0);

    // Iterate in the order sand is falling so a cell that just moved isn't
    // immediately reprocessed lower in the same pass.
    const yStart = primary[1] >= 0 ? this.height - 1 : 0;
    const yEnd = primary[1] >= 0 ? -1 : this.height;
    const yStep = primary[1] >= 0 ? -1 : 1;

    for (let y = yStart; y !== yEnd; y += yStep) {
      const xStart = primary[0] > 0 ? this.width - 1 : 0;
      const xEnd = primary[0] > 0 ? -1 : this.width;
      const xStep = primary[0] > 0 ? -1 : 1;

      for (let x = xStart; x !== xEnd; x += xStep) {
        const i = this.idx(x, y);
        if (this.cells[i] !== Cell.Sand || this.moved[i]) continue;

        const tryMove = (dx: number, dy: number): boolean => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= this.width || ny < 0 || ny >= this.height) return false;
          const ni = this.idx(nx, ny);
          if (this.cells[ni] !== Cell.Empty) return false;
          this.cells[ni] = Cell.Sand;
          this.cells[i] = Cell.Empty;
          this.moved[ni] = 1;
          return true;
        };

        if (tryMove(primary[0], primary[1])) continue;
        // Randomize which diagonal is tried first to avoid a directional bias.
        if (Math.random() < 0.5) {
          if (tryMove(diagA[0], diagA[1])) continue;
          tryMove(diagB[0], diagB[1]);
        } else {
          if (tryMove(diagB[0], diagB[1])) continue;
          tryMove(diagA[0], diagA[1]);
        }
      }
    }
  }
}
