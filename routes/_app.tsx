import type { ComponentChildren } from "preact";

export default function App({ Component }: { Component: ComponentChildren }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow, noai, noimageai" />
        <title>Now Playing</title>
      </head>
      <body>
        <Component />
      </body>
    </html>
  );
}