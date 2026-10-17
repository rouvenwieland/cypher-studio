# Cypher Studio – Desktop-App

Tauri 2 + React 19 + TypeScript. Überblick: [../../README.md](../../README.md), Bauen und Testen: [../../docs/BAUEN.md](../../docs/BAUEN.md).

```
npm run dev        # Oberfläche im Browser mit gemocktem Kern (Port 1420)
npm test           # Vitest
npm run e2e        # Playwright gegen den Mock
npm run e2e:real   # Playwright gegen die echte Windows-App (Debug-Build aus scripts/wsl-build.sh e2e)
```
