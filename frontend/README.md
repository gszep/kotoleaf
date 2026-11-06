# Kotoleaf frontend

SvelteKit (Svelte 5) app: rolling bilingual summaries, session controls, speaker map, and settings (display mode, register, JLPT threshold, audio source). Connects to the backend over `VITE_API_BASE` (default `http://localhost:8000`; WebSocket URL derived from it).

```sh
npm install
npm run dev      # dev server on :5173
npm run build    # production build
npm run preview  # preview the production build
```

For the full picture (backend, docker compose, Cloudflare speech gateway): see `../README.md`, `../DESIGN.md`, and `../worker/README.md`.
