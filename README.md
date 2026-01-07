# EA Lite (Desktop)

Minimal Electron + React desktop foundation for:
- Application inventory (later)
- Application-to-application dependency graph (visualized now)
- Impact analysis (later)

## Dev

```powershell
npm install
npm run dev
```

## Notes

- Electron main process: `src/main/main.js`
- React renderer: `src/renderer/*` (Vite root)
- Preload bridge: `src/preload/preload.js`
