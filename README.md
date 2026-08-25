# @sooperdoopersoftware/pixel-hourglass

A pixel-art falling-sand hourglass: a real cellular-automaton sand
simulation (canvas 2D, 1 pixel per grid cell), masked into an hourglass
silhouette. Gravity is a continuous angle rather than a fixed "down," so
tilting — via drag or real device orientation on a phone — actually
redistributes the sand. The glass itself spins through a fixed on-screen
read line as you tilt it, the way a real hourglass looks when you turn it
over in your hand.

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
