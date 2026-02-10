# 🎰 PIXEL PLAYZONE — Comprehensive UI/UX Audit Report

**Date:** June 2025  
**Auditor:** GitHub Copilot (AI)  
**Scope:** 16 files across `kiu-casino/public/` — all HTML pages, shared JS systems, and CSS  
**App Language:** Vietnamese (`lang="vi"`)

---

## TABLE OF CONTENTS

1. [Executive Summary](#1-executive-summary)
2. [Scoring Methodology](#2-scoring-methodology)
3. [Per-Page Audit](#3-per-page-audit)
4. [Cross-Page Consistency Analysis](#4-cross-page-consistency-analysis)
5. [Issue Registry by Severity](#5-issue-registry-by-severity)
6. [Design Standard Candidates](#6-design-standard-candidates)
7. [Action Plan](#7-action-plan)

---

## 1. Executive Summary

**Pixel PlayZone** is a casino-style web app with 11 pages, 5 shared JS systems, and 2 dedicated CSS files. The visual ambition is high — neon-dark aesthetics, pixel fonts, particle effects, and rich animations. However, **the project suffers from severe cross-page inconsistency** in fonts, colors, layout patterns, and interaction paradigms.

### Key Numbers

| Metric | Value |
|--------|-------|
| Total Issues Found | 68 |
| CRITICAL | 8 |
| HIGH | 19 |
| MEDIUM | 26 |
| LOW | 15 |
| Average Page Score | 6.7 / 10 |
| Best Page | `leaderboard.html` (8.1/10) |
| Worst Page | `flappybird.html` (4.8/10) |

---

## 2. Scoring Methodology

Each page is scored **1–10** on these 10 criteria:

| # | Criterion | Weight | Description |
|---|-----------|--------|-------------|
| 1 | **Visual Consistency** | High | Matches the global design system (colors, fonts, spacing) |
| 2 | **Responsive Design** | High | Works across mobile (≤480px), tablet (≤768px), desktop |
| 3 | **Accessibility** | High | Color contrast, focus states, screen reader basics, `noscript` |
| 4 | **Interaction Design** | Med | Feedback on actions, loading states, error handling |
| 5 | **Animation Quality** | Med | Meaningful motion, `prefers-reduced-motion`, performance |
| 6 | **Code Quality** | Med | DRY CSS, semantic HTML, no inline styles |
| 7 | **Dark Theme Execution** | Med | Proper contrast, no bright flashes, readable text on dark bg |
| 8 | **Modal/Overlay UX** | Low | Proper stacking, close mechanisms, backdrop handling |
| 9 | **Navigation/Wayfinding** | Low | Back buttons, breadcrumbs, active states |
| 10 | **Performance** | Med | Render-blocking resources, asset optimization, DOM weight |

---

## 3. Per-Page Audit

### 3.1 `index.html` (1849 lines) — Main Lobby

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 9 | Defines the design system — source of truth |
| Responsive Design | 7 | Two breakpoints (768px, 400px) but no tablet (1024px) |
| Accessibility | 5 | `cursor: none` on body hides cursor for ALL users; no skip-nav; no aria on game cards |
| Interaction Design | 8 | Login modal, 3D card tilt on hover, scroll reveals |
| Animation Quality | 9 | Particle canvas, scanlines, hex grid, conic-gradient borders — excellent |
| Code Quality | 6 | Inline styles on admin card & transfer card; 1849 lines in one file |
| Dark Theme | 9 | `--bg-primary: #030014`, neon accents on dark — polished |
| Modal/Overlay | 7 | Login modal works but lacks ESC-to-close and focus trap |
| Navigation | 7 | No navbar; game cards link to pages; logo links home |
| Performance | 5 | Canvas particles + hex grid + scanlines + 3D transforms = heavy on low-end |

**Score: 7.2 / 10**

**Key Issues:**
- **[CRITICAL]** `cursor: none` on `body` (line ~70 in `<style>`) — hides system cursor for all users including those using assistive tech. Custom cursor element hidden on mobile but system cursor is still `none`.
- **[HIGH]** No `prefers-reduced-motion` support — canvas particles, scanline overlay, hex grid, and card animations all run unconditionally.
- **[MEDIUM]** Inline styles on game cards (e.g., admin card has `style="border-image:..."` hardcoded) — should use classes.
- **[MEDIUM]** Loading screen (`#ppz-loading`) has no timeout fallback — if JS fails, user sees spinner forever.
- **[LOW]** `<meta name="theme-color" content="#030014">` — correct, sets the standard.

---

### 3.2 `profile.html` (1147 lines) — User Profile

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 8 | Same `--bg: #030014`, `--accent: #8b5cf6`, Orbitron font |
| Responsive Design | 5 | Single breakpoint at 480px — no tablet handling |
| Accessibility | 4 | All content rendered via JS template literals — no server-side fallback; charts are CSS bars with no `aria` |
| Interaction Design | 7 | XP bar animates, stats populate dynamically |
| Animation Quality | 7 | Conic-gradient avatar ring, animated XP bar |
| Code Quality | 5 | Entire page rendered via `innerHTML` template literals — no sanitization |
| Dark Theme | 8 | Good contrast ratios for stat values |
| Modal/Overlay | N/A | No modals on this page |
| Navigation | 6 | Back button exists but is `<a href="/">` not a real back action |
| Performance | 6 | Multiple API calls on load (`/api/me`, `/api/profile/stats`, `/api/achievements`, `/api/leveling/profile`, `/api/stats/chart`) — could be batched |

**Score: 6.2 / 10**

**Key Issues:**
- **[HIGH]** Only one responsive breakpoint (480px) — on tablets (768px) the 3-column grids compress awkwardly.
- **[HIGH]** Template literal rendering with no HTML escaping — XSS vector if usernames contain HTML.
- **[MEDIUM]** Chart bars (`profit-chart`) are pure CSS divs — no tooltip, no axis labels, no screen-reader text.
- **[MEDIUM]** Achievement grid uses hardcoded emoji for icons — inconsistent with game pages that use SVGs.
- **[LOW]** Avatar border uses `conic-gradient` with `@property` rule — no Safari fallback (Safari ≤16.3 doesn't support `@property`).

---

### 3.3 `taixiu.html` (206 lines) + `taixiu.css` (1469 lines) + `taixiu.js` (507 lines)

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 4 | **MAJOR DEVIATION**: Uses `Be Vietnam Pro` font, `#1a0a0a` theme-color, wood/bamboo textures — looks like a completely different app |
| Responsive Design | 7 | CSS handles mobile well with overflow-hidden body |
| Accessibility | 5 | Hammer.js bowl swipe has no keyboard alternative |
| Interaction Design | 9 | Bowl drag physics, dice reveal animation, shake phase, flying coins — excellent haptics with `navigator.vibrate` |
| Animation Quality | 9 | CSS shaking, dice reveal, coin particles, slider sound — premium feel |
| Code Quality | 7 | Clean separation (HTML/CSS/JS in 3 files); sound manager with lazy loading |
| Dark Theme | 6 | Bamboo texture background with dark overlay — different aesthetic but works |
| Modal/Overlay | 6 | Result toast exists but is a basic positioned div, not a true overlay |
| Navigation | 5 | Back button exists; no breadcrumb; no lobby indicator |
| Performance | 7 | Hammer.js is an external dependency (loaded from CDN) |

**Score: 6.5 / 10**

**Key Issues:**
- **[CRITICAL]** `<meta name="theme-color" content="#1a0a0a">` (line 7 of taixiu.html) — different from global `#030014`. PWA task switcher color will be inconsistent.
- **[CRITICAL]** Entirely different font family (`Be Vietnam Pro`) and color system — breaks visual continuity with the rest of the app.
- **[HIGH]** No keyboard alternative for bowl-opening gesture (Hammer.js swipe only) — accessibility gap.
- **[MEDIUM]** `body::after` is defined twice in taixiu.css (line ~52 and ~175) — second declaration overwrites first.
- **[MEDIUM]** Sound manager in taixiu.js partially overlaps with global `sound-system.js` — dual sound systems loaded.
- **[LOW]** Bet slider tick marks are hardcoded percentages — won't adapt if max bet changes.

---

### 3.4 `crash.html` (1740 lines) — Crash Game

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 8 | Uses `--bg: #030014`, `--accent: #7c3aed` (slightly different purple) |
| Responsive Design | 8 | Three breakpoints (768px implicit, 500px, 370px) — good mobile handling |
| Accessibility | 6 | Has `prefers-reduced-motion` support — **only page that does this**; keyboard shortcut (Space) |
| Interaction Design | 9 | Auto-cashout, bet presets, loading states on buttons, realtime multiplayer |
| Animation Quality | 9 | Canvas chart with gradient curve, flash overlays, particle explosions |
| Code Quality | 7 | Well-structured Socket.IO event handling; `requestAnimationFrame` for chart |
| Dark Theme | 8 | Good contrast; history chips color-coded (green/red) on dark bg |
| Modal/Overlay | 7 | No win overlay — results shown inline (good for fast-paced game) |
| Navigation | 7 | Back button, balance display, toolbar |
| Performance | 7 | Canvas-based chart is efficient; history list can grow unbounded |

**Score: 7.6 / 10**

**Key Issues:**
- **[MEDIUM]** `--accent: #7c3aed` differs from global `--accent: #8b5cf6` — subtle but noticeable when switching pages.
- **[MEDIUM]** History list (`#history-list`) has no virtual scrolling — can grow infinitely, causing DOM bloat.
- **[MEDIUM]** Bet presets are hardcoded values (1K, 5K, 10K, 50K, ALL) — should adapt to user balance.
- **[LOW]** `Space` key shortcut is not documented in UI — hidden feature.
- **[LOW]** Flash overlay on crash uses `position:fixed; inset:0` — briefly covers entire viewport including back button.

---

### 3.5 `mines.html` (2293 lines) — Mines Game

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 5 | **DEVIATION**: `--accent: #bc13fe`, `--bg: #0a0015`, `Poppins` font |
| Responsive Design | 6 | No explicit breakpoints in CSS — relies on flex/wrap |
| Accessibility | 5 | Grid cells use click events only — no keyboard navigation between cells |
| Interaction Design | 9 | Tension states (heartbeat, vignette), streak counter, gem pitch shifting via Web Audio API — exceptional game feel |
| Animation Quality | 9 | Ring bursts on reveal, confetti, screen shake on boom, multiplier pop text |
| Code Quality | 8 | IIFE, event delegation on grid, DocumentFragment for grid building, audio pool — excellent JS quality |
| Dark Theme | 7 | `#0a0015` is close to but not the same as `#030014` |
| Modal/Overlay | 7 | Win overlay with proper backdrop; close button returns to setup |
| Navigation | 6 | Back to lobby link; no breadcrumb |
| Performance | 8 | Particle count capped (MAX_PARTICLES = 50), debounced cleanup, reduced confetti (45 vs 90) |

**Score: 7.0 / 10**

**Key Issues:**
- **[HIGH]** Different font (`Poppins`) and accent color (`#bc13fe`) and background (`#0a0015`) — inconsistent with design system.
- **[HIGH]** Mine grid has no keyboard support — can't Tab through cells or use Enter to reveal.
- **[MEDIUM]** `busy` flag prevents double-clicks but there's no visual disabled state on cells during API calls (only shows ⏳ icon).
- **[MEDIUM]** The IIFE uses `const $ = id => document.getElementById(id)` which shadows the common jQuery `$` alias — could cause confusion.
- **[LOW]** `navigator.vibrate` calls fire on every cell reveal — could be annoying on longer sessions.

---

### 3.6 `poker.html` (1326 lines) — Texas Hold'em Poker

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 3 | **MAJOR DEVIATION**: Uses `Cinzel`, `Lora`, `Outfit` fonts; `--royal-purple`, `--felt-green` color system; completely different visual language |
| Responsive Design | 7 | Two breakpoints (768px, 480px); seat positions use absolute positioning — fragile on unusual aspect ratios |
| Accessibility | 4 | No ARIA on seats/cards; no keyboard controls for fold/call/raise actions |
| Interaction Design | 8 | Quick raise presets, slider for bet amount, auto-action system, chat panel |
| Animation Quality | 8 | Avatar pulse, card flip support (perspective/backface), winner glow, gold shimmer text |
| Code Quality | 6 | Inline `onclick` handlers; chat panel CSS is in `<style>` instead of external file |
| Dark Theme | 7 | `#0f0a1a` background (different yet again); green felt table is thematic but breaks dark-neon aesthetic |
| Modal/Overlay | 8 | Win overlay with blur backdrop, proper z-indexing |
| Navigation | 5 | "← LOBBY" button; no game state indicators in nav |
| Performance | 7 | Full-screen layout with `overflow:hidden`; ambient glow is just CSS |

**Score: 6.3 / 10**

**Key Issues:**
- **[CRITICAL]** Entirely different font stack (`Cinzel`, `Lora`, `Outfit`) — looks like a different product. Should use `DearPix` as primary like other pages.
- **[CRITICAL]** Background color `#0f0a1a` and color palette (`--royal-purple`, `--felt-green`, `--gold-*`) diverge completely from the neon design system.
- **[HIGH]** Loading spinner uses `#f59e0b` (amber) for spinner color vs `#00f0ff` (cyan) on other pages — loading experience is inconsistent.
- **[HIGH]** Inline `onclick="doAction('fold')"` etc. — should use event listeners; 7 inline onclick handlers in controls.
- **[MEDIUM]** Chat panel and controls overlap at bottom-left/center on smaller screens — no collision handling.
- **[MEDIUM]** Seat positions are absolute with pixel values — won't adapt to screen aspect ratios beyond 768px/480px breakpoints.
- **[LOW]** Skips `chat-system.js` (has its own table chat) — good design decision but comment says "skip global" without explaining why to future devs.

---

### 3.7 `daily.html` (888 lines) — Daily Rewards

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 6 | Uses `Nunito` font; balance pill uses `#ffe600` instead of `#ffd700`; background gradient differs |
| Responsive Design | 6 | No explicit breakpoints — streak bar wraps naturally but wheel doesn't scale |
| Accessibility | 5 | Spin wheel is canvas-based — no screen reader alternative for prize display |
| Interaction Design | 8 | 7-day streak visualization, spin wheel with physics-based deceleration, confetti on win |
| Animation Quality | 8 | Sparkle particles, CSS spin transition on wheel, confetti burst |
| Code Quality | 6 | Canvas wheel drawing with hardcoded segment colors and prize values |
| Dark Theme | 7 | Background `linear-gradient(160deg, #0a1628, #1a0a2e, #0a1628)` — blue-purple tint (different) |
| Modal/Overlay | 7 | Result popup appears after spin; close button works |
| Navigation | 6 | Back button to lobby |
| Performance | 7 | Canvas is lightweight; particles are CSS-only |

**Score: 6.6 / 10**

**Key Issues:**
- **[HIGH]** Different font (`Nunito`) — fourth distinct Google Font across the app.
- **[MEDIUM]** Balance pill color `#ffe600` differs from global gold `#ffd700` — subtly different yellow.
- **[MEDIUM]** Canvas wheel has hardcoded Vietnamese text in JS — no i18n consideration.
- **[MEDIUM]** No `prefers-reduced-motion` — wheel spin animation and confetti run unconditionally.
- **[LOW]** Background gradient uses different hex values than index.html — `#0a1628` vs `#030014`.

---

### 3.8 `history.html` (526 lines) — Transaction History

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 8 | Orbitron + Rajdhani (same as index); `--bg: #030014`; neon accents |
| Responsive Design | 7 | 480px breakpoint; summary cards go to column layout |
| Accessibility | 6 | Filter buttons have no `aria-pressed` state; list items lack semantic roles |
| Interaction Design | 8 | Filter by type, summary cards update dynamically, load-more pagination, empty state |
| Animation Quality | 5 | Minimal animation — just slide-in for items; functional but plain |
| Code Quality | 7 | Clean fetch logic; proper error handling; empty state message |
| Dark Theme | 8 | Consistent with global palette |
| Modal/Overlay | N/A | No modals |
| Navigation | 7 | Back button; filter buttons serve as sub-navigation |
| Performance | 8 | Paginated loading (load-more button); efficient DOM updates |

**Score: 7.1 / 10**

**Key Issues:**
- **[MEDIUM]** Filter buttons don't indicate active state visually — `aria-pressed` missing.
- **[MEDIUM]** Transaction list items use `div` with class-based styling — should use `<ul>/<li>` or `role="list"`.
- **[LOW]** Summary card values have no animation — contrast with animated balance on other pages.
- **[LOW]** "Load More" button could benefit from infinite scroll for mobile UX.

---

### 3.9 `transfer.html` (976 lines) — Money Transfer

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 8 | Consistent colors and fonts with index/profile |
| Responsive Design | 7 | Handles narrow screens; autocomplete dropdown positions correctly |
| Accessibility | 5 | Missing `<noscript>` fallback — **only page without it**; input labels are visual only |
| Interaction Design | 8 | User search with autocomplete, recipient preview, amount presets, validation errors, success modal |
| Animation Quality | 6 | Success modal has fade-in; flying coins on transfer; otherwise minimal |
| Code Quality | 7 | Good form validation; debounced search; proper error states |
| Dark Theme | 8 | Card-based layout reads well on dark bg |
| Modal/Overlay | 8 | Success modal with confetti, proper close mechanisms |
| Navigation | 7 | Back button; transfer history below form |
| Performance | 7 | Debounced search prevents API spam |

**Score: 7.1 / 10**

**Key Issues:**
- **[CRITICAL]** Missing `<noscript>` tag — every other page has one. If JS is disabled, user sees blank page.
- **[MEDIUM]** Input labels are placeholder-only (`placeholder="Nhập tên người nhận..."`) — no `<label>` elements for form fields.
- **[MEDIUM]** Autocomplete dropdown uses absolute positioning — could overflow viewport on mobile.
- **[LOW]** Amount preset buttons don't visually indicate "selected" state — just changes input value.
- **[LOW]** Transfer history section shares visual patterns with `history.html` but is styled differently — could reuse shared CSS.

---

### 3.10 `flappybird.html` (~180 lines) + `flappybird.css` (354 lines) + `flappybird.js` (462 lines)

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 2 | **MASSIVE DEVIATION**: Sky blue `#70c5ce` theme, cream `#ded895` scoreboard, brown borders — looks like a completely different website |
| Responsive Design | 8 | Canvas resizes dynamically (`resizeCanvas()`); full-viewport game |
| Accessibility | 3 | Canvas-only game with no text alternatives; game-over screen only visible after JS state change |
| Interaction Design | 7 | Tap/click/space to play; restart button; score display |
| Animation Quality | 7 | Sprite-based pixel art animation; bird rotation; pipe scrolling |
| Code Quality | 7 | Clean class-based architecture (Bird, Pipe, Background); anti-cheat token system |
| Dark Theme | 1 | **Completely breaks dark theme** — sky blue background, white text on cream panels |
| Modal/Overlay | 5 | Game-over screen overlays canvas but uses DOM positioning — fragile |
| Navigation | 5 | Back button styled differently from other pages (absolute top-left with blur) |
| Performance | 7 | `requestAnimationFrame` loop; `image-rendering: pixelated` for crisp sprites |

**Score: 4.8 / 10**

**Key Issues:**
- **[CRITICAL]** Sky-blue theme (`#70c5ce`) with cream/brown UI elements — **completely breaks the dark neon aesthetic**. This feels like navigating to a different website.
- **[HIGH]** No `prefers-reduced-motion` — continuous canvas animation with no way to reduce.
- **[HIGH]** Score board uses `background: #ded895` (cream) with brown `#543847` borders — zero consistency with dark theme.
- **[MEDIUM]** Back button (`.back-btn` in flappybird.css) is styled completely differently from `.back-btn` in other pages — same class name, different styles.
- **[MEDIUM]** `sounds/flappy/*.wav` — uses WAV format (large files) while other games use MP3.
- **[LOW]** Loading screen uses the same sky-blue background — no visual transition back to dark theme on exit.
- **[LOW]** New Record badge (`#newRecordBadge`) uses `#ff512f` orange — inconsistent with any other alert/accent color.

---

### 3.11 `leaderboard.html` (1436 lines) — Leaderboard

| Criterion | Score | Notes |
|-----------|-------|-------|
| Visual Consistency | 9 | Uses `--neon-*` variables, `--font-display: 'DearPix', 'Orbitron'`, `--bg: #030014` — **most consistent page** |
| Responsive Design | 7 | 500px breakpoint; podium scales down; tab buttons compress |
| Accessibility | 6 | Tab buttons have visual active states; rank badges have role-appropriate colors |
| Interaction Design | 8 | 3-tab system (Balance/Level/XP), podium with animated bars, my-rank card, refresh button |
| Animation Quality | 9 | Conic-gradient podium rings, trophy bob, gold shimmer text, row slide-in with stagger, coin float particles |
| Code Quality | 8 | CSS custom properties via `@property`, scroll reveal, `escapeHtml()` function for XSS protection |
| Dark Theme | 9 | Deep dark with gold/purple/cyan accents — exactly matches index.html |
| Modal/Overlay | N/A | No modals needed |
| Navigation | 8 | Sticky top bar with back button and balance; tab system for sub-views |
| Performance | 7 | Canvas particle system (60 particles) + floating coins = moderate GPU load |

**Score: 8.1 / 10**

**Key Issues:**
- **[MEDIUM]** Canvas particle system is duplicated from index.html — same code, not shared via a module.
- **[MEDIUM]** Rank role badges inject colors directly in inline `style` attributes — should use CSS classes.
- **[LOW]** `image-rendering: pixelated` is applied to many text elements — good for pixel font aesthetic but may hurt legibility at certain sizes.
- **[LOW]** Floating coins use `position: fixed` with animation — could interfere with live-feed ticker bar at bottom.

---

### 3.12 Shared Systems — `sound-system.js` (246 lines)

| Aspect | Assessment |
|--------|------------|
| Architecture | ✅ Clean IIFE, audio pool pattern, localStorage settings, UI panel |
| Consistency | ✅ Renders into `#ppz-toolbar` on every page; styled with cyan accents |
| Bug | ⚠️ `createSoundPanel._retries` counter retries up to 30 times (3s) — no cleanup on page unload |
| Issue | ⚠️ Pages like taixiu.js have their own `SoundManager` that partially overlaps with `PPZSound` |
| Issue | ⚠️ BGM auto-play requires user gesture — handled via `once: true` click listener, good |

---

### 3.13 Shared Systems — `notify-system.js` (311 lines)

| Aspect | Assessment |
|--------|------------|
| Architecture | ✅ 9 toast types, bell UI with history panel, localStorage persistence |
| Consistency | ✅ Dark theme with purple/cyan accents; renders into toolbar |
| Issue | ⚠️ Max 5 toasts at 4.5s — on fast wins, notifications can queue and delay |
| Issue | ⚠️ History panel dropdown uses `position: fixed; top: 60px` — could overlap with poker top bar |
| Positive | ✅ `balance_update` socket listener updates balance across all pages |

---

### 3.14 Shared Systems — `live-feed.js` (266 lines)

| Aspect | Assessment |
|--------|------------|
| Architecture | ✅ Bottom ticker bar (36px), expandable panel, Socket.IO + REST fallback |
| Consistency | ⚠️ Forces `body { padding-bottom: 36px !important }` on ALL pages — can cause layout issues |
| Issue | **[HIGH]** `!important` on body padding affects poker (full-screen, `overflow:hidden`), flappybird (canvas fills viewport), and taixiu (also full-screen) |
| Issue | ⚠️ Ticker bar z-index could conflict with game controls at bottom of page |
| Positive | ✅ Graceful degradation with REST fallback for initial feed |

---

## 4. Cross-Page Consistency Analysis

### 4.1 Font Chaos

| Page | Primary Google Font | DearPix Used? |
|------|-------------------|---------------|
| index.html | Orbitron + Rajdhani | ✅ |
| profile.html | Orbitron + Rajdhani | ✅ |
| crash.html | Orbitron + Rajdhani | ✅ |
| history.html | Orbitron + Rajdhani | ✅ |
| transfer.html | Orbitron + Rajdhani | ✅ |
| leaderboard.html | Orbitron + Rajdhani | ✅ |
| taixiu.html | **Be Vietnam Pro** ❌ | ✅ |
| mines.html | **Poppins** ❌ | ❌ Missing! |
| poker.html | **Cinzel + Lora + Outfit** ❌ | ✅ (fallback) |
| daily.html | **Nunito** ❌ | ✅ |
| flappybird.html | None (DearPix only) | ✅ |

**Verdict:** 4 out of 11 pages use non-standard fonts. **Mines.html doesn't even load DearPix.**

### 4.2 Background Color Variants

| Page | `--bg` / Background | Expected |
|------|---------------------|----------|
| index.html | `#030014` | ✅ Standard |
| profile.html | `#030014` | ✅ |
| crash.html | `#030014` | ✅ |
| history.html | `#030014` | ✅ |
| transfer.html | `#030014` | ✅ |
| leaderboard.html | `#030014` | ✅ |
| mines.html | **`#0a0015`** | ❌ Different |
| poker.html | **`#0f0a1a`** | ❌ Different |
| daily.html | **gradient with `#0a1628`** | ❌ Different |
| taixiu.html | **`#1a0a0a`** + bamboo texture | ❌ Different |
| flappybird.html | **`#70c5ce`** (sky blue) | ❌❌ Completely different |

### 4.3 Accent Color Variants

| Page | `--accent` / Primary Accent |
|------|-----------------------------|
| index.html | `#8b5cf6` (purple) + `#00f0ff` (cyan) |
| profile.html | `#8b5cf6` + `#00f0ff` | 
| crash.html | **`#7c3aed`** (slightly different purple) |
| mines.html | **`#bc13fe`** (magenta-purple) |
| poker.html | **Gold-based system** (`#ffd700`, `#b8860b`) |
| daily.html | **`#ffe600`** (yellow, not gold) |
| taixiu.html | **Wood/gold** (`#ffd700`, `#b8860b`) |

### 4.4 Loading Screen Consistency

| Page | Spinner Color | BG Color | Text |
|------|--------------|----------|------|
| index.html | CSS-only animation | `#030014` | Pixel font |
| profile.html | `#00f0ff` / `#ff00aa` | `#030014` | "LOADING" |
| crash.html | `#7c3aed` / `#06b6d4` | `#030014` | "LOADING" |
| mines.html | `#a855f7` / `#ec4899` | **`#0a0015`** | "LOADING" |
| poker.html | **`#f59e0b` / `#10b981`** | **`#0f0a1a`** | "LOADING" |
| daily.html | `#00f0ff` / `#ff00aa` | `#030014` | "LOADING" |
| leaderboard.html | `#00f0ff` / `#ff00aa` | `#030014` | "LOADING" |
| history/transfer | `#00f0ff` / `#ff00aa` | `#030014` | "LOADING" |

### 4.5 Shared Script Loading

| Page | socket.io | sound | notify | tutorial | chat | live-feed |
|------|-----------|-------|--------|----------|------|-----------|
| index.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| profile.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| crash.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| mines.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| poker.html | ❌ (loaded in poker.js) | ✅ | ✅ | ✅ | ❌ (own chat) | ✅ |
| daily.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| history.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| transfer.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| leaderboard.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| taixiu.html | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| flappybird.html | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**Flappy Bird loads NONE of the shared systems** — no notifications, no sound panel, no live feed, no chat.

---

## 5. Issue Registry by Severity

### 🔴 CRITICAL (8 issues)

| # | Page | Issue | Location |
|---|------|-------|----------|
| C1 | index.html | `cursor: none` on body hides system cursor for all users | `<style>` body rule |
| C2 | taixiu.html | Different `theme-color` meta (`#1a0a0a`) — PWA inconsistency | line 7 |
| C3 | taixiu.html/css | Entirely different font + color system (Be Vietnam Pro, wood theme) | taixiu.css lines 1-30 |
| C4 | poker.html | Completely different font stack (Cinzel/Lora/Outfit) and color palette | `<style>` :root |
| C5 | flappybird.html | Sky-blue theme breaks dark aesthetic entirely | flappybird.css :root |
| C6 | transfer.html | Missing `<noscript>` fallback — blank page without JS | Entire file |
| C7 | live-feed.js | `body{padding-bottom:36px!important}` forces layout on all pages including full-screen games | live-feed.js line ~22 |
| C8 | mines.html | Loads `Poppins` font but never loads `DearPix` (`css/fonts.css` not linked) | `<head>` |

### 🟠 HIGH (19 issues)

| # | Page | Issue | Location |
|---|------|-------|----------|
| H1 | index.html | No `prefers-reduced-motion` support — heavy animations run unconditionally | Canvas/CSS anims |
| H2 | profile.html | Single responsive breakpoint (480px) — no tablet handling | `<style>` @media |
| H3 | profile.html | Template literal rendering with no HTML escaping — XSS risk | JS section |
| H4 | taixiu.html | No keyboard alternative for bowl swipe gesture | taixiu.js Hammer.js |
| H5 | mines.html | Different font (Poppins), accent (#bc13fe), background (#0a0015) | `<style>` :root |
| H6 | mines.html | Mine grid has no keyboard navigation (Tab/Enter) | gridEl click handler |
| H7 | poker.html | Loading spinner uses amber `#f59e0b` vs cyan `#00f0ff` | `#ppz-loading` |
| H8 | poker.html | 7 inline `onclick` handlers in HTML | controls section |
| H9 | daily.html | Different font (Nunito) — 4th distinct Google Font | `<link>` Google Fonts |
| H10 | flappybird.html | No `prefers-reduced-motion` — continuous canvas animation | flappybird.js loop |
| H11 | flappybird.html | Score board cream/brown theme — zero dark-theme consistency | flappybird.css .score-board |
| H12 | flappybird.html | Loads NONE of the shared systems (sound, notify, chat, feed) | `<script>` tags |
| H13 | live-feed.js | Ticker bar z-index conflicts with game controls at viewport bottom | `.ppz-feed-bar` |
| H14 | Global | Canvas particle system code duplicated between index.html and leaderboard.html | Both files |
| H15 | Global | 5 different Google Font loads across pages = significant render-blocking cost | `<link>` tags |
| H16 | taixiu.js | Dual sound systems — own SoundManager + global PPZSound both loaded | taixiu.js lines 1-60 |
| H17 | poker.html | Chat panel and controls bar overlap on small screens | #chat-panel, #controls-bar |
| H18 | poker.html | Seat positions use absolute px values — fragile on unusual aspect ratios | .seat[data-pos] rules |
| H19 | Global | No shared CSS file — every page reinvents base styles, variables, back buttons | All pages |

### 🟡 MEDIUM (26 issues)

| # | Page | Issue |
|---|------|-------|
| M1 | index.html | Inline styles on game cards (admin, transfer cards) |
| M2 | index.html | Loading screen has no timeout fallback |
| M3 | profile.html | Chart bars are CSS-only — no tooltips, axis labels, or aria |
| M4 | profile.html | Achievement grid uses hardcoded emoji icons |
| M5 | taixiu.css | `body::after` defined twice — second overwrites first |
| M6 | taixiu.js | Sound manager overlaps with global sound-system.js |
| M7 | crash.html | `--accent: #7c3aed` differs from global `#8b5cf6` |
| M8 | crash.html | History list has no virtual scrolling — unbounded DOM growth |
| M9 | crash.html | Bet presets don't adapt to user balance |
| M10 | mines.html | No visual disabled state on cells during API calls |
| M11 | mines.html | `$ = id => getElementById` shadows jQuery `$` alias |
| M12 | poker.html | Chat panel and controls use pixel-based positioning |
| M13 | poker.html | Seat positions via absolute positioning — fragile |
| M14 | daily.html | Balance pill color `#ffe600` ≠ global gold `#ffd700` |
| M15 | daily.html | Canvas wheel has hardcoded Vietnamese text — no i18n |
| M16 | daily.html | No `prefers-reduced-motion` for wheel spin and confetti |
| M17 | history.html | Filter buttons lack `aria-pressed` state |
| M18 | history.html | Transaction items use `div` instead of semantic list elements |
| M19 | transfer.html | No `<label>` elements for form inputs |
| M20 | transfer.html | Autocomplete dropdown could overflow viewport on mobile |
| M21 | flappybird.css | `.back-btn` class styled differently from global `.back-btn` |
| M22 | flappybird.html | Uses WAV audio format (larger) while other games use MP3 |
| M23 | leaderboard.html | Canvas particle code duplicated from index.html |
| M24 | leaderboard.html | Rank badges inject colors via inline `style` |
| M25 | notify-system.js | History panel uses `position:fixed;top:60px` — overlaps poker top bar |
| M26 | Global | No shared base.css or design tokens file |

### 🟢 LOW (15 issues)

| # | Page | Issue |
|---|------|-------|
| L1 | index.html | theme-color meta is correct — sets standard |
| L2 | profile.html | `@property`-based conic gradient — no Safari ≤16.3 fallback |
| L3 | taixiu.html | Bet slider tick marks are hardcoded percentages |
| L4 | crash.html | Space key shortcut not documented in UI |
| L5 | crash.html | Flash overlay briefly covers back button |
| L6 | mines.html | `navigator.vibrate` on every reveal could be annoying |
| L7 | daily.html | Background gradient uses `#0a1628` — different from standard |
| L8 | transfer.html | Amount preset buttons lack "selected" visual state |
| L9 | transfer.html | Transfer history styled differently from history.html |
| L10 | flappybird.html | Loading screen uses sky-blue — no transition to dark on exit |
| L11 | flappybird.html | New Record badge color `#ff512f` is unique/inconsistent |
| L12 | history.html | Summary card values have no counter animation |
| L13 | leaderboard.html | `image-rendering: pixelated` may hurt legibility at some sizes |
| L14 | leaderboard.html | Floating coins may overlap live-feed ticker |
| L15 | Global | Service worker registration has empty `.catch(() => {})` — swallows errors silently |

---

## 6. Design Standard Candidates

Based on this audit, the **recommended design standard pages** are:

### 🥇 `leaderboard.html` — Best Overall (8.1/10)
- Most consistent with the neon-dark design system
- Proper use of CSS custom properties and `@property`
- `escapeHtml()` for XSS protection
- Tab system, podium animation, scroll reveals — all well-executed
- Canvas particles identical to index.html (shared visual language)

### 🥈 `crash.html` — Best Game Page (7.6/10)
- **Only page with `prefers-reduced-motion` support** — this should be the standard for ALL pages
- Clean Socket.IO integration
- Three responsive breakpoints
- Keyboard shortcut (Space)

### 🥉 `index.html` — Visual Standard (7.2/10)
- Defines the color palette, font system, and animation language
- Particle canvas, scanlines, hex grid — the "brand" visual
- Would score higher if not for cursor:none and missing reduced-motion

### Honorable Mention: `transfer.html` (7.1/10)
- Best form UX: debounced search, validation states, success modal
- Clean card-based layout
- Would be perfect if not for missing `<noscript>`

---

## 7. Action Plan

### Phase 1: Critical Fixes (Week 1)

1. **Create `public/css/base.css`** — Extract shared variables, reset, back button, topbar, loading screen into one file loaded by all pages.
2. **Standardize fonts** — Remove Poppins, Nunito, Be Vietnam Pro, Cinzel/Lora/Outfit. Use `'DearPix', 'Orbitron', sans-serif` for display and `'DearPix', 'Rajdhani', sans-serif` for body — everywhere.
3. **Fix `cursor: none`** — Only apply to the custom cursor element, not `body`.
4. **Add `<noscript>` to `transfer.html`**.
5. **Standardize `theme-color`** to `#030014` on all pages.
6. **Fix `live-feed.js`** — Use conditional padding instead of `!important` on body; skip padding for full-screen game pages.
7. **Add `css/fonts.css`** link to `mines.html`.

### Phase 2: Consistency (Week 2)

8. **Unify background colors** — All pages should use `--bg: #030014`.
9. **Unify accent colors** — `--accent: #8b5cf6`, `--accent2: #00f0ff` everywhere.
10. **Standardize loading spinner** — Cyan/magenta gradient spinner on `#030014` background.
11. **Extract canvas particle system** into `public/js/particles.js` — shared by index.html and leaderboard.html.
12. **Retheme Flappy Bird** — Dark background with neon accents; keep pixel sprites but wrap in dark container.
13. **Retheme Poker** — Keep felt-green table but use DearPix font, dark sidebar/controls, neon accents for UI.
14. **Consolidate Tài Xỉu** — Keep wood/bamboo theme for the table area but use standard topbar, fonts, and colors for UI frame.

### Phase 3: Accessibility & Polish (Week 3)

15. **Add `prefers-reduced-motion`** to all pages (copy pattern from crash.html).
16. **Add keyboard navigation** to mines grid (Tab between cells, Enter to reveal).
17. **Add keyboard alternative** for taixiu bowl swipe (Enter key to open).
18. **Add `<label>` elements** to all form inputs (transfer, taixiu bet).
19. **Add `aria-pressed`** to filter/tab buttons (history, leaderboard).
20. **Load shared systems** in flappybird.html (at minimum: sound-system.js, notify-system.js).
21. **Escape HTML** in profile.html template literals.

### Phase 4: Performance (Week 4)

22. **Bundle Google Fonts** — Use a single `<link>` with `family=Orbitron:...|Rajdhani:...` instead of per-page loads.
23. **Add loading timeout** — If `#ppz-loading` is still visible after 8s, show error message.
24. **Virtual scrolling** for crash.html history list and leaderboard rows.
25. **Convert WAV sounds** in flappybird to MP3 for smaller file sizes.
26. **Audit `z-index` stack** — Create a z-index scale document for consistent layering.

---

*End of Report*
