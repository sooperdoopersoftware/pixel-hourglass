# @sooperdoopersoftware/pixel-hourglass

A pixel-art falling-sand hourglass: a real cellular-automaton sand
simulation (canvas 2D, 1 pixel per grid cell), masked into an hourglass
silhouette. Gravity is a continuous angle rather than a fixed "down," so
turning the glass actually redistributes the sand. Drag to turn it about its
centre (let go mid-swing to fling it) and the glass spins on screen while the
sand keeps falling toward the bottom of the screen. On a phone, device tilt
feeds in real gravity instead: the glass stays put on screen and the sand
falls toward the actual ground, so turning the phone over turns the
hourglass over.

Extracted from [sooperdoopersoftware.com](https://sooperdoopersoftware.com)'s
`/visuals/pixel-hourglass`.

## Usage

This package ships TypeScript source directly (no build step). In a Next.js
app, add it to `transpilePackages` in `next.config.ts`:

```ts
const nextConfig: NextConfig = {
  transpilePackages: ["@sooperdoopersoftware/pixel-hourglass"],
};
```

```tsx
import { PixelHourglass } from "@sooperdoopersoftware/pixel-hourglass";

export default function Page() {
  return <PixelHourglass />;
}
```

`PixelHourglass` uses browser-only APIs (canvas, device orientation) —
render it client-side only (e.g. via `next/dynamic` with `ssr: false`).

## Install

```
npm install github:sooperdoopersoftware/pixel-hourglass#v0.1.0
```

## License

MIT
