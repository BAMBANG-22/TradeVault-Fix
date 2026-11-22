---
name: "vlo-production-blueprint"
description: >
  Production engineering and UI/UX design skill distilled from Vlo Journal (TradeVault).
  Use when building React + TypeScript + Tailwind v4 web apps, Capacitor Android APKs,
  Supabase Edge Functions, or Gemini AI features to prevent generic AI slop, layout drift,
  silent API timeouts, and web-to-APK breakage.
---

# Vlo Production Engineering & Anti-Slop Skill

This skill captures the exact visual language, UX patterns, full-stack architecture, and reliability rules proven while building and hardening **Vlo Journal**. Apply these rules from Turn 1 on any new project.

---

## 1. Visual Design System & Anti-Slop Rules

### A. Palette & Dual-Theme Discipline
Never hardcode single-theme colors or use `!important` CSS inversion hacks. Declare Tailwind v4 dark mode right below `@import "tailwindcss";`:

```css
@import "tailwindcss";
@custom-variant dark (&:where(.dark, .dark *));
```

Use neutral, low-saturation surfaces with one restrained interactive accent:
- **Canvas**: `#F5F7FA` (light) / `#050607`–`#080A0E` (dark)
- **Primary Surface / Modals**: `#FFFFFF` (light) / `#0B0D11` or `#101318` (dark)
- **Elevated Inset / Secondary Buttons**: `#F5F7FA` or `#EEF2F6` (light) / `#12161D` or `#151921` (dark)
- **Hairline Borders**: `#DDE3EA` (light) / `#1E232B` or `#252B34` (dark)
- **Text Hierarchy**: `#151D2A` / `#697586` (light) and `#F2F4F7` / `#929BA9` (dark)
- **Brand Interactive Accent**: `#1769E8` (light) / `#3478DC` (dark)
- **Semantic Numbers (Text Only, No Neon Glow)**:
  - Positive / Profit / BUY: `#059669` (light) / `#00A878` (dark)
  - Negative / Loss / SELL: `#E11D48` (light) / `#E05260` (dark)
  - Warning / Duplicate / Caution: `#D97706` (light) / `#F59E0B` (dark)

### B. Banned AI Slop Patterns
1. **No Card-in-Card Nesting**: Never stack `rounded-2xl border` cards inside another bordered container. Separate sections inside modals and panels using `divide-y divide-[#DDE3EA] dark:divide-[#1E232B]`.
2. **No Pill Soup**: Never wrap static metadata (dates, sessions, IDs, counts, statuses) in colored rounded pill boxes. Render metadata as clean inline text separated by middle dots (`·`), e.g. `London · 14:22 · #123456`.
3. **No Dashed Dropzone Boxes**: Use clean neutral surfaces (`rounded-2xl bg-[#F5F7FA] dark:bg-[#12161D] border border-[#DDE3EA] dark:border-[#1E232B]`) instead of `border-2 border-dashed` upload zones.
4. **No Fake Chrome or Telemetry Clutter**:
   - Do not place AI model/engine tags (e.g. `AI: gemini-...`) or fake latency indicators in modal footers.
   - Do not put decorative icon bubbles next to modal headers (`TradeForm` style: clean title `text-[15px] font-bold` + optional inline `· STATUS` + `X` button).
   - Do not add `border-l-4` colored callout bars, purple gradients, or pulsing status dots (`animate-pulse`) on static UI.
5. **No Truncated Financial Figures**: Apply `tabular-nums` (`font-variant-numeric: tabular-nums`) on all numbers, prices, P/L, and timestamps. Never apply `truncate` to primary KPI values or minus signs.

### C. Modal & Form Pattern ("Single Seamless Bubble")
Match secondary utility modals to the app's primary form (`TradeForm` pattern):
- **Shell**: `rounded-[28px] border border-[#DDE3EA] dark:border-[#1E232B] bg-white dark:bg-[#0B0D11] shadow-[0_24px_64px_rgba(15,23,42,0.18)] dark:shadow-[0_24px_64px_rgba(0,0,0,0.85)]`
- **Inputs**: Use transparent underline/borderless inputs (`bg-transparent border-b border-[#DDE3EA] dark:border-[#1E232B] pb-1 text-xs font-bold tabular-nums focus:outline-none`) rather than chunky rounded input boxes everywhere.
- **Segmented Controls**: Small monochrome pill track (`rounded-full bg-[#F5F7FA] dark:bg-[#12161D] p-0.5 border`) with neutral elevated active button (`bg-white dark:bg-[#202631]`), never loud neon switches.
- **Buttons**: Consistent `rounded-full` primary/secondary action buttons (`py-2.5 text-xs`), `whitespace-nowrap shrink-0`, with a 50/50 split footer (`Cancel` + `Save`) and `Escape` key dismissal.

