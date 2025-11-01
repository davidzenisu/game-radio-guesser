# Game Radio Guesser (Next.js)

Small website that lets you guess a song's release decade for songs currently playing on radio stations.

This repository has been refactored into a Next.js app and uses the RadioBrowser and MusicBrainz public APIs.

Quick start (after cloning):

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

Build for production:

```bash
npm run build
npm run start
```

Tailwind CSS is configured (see `tailwind.config.cjs` and `postcss.config.cjs`). The UI uses simple shadcn-style components in `/components` (Button, Card, Spinner).

