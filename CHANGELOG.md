# Changelog

## v1.3.0 · #VLO-2611-PRO01 (2026-11-22)
- Suite Trader Pro: Behavioral Analytics, Guardrail, Playbook, Review, Export, Multi-Account & PWA: Penambahan 10 fitur pro tanpa mengubah UI editorial VLO: Cost of Mistakes & tag emosi, Guardrail Risiko & Checklist SOP pra-eksekusi, Review Mingguan/Bulanan, konteks Macro News di detail trade, Export PDF & Shareable PNG Card, Playbook Setup A+, Pintasan Keyboard & Quick Command (Cmd+K), PWA Offline-First, Multi-Akun / Sub-Portofolio, serta pembersihan dependensi tidak terpakai.

All notable releases and Git push revisions for VLO Journal carry a semantic version (`vX.Y.Z`) and a unique change code (`#VLO-YYMM-XXXX`).

Run `npm run version:bump` before committing/pushing a new change to automatically increment the version and issue a new change code.

## v1.2.1 · #VLO-2611-FLD01 (2026-11-21)
- **Precision Tactile Fluidity UI & Motion**: Revived `.animate-in` / `.fade-in` / `.slide-in-from-top-*` for Tailwind v4 (`.animate-in.fixed > :first-child` adaptive desktop & mobile modal card entrance), added GPU-composited state-preserving tab transitions (`.vlo-view-enter` / `.vlo-view-fade`), added `@layer base` universal tactile `:active` micro-press (`scale: 0.98`) with `data-tactile="none"` opt-out on brand tiles, and replaced plain spinners with `.vlo-skeleton` placeholders.

## v1.2.0 · #VLO-2611-SND01 (2026-11-21)
- **Notification Chimes & Tactile Click System**: Added zero-lag Web Audio API sound engine (`src/utils/soundEngine.ts`) for UI click/touch feedback, trade/toast chimes, macro news alert pings, haptic touch vibration, and On/Off + Test controls in Settings.

## v1.1.2 · #VLO-2611-LGO02 (2026-11-21)
- **60fps VloMech Logo Optimization**: Moved VloMech styles to global CSS with pure GPU-composited `transform`/`opacity` keyframes (eliminating CPU SVG `<mask>` rasterization & `non-scaling-stroke`), stabilized splash timer refs, and deferred heavy background workspace hydration via `startTransition` until splash assembly finishes.

## v1.1.1 · #VLO-2611-LGO01 (2026-11-21)
- **Mechanical Orbital Assembly Logo**: Integrated `VloMech` fluid orbital logo motion into Splash Screen and Auth Modal with app Light & Dark theme synchronization.

## v1.1.0 · #VLO-2611-RSK01 (2026-11-21)
- **Risk Pip/SL Rule Alignment**: Aligned XAUUSD default pip standard (`1 pip = 0.10`, `4000 -> 3995 = 50 pips`) across Risk Management, Broker Settings, and Market Chart.
- **Risk USD & IDR Currency Mode**: Added synchronized `USD ($) | IDR (Rp)` switching, live FX conversion, Rupiah thousand-dot input formatting, quick presets, and cross-currency hints across all Risk calculators, Risk Protection Limits, and Consecutive Loss Simulation.
- **App Version & Change Code System**: Added centralized `src/config/appVersion.ts`, synced `package.json`, displayed `v1.1.0 · #VLO-2611-RSK01` in navigation/settings, and added version history drawer + bump script.

## v1.0.0 · #VLO-2611-ELM01 (2026-11-20)
- Editorial Pure-White Light Mode surface refresh, preserved Dark Mode, and Fundamental Gold narrative module.