---

## 2. UX & Information Architecture Rules

1. **Progressive Disclosure (2-Layer Depth)**: Keep primary views & popups scannable (core fields first; slide-up or expandable detail sections for secondary inputs). For complex analytics (macro news, cycles, risk), always lead with a concise **3-step human Playbook / Summary** before dense tables.
2. **Single-Entry-Point Placement**: Place specialized tools strictly inside the workflow toolbar where the user needs them (e.g., `Scan MT5` belongs only in the Journal toolbar, not duplicated across Dashboard or unrelated forms).
3. **Human Microcopy & Safe Defaults**: Prefer plain, action-oriented language (`Catat dari Riwayat MT5`, `Simpan`, `Batal`) over technical jargon. Ensure every interactive filter, button, and empty/error state is genuinely wired.

---

## 3. Gemini AI & Vision Reliability Rules

1. **Server-Side Proxy Only**: Never call Gemini from browser/APK client code or expose API keys in `VITE_*` env vars. Route through `/api/*` (`server.ts` and `supabase/functions/<slug>/index.ts`).
2. **Domain Key Isolation**: Keep independent quotas separate (e.g., `GEMINI_API_KEY` for OCR/Vision scanning, `GEMINI_NEWS_API_KEY` for macro/news analysis).
3. **Model & Latency Configuration (`@google/genai`)**:
   - Primary: `'gemini-4-hydrogen'` (with `thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }` for structured OCR/extraction so multi-row screenshots finish in ~6–10s instead of timing out).
   - Fallback: `'gemini-3.1-flash-lite'`.
   - **NEVER** pass `temperature`, `topP`, `topK`, or `thinkingBudget` to `gemini-4-hydrogen`.
   - Include `httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }`.
4. **Vision OCR Hardening**:
   - Preserve portrait screenshot sharpness (`compressAndResizeImage(file, 2000, 4200, 0.92)` instead of `1800x1800` which blurs tall mobile screenshots).
   - Client timeout $\ge 65000\text{ms}$ for multi-row vision requests.
   - Sanitize literal `"null"`, `"undefined"`, `"none"`, `"n/a"` strings returned by JSON schema fields.
   - Include regex object recovery when a large `"trades": [...]` JSON response truncates.
   - **Never Swallow Real Errors**: When an API call throws or times out, surface the real error banner rather than falling back to a misleading "0 items detected" message.

---

## 4. Web + Capacitor Android APK + Supabase Edge Parity

1. **Unified API Routing (`apiConfig.ts`)**:
   - Maintain a strict `SUPABASE_EDGE_SUPPORTED_PATHS` set so native Capacitor APKs automatically route `/api/*` calls to `https://<project>.supabase.co/functions/v1/<slug>/api/*` with `apikey` & `Authorization: Bearer <anonKey>`.
   - Use `CapacitorHttp.post` / `CapacitorHttp.get` inside native APKs (`Capacitor.isNativePlatform()`) to bypass Android WebView CORS restrictions.
   - Whenever adding a route to `server.ts`, immediately mirror it to `supabase/functions/<slug>/index.ts` and register it in `SUPABASE_EDGE_SUPPORTED_PATHS`.
2. **Non-Interactive CI/CD Automation (`.github/workflows/`)**:
   - Auto-deploy Supabase Edge Functions on push with `supabase/setup-cli@v1`:
     ```bash
     supabase functions deploy <slug> --project-ref "$PROJECT_REF" --no-verify-jwt --yes
     ```
     *(Always include `--yes` so non-interactive CI runners do not abort asking for terminal confirmation.)*
   - Check `SUPABASE_ACCESS_TOKEN` in a preflight step so builds gracefully skip rather than turning red when secrets aren't configured yet.
   - Build Capacitor Android APKs (`bun run build && npx cap sync android && ./gradlew assembleDebug`) with persistent keystore verification.
3. **Never Commit Secrets**: Keep `.env*` in `.gitignore` (except `.env.example`), never embed PAT tokens in `.git/config` (`http.extraheader` only for transient CLI auth), and clean temporary files before finishing.

---

## 5. Pre-Flight Verification Checklist

Before concluding any build or feature task:
- [ ] Run `npm run build` (`vite build`) and `npm run lint` (`tsc --noEmit`) with zero errors.
- [ ] Verify both Light and Dark mode tokens across every new modal, input, `<select>`, and `datetime-local` field.
- [ ] Test new `/api/*` endpoints directly with realistic payloads (e.g., tall portrait & localized screenshots) and remove temp fixtures afterward.
- [ ] Confirm `server.ts`, `supabase/functions/.../index.ts`, and `SUPABASE_EDGE_SUPPORTED_PATHS` are 100% in sync if the app targets Android APK.
- [ ] Restart dev server after any `server.ts` modification before live testing.
