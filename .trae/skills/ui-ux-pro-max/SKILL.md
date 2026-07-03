---
name: ui-ux-pro-max
description: "UI/UX design intelligence for web and mobile. 67 UI styles, 161 color palettes, 57 font pairings, 161 product types with reasoning rules, 99 UX guidelines, and 25 chart types. Invoke when designing new pages, choosing colors/typography, reviewing UI for UX issues, implementing dark mode, or when UI looks unprofessional and you need design guidance."
---

# UI/UX Pro Max - Design Intelligence

Comprehensive design guide for web and mobile applications. Contains 67 styles, 161 color palettes, 57 font pairings, 161 product types with reasoning rules, 99 UX guidelines, and 25 chart types across 22 technology stacks.

## When to Apply

This Skill should be used when the task involves **UI structure, visual design decisions, interaction patterns, or user experience quality control**.

### Must Use

- Designing new pages (Landing Page, Dashboard, Admin, SaaS, Mobile App)
- Creating or refactoring UI components (buttons, modals, forms, tables, charts, etc.)
- Choosing color schemes, typography systems, spacing standards, or layout systems
- Reviewing UI code for user experience, accessibility, or visual consistency
- Implementing navigation structures, animations, or responsive behavior
- Making product-level design decisions (style, information hierarchy, brand expression)
- Improving perceived quality, clarity, or usability of interfaces

### Recommended

- UI looks "not professional enough" but the reason is unclear
- Receiving feedback on usability or experience
- Pre-launch UI quality optimization
- Aligning cross-platform design (Web / iOS / Android)
- Building design systems or reusable component libraries

### Skip

- Pure backend logic development
- Only involving API or database design
- Performance optimization unrelated to the interface
- Infrastructure or DevOps work
- Non-visual scripts or automation tasks

**Decision criteria**: If the task will change how a feature **looks, feels, moves, or is interacted with**, this Skill should be used.

## Rule Categories by Priority

| Priority | Category | Impact | Key Checks (Must Have) | Anti-Patterns (Avoid) |
|----------|----------|--------|------------------------|------------------------|
| 1 | Accessibility | CRITICAL | Contrast 4.5:1, Alt text, Keyboard nav, Aria-labels | Removing focus rings, Icon-only buttons without labels |
| 2 | Touch & Interaction | CRITICAL | Min size 44x44px, 8px+ spacing, Loading feedback | Reliance on hover only, Instant state changes (0ms) |
| 3 | Performance | HIGH | WebP/AVIF, Lazy loading, Reserve space (CLS < 0.1) | Layout thrashing, Cumulative Layout Shift |
| 4 | Style Selection | HIGH | Match product type, Consistency, SVG icons (no emoji) | Mixing flat & skeuomorphic randomly, Emoji as icons |
| 5 | Layout & Responsive | HIGH | Mobile-first breakpoints, Viewport meta, No horizontal scroll | Horizontal scroll, Fixed px container widths, Disable zoom |
| 6 | Typography & Color | MEDIUM | Base 16px, Line-height 1.5, Semantic color tokens | Text < 12px body, Gray-on-gray, Raw hex in components |
| 7 | Animation | MEDIUM | Duration 150-300ms, Motion conveys meaning, Spatial continuity | Decorative-only animation, Animating width/height, No reduced-motion |
| 8 | Forms & Feedback | MEDIUM | Visible labels, Error near field, Helper text, Progressive disclosure | Placeholder-only label, Errors only at top, Overwhelm upfront |
| 9 | Navigation Patterns | HIGH | Predictable back, Bottom nav <=5, Deep linking | Overloaded nav, Broken back behavior, No deep links |
| 10 | Charts & Data | LOW | Legends, Tooltips, Accessible colors | Relying on color alone to convey meaning |

## Quick Reference

### 1. Accessibility (CRITICAL)

- `color-contrast` - Minimum 4.5:1 ratio for normal text (large text 3:1); Material Design
- `focus-states` - Visible focus rings on interactive elements (2-4px; Apple HIG, MD)
- `alt-text` - Descriptive alt text for meaningful images
- `aria-labels` - aria-label for icon-only buttons; accessibilityLabel in native (Apple HIG)
- `keyboard-nav` - Tab order matches visual order; full keyboard support (Apple HIG)
- `form-labels` - Use label with for attribute
- `skip-links` - Skip to main content for keyboard users
- `heading-hierarchy` - Sequential h1->h6, no level skip
- `color-not-only` - Don't convey info by color alone (add icon/text)
- `dynamic-type` - Support system text scaling; avoid truncation as text grows (Apple Dynamic Type, MD)
- `reduced-motion` - Respect prefers-reduced-motion; reduce/disable animations when requested (Apple Reduced Motion API, MD)
- `voiceover-sr` - Meaningful accessibilityLabel/accessibilityHint; logical reading order for VoiceOver/screen readers (Apple HIG, MD)
- `escape-routes` - Provide cancel/back in modals and multi-step flows (Apple HIG)
- `keyboard-shortcuts` - Preserve system and a11y shortcuts; offer keyboard alternatives for drag-and-drop (Apple HIG)

### 2. Touch & Interaction (CRITICAL)

- `touch-target-size` - Min 44x44pt (Apple) / 48x48dp (Material); extend hit area beyond visual bounds if needed
- `touch-spacing` - Minimum 8px/8dp gap between touch targets (Apple HIG, MD)
- `hover-vs-tap` - Use click/tap for primary interactions; don't rely on hover alone
- `loading-buttons` - Disable button during async operations; show spinner or progress
- `error-feedback` - Clear error messages near problem
- `cursor-pointer` - Add cursor-pointer to clickable elements (Web)
- `gesture-conflicts` - Avoid horizontal swipe on main content; prefer vertical scroll
- `tap-delay` - Use touch-action: manipulation to reduce 300ms delay (Web)
- `standard-gestures` - Use platform standard gestures consistently; don't redefine (e.g. swipe-back, pinch-zoom) (Apple HIG)
- `system-gestures` - Don't block system gestures (Control Center, back swipe, etc.) (Apple HIG)
- `press-feedback` - Visual feedback on press (ripple/highlight; MD state layers)
- `haptic-feedback` - Use haptic for confirmations and important actions; avoid overuse (Apple HIG)
- `gesture-alternative` - Don't rely on gesture-only interactions; always provide visible controls for critical actions
- `safe-area-awareness` - Keep primary touch targets away from notch, Dynamic Island, gesture bar and screen edges
- `no-precision-required` - Avoid requiring pixel-perfect taps on small icons or thin edges
- `swipe-clarity` - Swipe actions must show clear affordance or hint (chevron, label, tutorial)
- `drag-threshold` - Use a movement threshold before starting drag to avoid accidental drags

### 3. Performance (HIGH)

- `image-optimization` - Use WebP/AVIF, responsive images (srcset/sizes), lazy load non-critical assets
- `image-dimension` - Declare width/height or use aspect-ratio to prevent layout shift (Core Web Vitals: CLS)
- `font-loading` - Use font-display: swap/optional to avoid invisible text (FOIT); reserve space to reduce layout shift (MD)
- `font-preload` - Preload only critical fonts; avoid overusing preload on every variant
- `critical-css` - Prioritize above-the-fold CSS (inline critical CSS or early-loaded stylesheet)
- `lazy-loading` - Lazy load non-hero components via dynamic import / route-level splitting
- `bundle-splitting` - Split code by route/feature (React Suspense / Next.js dynamic) to reduce initial load and TTI
- `third-party-scripts` - Load third-party scripts async/defer; audit and remove unnecessary ones (MD)
- `reduce-reflows` - Avoid frequent layout reads/writes; batch DOM reads then writes
- `content-jumping` - Reserve space for async content to avoid layout jumps (Core Web Vitals: CLS)
- `lazy-load-below-fold` - Use loading="lazy" for below-the-fold images and heavy media
- `virtualize-lists` - Virtualize lists with 50+ items to improve memory efficiency and scroll performance
- `main-thread-budget` - Keep per-frame work under ~16ms for 60fps; move heavy tasks off main thread (HIG, MD)
- `progressive-loading` - Use skeleton screens / shimmer instead of long blocking spinners for >1s operations (Apple HIG)
- `input-latency` - Keep input latency under ~100ms for taps/scrolls (Material responsiveness standard)
- `tap-feedback-speed` - Provide visual feedback within 100ms of tap (Apple HIG)
- `debounce-throttle` - Use debounce/throttle for high-frequency events (scroll, resize, input)
- `offline-support` - Provide offline state messaging and basic fallback (PWA / mobile)
- `network-fallback` - Offer degraded modes for slow networks (lower-res images, fewer animations)

### 4. Style Selection (HIGH)

- `style-match` - Match style to product type (use the Design System Generation workflow below)
- `consistency` - Use same style across all pages
- `no-emoji-icons` - Use SVG icons (Heroicons, Lucide), not emojis
- `color-palette-from-product` - Choose palette from product/industry (see Color Palettes reference)
- `effects-match-style` - Shadows, blur, radius aligned with chosen style (glass / flat / clay etc.)
- `platform-adaptive` - Respect platform idioms (iOS HIG vs Material): navigation, controls, typography, motion
- `state-clarity` - Make hover/pressed/disabled states visually distinct while staying on-style (Material state layers)
- `elevation-consistent` - Use a consistent elevation/shadow scale for cards, sheets, modals; avoid random shadow values
- `dark-mode-pairing` - Design light/dark variants together to keep brand, contrast, and style consistent
- `icon-style-consistent` - Use one icon set/visual language (stroke width, corner radius) across the product
- `system-controls` - Prefer native/system controls over fully custom ones; only customize when branding requires it (Apple HIG)
- `blur-purpose` - Use blur to indicate background dismissal (modals, sheets), not as decoration (Apple HIG)
- `primary-action` - Each screen should have only one primary CTA; secondary actions visually subordinate (Apple HIG)

### 5. Layout & Responsive (HIGH)

- `viewport-meta` - width=device-width initial-scale=1 (never disable zoom)
- `mobile-first` - Design mobile-first, then scale up to tablet and desktop
- `breakpoint-consistency` - Use systematic breakpoints (e.g. 375 / 768 / 1024 / 1440)
- `readable-font-size` - Minimum 16px body text on mobile (avoids iOS auto-zoom)
- `line-length-control` - Mobile 35-60 chars per line; desktop 60-75 chars
- `horizontal-scroll` - No horizontal scroll on mobile; ensure content fits viewport width
- `spacing-scale` - Use 4pt/8dp incremental spacing system (Material Design)
- `touch-density` - Keep component spacing comfortable for touch: not cramped, not causing mis-taps
- `container-width` - Consistent max-width on desktop (max-w-6xl / 7xl)
- `z-index-management` - Define layered z-index scale (e.g. 0 / 10 / 20 / 40 / 100 / 1000)
- `fixed-element-offset` - Fixed navbar/bottom bar must reserve safe padding for underlying content
- `scroll-behavior` - Avoid nested scroll regions that interfere with the main scroll experience
- `viewport-units` - Prefer min-h-dvh over 100vh on mobile
- `orientation-support` - Keep layout readable and operable in landscape mode
- `content-priority` - Show core content first on mobile; fold or hide secondary content
- `visual-hierarchy` - Establish hierarchy via size, spacing, contrast -- not color alone

### 6. Typography & Color (MEDIUM)

- `line-height` - Use 1.5-1.75 for body text
- `line-length` - Limit to 65-75 characters per line
- `font-pairing` - Match heading/body font personalities
- `font-scale` - Consistent type scale (e.g. 12 14 16 18 24 32)
- `contrast-readability` - Darker text on light backgrounds (e.g. slate-900 on white)
- `text-styles-system` - Use platform type system: iOS 11 Dynamic Type styles / Material 5 type roles (display, headline, title, body, label) (HIG, MD)
- `weight-hierarchy` - Use font-weight to reinforce hierarchy: Bold headings (600-700), Regular body (400), Medium labels (500) (MD)
- `color-semantic` - Define semantic color tokens (primary, secondary, error, surface, on-surface) not raw hex in components (Material color system)
- `color-dark-mode` - Dark mode uses desaturated / lighter tonal variants, not inverted colors; test contrast separately (HIG, MD)
- `color-accessible-pairs` - Foreground/background pairs must meet 4.5:1 (AA) or 7:1 (AAA); use tools to verify (WCAG, MD)
- `color-not-decorative-only` - Functional color (error red, success green) must include icon/text; avoid color-only meaning (HIG, MD)
- `truncation-strategy` - Prefer wrapping over truncation; when truncating use ellipsis and provide full text via tooltip/expand (Apple HIG)
- `letter-spacing` - Respect default letter-spacing per platform; avoid tight tracking on body text (HIG, MD)
- `number-tabular` - Use tabular/monospaced figures for data columns, prices, and timers to prevent layout shift
- `whitespace-balance` - Use whitespace intentionally to group related items and separate sections; avoid visual clutter (Apple HIG)

### 7. Animation (MEDIUM)

- `duration-timing` - Use 150-300ms for micro-interactions; complex transitions <=400ms; avoid >500ms (MD)
- `transform-performance` - Use transform/opacity only; avoid animating width/height/top/left
- `loading-states` - Show skeleton or progress indicator when loading exceeds 300ms
- `excessive-motion` - Animate 1-2 key elements per view max
- `easing` - Use ease-out for entering, ease-in for exiting; avoid linear for UI transitions
- `motion-meaning` - Every animation must express a cause-effect relationship, not just be decorative (Apple HIG)
- `state-transition` - State changes (hover / active / expanded / collapsed / modal) should animate smoothly, not snap
- `continuity` - Page/screen transitions should maintain spatial continuity (shared element, directional slide) (Apple HIG)
- `parallax-subtle` - Use parallax sparingly; must respect reduced-motion and not cause disorientation (Apple HIG)
- `spring-physics` - Prefer spring/physics-based curves over linear or cubic-bezier for natural feel (Apple HIG fluid animations)
- `exit-faster-than-enter` - Exit animations shorter than enter (~60-70% of enter duration) to feel responsive (MD motion)
- `stagger-sequence` - Stagger list/grid item entrance by 30-50ms per item; avoid all-at-once or too-slow reveals (MD)
- `shared-element-transition` - Use shared element / hero transitions for visual continuity between screens (MD, HIG)
- `interruptible` - Animations must be interruptible; user tap/gesture cancels in-progress animation immediately (Apple HIG)
- `no-blocking-animation` - Never block user input during an animation; UI must stay interactive (Apple HIG)
- `fade-crossfade` - Use crossfade for content replacement within the same container (MD)
- `scale-feedback` - Subtle scale (0.95-1.05) on press for tappable cards/buttons; restore on release (HIG, MD)
- `gesture-feedback` - Drag, swipe, and pinch must provide real-time visual response tracking the finger (MD Motion)
- `hierarchy-motion` - Use translate/scale direction to express hierarchy: enter from below = deeper, exit upward = back (MD)
- `motion-consistency` - Unify duration/easing tokens globally; all animations share the same rhythm and feel
- `opacity-threshold` - Fading elements should not linger below opacity 0.2; either fade fully or remain visible
- `modal-motion` - Modals/sheets should animate from their trigger source (scale+fade or slide-in) for spatial context (HIG, MD)
- `navigation-direction` - Forward navigation animates left/up; backward animates right/down -- keep direction logically consistent (HIG)
- `layout-shift-avoid` - Animations must not cause layout reflow or CLS; use transform for position changes

### 8. Forms & Feedback (MEDIUM)

- `input-labels` - Visible label per input (not placeholder-only)
- `error-placement` - Show error below the related field
- `submit-feedback` - Loading then success/error state on submit
- `required-indicators` - Mark required fields (e.g. asterisk)
- `empty-states` - Helpful message and action when no content
- `toast-dismiss` - Auto-dismiss toasts in 3-5s
- `confirmation-dialogs` - Confirm before destructive actions
- `input-helper-text` - Provide persistent helper text below complex inputs, not just placeholder (Material Design)
- `disabled-states` - Disabled elements use reduced opacity (0.38-0.5) + cursor change + semantic attribute (MD)
- `progressive-disclosure` - Reveal complex options progressively; don't overwhelm users upfront (Apple HIG)
- `inline-validation` - Validate on blur (not keystroke); show error only after user finishes input (MD)
- `input-type-keyboard` - Use semantic input types (email, tel, number) to trigger the correct mobile keyboard (HIG, MD)
- `password-toggle` - Provide show/hide toggle for password fields (MD)
- `autofill-support` - Use autocomplete / textContentType attributes so the system can autofill (HIG, MD)
- `undo-support` - Allow undo for destructive or bulk actions (e.g. "Undo delete" toast) (Apple HIG)
- `success-feedback` - Confirm completed actions with brief visual feedback (checkmark, toast, color flash) (MD)
- `error-recovery` - Error messages must include a clear recovery path (retry, edit, help link) (HIG, MD)
- `multi-step-progress` - Multi-step flows show step indicator or progress bar; allow back navigation (MD)
- `form-autosave` - Long forms should auto-save drafts to prevent data loss on accidental dismissal (Apple HIG)
- `sheet-dismiss-confirm` - Confirm before dismissing a sheet/modal with unsaved changes (Apple HIG)
- `error-clarity` - Error messages must state cause + how to fix (not just "Invalid input") (HIG, MD)
- `field-grouping` - Group related fields logically (fieldset/legend or visual grouping) (MD)
- `read-only-distinction` - Read-only state should be visually and semantically different from disabled (MD)
- `focus-management` - After submit error, auto-focus the first invalid field (WCAG, MD)
- `error-summary` - For multiple errors, show summary at top with anchor links to each field (WCAG)
- `touch-friendly-input` - Mobile input height >=44px to meet touch target requirements (Apple HIG)
- `destructive-emphasis` - Destructive actions use semantic danger color (red) and are visually separated from primary actions (HIG, MD)
- `toast-accessibility` - Toasts must not steal focus; use aria-live="polite" for screen reader announcement (WCAG)
- `aria-live-errors` - Form errors use aria-live region or role="alert" to notify screen readers (WCAG)
- `contrast-feedback` - Error and success state colors must meet 4.5:1 contrast ratio (WCAG, MD)
- `timeout-feedback` - Request timeout must show clear feedback with retry option (MD)

### 9. Navigation Patterns (HIGH)

- `bottom-nav-limit` - Bottom navigation max 5 items; use labels with icons (Material Design)
- `drawer-usage` - Use drawer/sidebar for secondary navigation, not primary actions (Material Design)
- `back-behavior` - Back navigation must be predictable and consistent; preserve scroll/state (Apple HIG, MD)
- `deep-linking` - All key screens must be reachable via deep link / URL for sharing and notifications (Apple HIG, MD)
- `tab-bar-ios` - iOS: use bottom Tab Bar for top-level navigation (Apple HIG)
- `top-app-bar-android` - Android: use Top App Bar with navigation icon for primary structure (Material Design)
- `nav-label-icon` - Navigation items must have both icon and text label; icon-only nav harms discoverability (MD)
- `nav-state-active` - Current location must be visually highlighted (color, weight, indicator) in navigation (HIG, MD)
- `nav-hierarchy` - Primary nav (tabs/bottom bar) vs secondary nav (drawer/settings) must be clearly separated (MD)
- `modal-escape` - Modals and sheets must offer a clear close/dismiss affordance; swipe-down to dismiss on mobile (Apple HIG)
- `search-accessible` - Search must be easily reachable (top bar or tab); provide recent/suggested queries (MD)
- `breadcrumb-web` - Web: use breadcrumbs for 3+ level deep hierarchies to aid orientation (MD)
- `state-preservation` - Navigating back must restore previous scroll position, filter state, and input (HIG, MD)
- `gesture-nav-support` - Support system gesture navigation (iOS swipe-back, Android predictive back) without conflict (HIG, MD)
- `tab-badge` - Use badges on nav items sparingly to indicate unread/pending; clear after user visits (HIG, MD)
- `overflow-menu` - When actions exceed available space, use overflow/more menu instead of cramming (MD)
- `bottom-nav-top-level` - Bottom nav is for top-level screens only; never nest sub-navigation inside it (MD)
- `adaptive-navigation` - Large screens (>=1024px) prefer sidebar; small screens use bottom/top nav (Material Adaptive)
- `back-stack-integrity` - Never silently reset the navigation stack or unexpectedly jump to home (HIG, MD)
- `navigation-consistency` - Navigation placement must stay the same across all pages; don't change by page type
- `avoid-mixed-patterns` - Don't mix Tab + Sidebar + Bottom Nav at the same hierarchy level
- `modal-vs-navigation` - Modals must not be used for primary navigation flows; they break the user's path (HIG)
- `focus-on-route-change` - After page transition, move focus to main content region for screen reader users (WCAG)
- `persistent-nav` - Core navigation must remain reachable from deep pages; don't hide it entirely in sub-flows (HIG, MD)
- `destructive-nav-separation` - Dangerous actions (delete account, logout) must be visually and spatially separated from normal nav items (HIG, MD)
- `empty-nav-state` - When a nav destination is unavailable, explain why instead of silently hiding it (MD)

### 10. Charts & Data (LOW)

- `chart-type` - Match chart type to data type (trend -> line, comparison -> bar, proportion -> pie/donut)
- `color-guidance` - Use accessible color palettes; avoid red/green only pairs for colorblind users (WCAG, MD)
- `data-table` - Provide table alternative for accessibility; charts alone are not screen-reader friendly (WCAG)
- `pattern-texture` - Supplement color with patterns, textures, or shapes so data is distinguishable without color (WCAG, MD)
- `legend-visible` - Always show legend; position near the chart, not detached below a scroll fold (MD)
- `tooltip-on-interact` - Provide tooltips/data labels on hover (Web) or tap (mobile) showing exact values (HIG, MD)
- `axis-labels` - Label axes with units and readable scale; avoid truncated or rotated labels on mobile
- `responsive-chart` - Charts must reflow or simplify on small screens (e.g. horizontal bar instead of vertical, fewer ticks)
- `empty-data-state` - Show meaningful empty state when no data exists ("No data yet" + guidance), not a blank chart (MD)
- `loading-chart` - Use skeleton or shimmer placeholder while chart data loads; don't show an empty axis frame
- `animation-optional` - Chart entrance animations must respect prefers-reduced-motion; data should be readable immediately (HIG)
- `large-dataset` - For 1000+ data points, aggregate or sample; provide drill-down for detail instead of rendering all (MD)
- `number-formatting` - Use locale-aware formatting for numbers, dates, currencies on axes and labels (HIG, MD)
- `touch-target-chart` - Interactive chart elements (points, segments) must have >=44pt tap area or expand on touch (Apple HIG)
- `no-pie-overuse` - Avoid pie/donut for >5 categories; switch to bar chart for clarity
- `contrast-data` - Data lines/bars vs background >=3:1; data text labels >=4.5:1 (WCAG)
- `legend-interactive` - Legends should be clickable to toggle series visibility (MD)
- `direct-labeling` - For small datasets, label values directly on the chart to reduce eye travel
- `tooltip-keyboard` - Tooltip content must be keyboard-reachable and not rely on hover alone (WCAG)
- `sortable-table` - Data tables must support sorting with aria-sort indicating current sort state (WCAG)
- `axis-readability` - Axis ticks must not be cramped; maintain readable spacing, auto-skip on small screens
- `data-density` - Limit information density per chart to avoid cognitive overload; split into multiple charts if needed
- `trend-emphasis` - Emphasize data trends over decoration; avoid heavy gradients/shadows that obscure the data
- `gridline-subtle` - Grid lines should be low-contrast (e.g. gray-200) so they don't compete with data
- `focusable-elements` - Interactive chart elements (points, bars, slices) must be keyboard-navigable (WCAG)
- `screen-reader-summary` - Provide a text summary or aria-label describing the chart's key insight for screen readers (WCAG)
- `error-state-chart` - Data load failure must show error message with retry action, not a broken/empty chart
- `export-option` - For data-heavy products, offer CSV/image export of chart data
- `drill-down-consistency` - Drill-down interactions must maintain a clear back-path and hierarchy breadcrumb
- `time-scale-clarity` - Time series charts must clearly label time granularity (day/week/month) and allow switching

---

## Design System Generation Workflow

When the user asks to build a UI (page, dashboard, component, etc.), follow this workflow to generate a complete design system:

### Step 1: Analyze User Requirements

Extract key information from the user's request:
- **Product type**: SaaS, e-commerce, healthcare, gaming, fintech, portfolio, social media, etc.
- **Target audience**: Consumer, enterprise, developers, creative professionals, etc.
- **Style keywords**: minimal, playful, dark, premium, bold, professional, etc.
- **Platform**: Web (React/Vue/Next.js/Tailwind), iOS (SwiftUI), Android (Jetpack Compose), etc.

### Step 2: Generate Complete Design System

Based on the analysis, output a structured design system recommendation covering:

1. **Landing Page Pattern**: Hero-Centric, Conversion-Optimized, Feature-Rich Showcase, Minimal & Direct, Social Proof-Focused, Interactive Product Demo, Trust & Authority, or Storytelling-Driven
2. **UI Style**: Match to product type and audience (see Style Reference below)
3. **Color Palette**: Industry-appropriate primary, secondary, accent, background, and text colors (see Color Palette Reference below). Include both light and dark mode considerations.
4. **Typography**: Heading font + Body font pairing with Google Fonts imports (see Font Pairing Reference below)
5. **Key Effects**: Shadows, blur, animations appropriate to the style
6. **Anti-Patterns to Avoid**: What NOT to do for this specific industry
7. **Pre-Delivery Checklist**: Key items to verify before delivery

**Example output format:**

```
DESIGN SYSTEM: [Project Name]
|-- PATTERN: [Pattern name] -- [Why]
|-- STYLE: [Style name] -- [Why]
|-- COLORS:
|   |-- Primary: #XXXXXX
|   |-- Secondary: #XXXXXX
|   |-- Accent/CTA: #XXXXXX
|   |-- Background: #XXXXXX
|   |-- Text: #XXXXXX
|-- TYPOGRAPHY: [Heading Font] / [Body Font]
|   |-- Google Fonts: [URL]
|-- EFFECTS: [Key effects]
|-- AVOID: [Anti-patterns]
```

### Step 3: Apply UX Rules

Cross-reference the design against the Quick Reference sections above, prioritizing:
1. Accessibility (CRITICAL)
2. Touch & Interaction (CRITICAL)
3. Performance (HIGH)
4. Style Selection (HIGH)
5. Layout & Responsive (HIGH)

### Step 4: Implement

Generate production-ready code using the design system as your guide. Apply all applicable UX rules from the Quick Reference.

---

## Style Reference

### General Styles (49)

| # | Style | Best For | Keywords |
|---|-------|----------|----------|
| 1 | Minimalism & Swiss Style | Enterprise apps, dashboards, documentation | Clean, spacious, functional, white space, high contrast, sans-serif, grid-based |
| 2 | Neumorphism | Health/wellness, meditation, fitness | Soft UI, embossed/debossed, subtle depth, rounded 12-16px, monochromatic |
| 3 | Glassmorphism | Modern SaaS, financial dashboards, overlays | Frosted glass, backdrop-blur 10-20px, translucent, layered, vibrant BG |
| 4 | Brutalism | Design portfolios, artistic projects, editorial | Raw, unpolished, high contrast, plain text, visible borders, asymmetric |
| 5 | 3D & Hyperrealism | Gaming, product showcase, immersive | WebGL/Three.js, realistic textures, spatial navigation, physics lighting |
| 6 | Vibrant & Block-based | Startups, creative agencies, gaming | Bold, energetic, block layout, geometric, high contrast, duotone |
| 7 | Dark Mode (OLED) | Night-mode apps, coding platforms, entertainment | Deep black #000000, low light, neon accents, eye-friendly |
| 8 | Accessible & Ethical | Government, healthcare, education | WCAG AAA, high contrast 7:1+, keyboard nav, screen reader, semantic |
| 9 | Claymorphism | Educational apps, children's apps, creative | Soft 3D, chunky, playful, bubbly, thick borders 3-4px, double shadows |
| 10 | Aurora UI | Modern SaaS, creative agencies, hero sections | Vibrant gradients, mesh gradient, luminous, Northern Lights effect |
| 11 | Retro-Futurism | Gaming, entertainment, music, cyberpunk | 80s aesthetic, neon glow, CRT scanlines, synthwave, glitch effects |
| 12 | Flat Design | Web apps, mobile apps, startup MVPs | 2D, bold colors, no shadows, clean lines, simple shapes, icon-heavy |
| 13 | Skeuomorphism | Legacy apps, gaming, premium products | Realistic, textured, 3D, real-world metaphors, detailed gradients |
| 14 | Liquid Glass | Premium SaaS, high-end e-commerce, branding | Morphing, fluid, translucent animated blur, iridescent, chromatic aberration |
| 15 | Motion-Driven | Portfolios, storytelling, interactive experiences | Animation-heavy, scroll effects, parallax, page transitions |
| 16 | Micro-interactions | Mobile apps, touchscreen UIs, productivity | Small animations, gesture-based, tactile, subtle hover 50-100ms |
| 17 | Inclusive Design | Public services, education, finance | WCAG AAA, color-blind friendly, haptic, voice interaction, universal |
| 18 | Zero Interface | Voice assistants, AI platforms, smart home | Minimal visible UI, voice-first, gesture-based, AI-driven, predictive |
| 19 | Soft UI Evolution | Modern enterprise, SaaS, health/wellness | Evolved neumorphism, better contrast, modern, subtle depth |
| 20 | Neubrutalism | Gen Z brands, startups, Figma-style | Bold borders, hard shadows, bright colors, chunky, playful |
| 21 | Bento Box Grid | Dashboards, product pages, portfolios | Grid-based cards, varied sizes, Apple-style, modular, organized |
| 22 | Y2K Aesthetic | Fashion, music, Gen Z brands | 2000s nostalgia, metallic, iridescent, bubblegum, retro-future |
| 23 | Cyberpunk UI | Gaming, tech products, crypto apps | Neon, dystopian, dark, high-tech, low-life, rain, holographic |
| 24 | Organic Biophilic | Wellness, sustainability, nature brands | Natural shapes, greens, earthy, organic curves, wood/stone textures |
| 25 | AI-Native UI | AI products, chatbots, copilots | Conversational, streaming text, inline suggestions, context-aware |
| 26 | Memphis Design | Creative agencies, music, youth brands | Geometric shapes, bold patterns, squiggles, 80s postmodern, playful |
| 27 | Vaporwave | Music platforms, gaming, creative portfolios | Synthwave, pastel gradients, marble statues, sunset gradients |
| 28 | Dimensional Layering | Dashboards, card layouts, modals | Depth through z-index, overlapping elements, floating panels |
| 29 | Exaggerated Minimalism | Fashion, architecture, portfolios | Ultra-minimal, dramatic whitespace, oversized typography, 1-2 elements |
| 30 | Kinetic Typography | Hero sections, marketing sites | Type as primary visual, animated text, bold headlines, scrolling effects |
| 31 | Parallax Storytelling | Brand storytelling, product launches | Multi-layer scrolling, narrative-driven, immersive scroll experiences |
| 32 | Swiss Modernism 2.0 | Corporate, architecture, editorial | Grid systems, Helvetica-style, asymmetric layouts, photographic |
| 33 | HUD / Sci-Fi FUI | Sci-fi games, space tech, cybersecurity | Holographic, transparent panels, wireframe, data streams, blue/cyan |
| 34 | Pixel Art | Indie games, retro tools, creative | 8-bit/16-bit aesthetic, blocky, limited colors, nostalgic |
| 35 | Bento Grids | Product features, dashboards, personal | Modular cards, varied sizes, clean borders, organized content |
| 36 | Spatial UI (VisionOS) | Spatial computing, VR/AR | Glass material, depth, gaze/pinch interaction, floating, volumetric |
| 37 | E-Ink / Paper | Reading apps, digital newspapers | Monochrome, paper texture, minimal, high contrast text, no animation |
| 38 | Gen Z Chaos / Maximalism | Gen Z lifestyle, music artists | Cluttered, chaotic, mixed media, stickers, irregular grids, loud |
| 39 | Biomimetic / Organic 2.0 | Sustainability tech, biotech, health | Nature-inspired patterns, cellular structures, fluid, adaptive |
| 40 | Anti-Polish / Raw Aesthetic | Creative portfolios, artist sites | Deliberately rough, hand-drawn, visible process, unrefined charm |
| 41 | Tactile Digital / Deformable UI | Modern mobile, playful brands | Squishy, elastic, physics-based, rubbery, playful interactions |
| 42 | Nature Distilled | Wellness, sustainable products | Abstracted nature, organic pigments, earth tones, botanical |
| 43 | Interactive Cursor Design | Creative portfolios, interactive | Custom cursors, hover reveals, magnetic elements, cursor trails |
| 44 | Voice-First Multimodal | Voice assistants, accessibility apps | Audio waveforms, speech-to-text, multimodal input, audio cues |
| 45 | 3D Product Preview | E-commerce, furniture, fashion | 360 product view, AR preview, 3D configurator, realistic rendering |
| 46 | Gradient Mesh / Aurora Evolved | Hero sections, backgrounds, creative | Complex mesh gradients, smooth color transitions, atmospheric |
| 47 | Editorial Grid / Magazine | News sites, blogs, magazines | Print-inspired, multi-column, drop caps, pull quotes, serif |
| 48 | Chromatic Aberration / RGB Split | Music platforms, gaming, tech | RGB split, glitch, chromatic shift, psychedelic, digital distortion |
| 49 | Vintage Analog / Retro Film | Photography, music/vinyl brands | Film grain, warm tones, light leaks, analog textures, nostalgic |

### Landing Page Patterns (8)

| # | Pattern | Best For |
|---|---------|----------|
| 1 | Hero-Centric | Products with strong visual identity |
| 2 | Conversion-Optimized | Lead generation, sales pages |
| 3 | Feature-Rich Showcase | SaaS, complex products |
| 4 | Minimal & Direct | Simple products, apps |
| 5 | Social Proof-Focused | Services, B2C products |
| 6 | Interactive Product Demo | Software, tools |
| 7 | Trust & Authority | B2B, enterprise, consulting |
| 8 | Storytelling-Driven | Brands, agencies, nonprofits |

### Dashboard/BI Styles (10)

| # | Style | Best For |
|---|-------|----------|
| 1 | Data-Dense Dashboard | Complex data analysis |
| 2 | Heat Map Style | Geographic/behavior data |
| 3 | Executive Dashboard | C-suite summaries |
| 4 | Real-Time Monitoring | Operations, DevOps |
| 5 | Drill-Down Analytics | Detailed exploration |
| 6 | Comparative Analysis | Side-by-side comparisons |
| 7 | Predictive Analytics | Forecasting, ML insights |
| 8 | User Behavior Analytics | UX research, product analytics |
| 9 | Financial Dashboard | Finance, accounting |
| 10 | Sales Intelligence | Sales teams, CRM |

---

## Color Palette Reference

Select colors based on product type. Below are curated palettes for common industries:

| Product Type | Primary | Secondary | Accent | Background | Notes |
|-------------|---------|-----------|--------|------------|-------|
| SaaS (General) | #2563EB | #3B82F6 | #EA580C | #F8FAFC | Trust blue + orange CTA |
| Micro SaaS | #6366F1 | #818CF8 | #059669 | #F5F3FF | Indigo + emerald CTA |
| E-commerce | #059669 | #10B981 | #EA580C | #ECFDF5 | Success green + urgency orange |
| E-commerce Luxury | #1C1917 | #44403C | #A16207 | #FAFAF9 | Premium dark + gold |
| B2B Service | #0F172A | #334155 | #0369A1 | #F8FAFC | Professional navy + blue |
| Financial Dashboard | #0F172A | #1E293B | #22C55E | #020617 | Dark bg + green positive |
| Healthcare App | #0891B2 | #22D3EE | #059669 | #ECFEFF | Calm cyan + health green |
| Educational App | #4F46E5 | #818CF8 | #EA580C | #EEF2FF | Playful indigo + energetic orange |
| Creative Agency | #EC4899 | #F472B6 | #0891B2 | #FDF2F8 | Bold pink + cyan accent |
| Portfolio | #18181B | #3F3F46 | #2563EB | #FAFAFA | Monochrome + blue accent |
| Gaming | #7C3AED | #A78BFA | #F43F5E | #0F0F23 | Neon purple + rose action |
| Fintech/Crypto | #F59E0B | #FBBF24 | #8B5CF6 | #0F172A | Gold trust + purple tech |
| Social Media | #E11D48 | #FB7185 | #2563EB | #FFF1F2 | Vibrant rose + engagement blue |
| AI/Chatbot | #7C3AED | #A78BFA | #0891B2 | #FAF5FF | AI purple + cyan interactions |
| Mental Health | #8B5CF6 | #C4B5FD | #059669 | #FAF5FF | Calming lavender + wellness green |
| Productivity Tool | #0D9488 | #14B8A6 | #EA580C | #F0FDFA | Teal focus + action orange |
| Beauty/Spa | #E8B4B8 | #F5D0C5 | #D4AF37 | #FFF5F5 | Soft pink + gold luxury |
| Restaurant/Food | #DC2626 | #F87171 | #F59E0B | #FFF7ED | Appetite red + warm amber |
| Real Estate | #1E40AF | #3B82F6 | #047857 | #F0F9FF | Trust blue + prosperity green |
| Legal Services | #1E293B | #334155 | #B45309 | #FAFAF9 | Authority navy + gold trust |
| Fitness/Gym | #DC2626 | #F87171 | #1E293B | #0F172A | Energy red + dark intensity |
| Travel/Tourism | #0891B2 | #22D3EE | #F59E0B | #ECFEFF | Sky cyan + sunshine amber |
| Music/Entertainment | #7C3AED | #A78BFA | #F43F5E | #0F0F23 | Creative purple + energy rose |
| Cybersecurity | #0F766E | #14B8A6 | #22C55E | #0F172A | Teal security + status green |

---

## Font Pairing Reference

| # | Pairing Name | Heading | Body | Mood | Best For |
|---|-------------|---------|------|------|----------|
| 1 | Classic Elegant | Playfair Display | Inter | Elegant, luxury, timeless | Luxury brands, fashion, editorial |
| 2 | Modern Professional | Poppins | Open Sans | Modern, clean, corporate | SaaS, corporate, business |
| 3 | Tech Startup | Space Grotesk | DM Sans | Tech, innovative, bold | Startups, AI products, dev tools |
| 4 | Editorial Classic | Cormorant Garamond | Libre Baskerville | Literary, refined, bookish | Publishing, blogs, magazines |
| 5 | Minimal Swiss | Inter | Inter | Minimal, neutral, functional | Dashboards, admin, enterprise |
| 6 | Playful Creative | Fredoka | Nunito | Playful, friendly, warm | Children's, educational, creative |
| 7 | Bold Statement | Bebas Neue | Source Sans 3 | Bold, impactful, dramatic | Marketing, portfolios, events |
| 8 | Wellness Calm | Lora | Raleway | Calm, natural, organic | Health, spa, meditation |
| 9 | Developer Mono | JetBrains Mono | IBM Plex Sans | Technical, precise, code | Dev tools, documentation, CLI |
| 10 | Retro Vintage | Abril Fatface | Merriweather | Nostalgic, dramatic | Vintage brands, breweries |
| 11 | Geometric Modern | Outfit | Work Sans | Balanced, contemporary | Portfolios, agencies, general |
| 12 | Luxury Serif | Cormorant | Montserrat | High-end, refined | Fashion, jewelry, premium |
| 13 | Friendly SaaS | Plus Jakarta Sans | Plus Jakarta Sans | Approachable, professional | SaaS, web apps, dashboards |
| 14 | News Editorial | Newsreader | Roboto | Trustworthy, informative | News, journalism, content |
| 15 | Handwritten Charm | Caveat | Quicksand | Personal, warm, casual | Personal blogs, lifestyle |
| 16 | Corporate Trust | Lexend | Source Sans 3 | Trustworthy, accessible | Enterprise, government, healthcare |
| 17 | Brutalist Raw | Space Mono | Space Mono | Raw, technical, stark | Brutalist, experimental, dev |
| 18 | Fashion Forward | Syne | Manrope | Avant-garde, edgy | Fashion, creative agencies |
| 19 | Soft Rounded | Varela Round | Nunito Sans | Soft, friendly, gentle | Children's, wellness, soft UI |
| 20 | Premium Sans | DM Sans | DM Sans | Premium, modern, versatile | Premium brands, startups |
| 21 | Vietnamese Friendly | Be Vietnam Pro | Noto Sans | Multilingual, readable | Vietnamese, international |
| 22 | Japanese Elegant | Noto Serif JP | Noto Sans JP | Japanese, elegant | Japanese, cultural sites |
| 23 | Korean Modern | Noto Sans KR | Noto Sans KR | Korean, modern | Korean sites, K-beauty |
| 24 | Chinese Traditional | Noto Serif TC | Noto Sans TC | Chinese, cultural | Traditional Chinese markets |
| 25 | Chinese Simplified | Noto Sans SC | Noto Sans SC | Modern, professional | Simplified Chinese, mainland |
| 26 | Arabic Elegant | Noto Naskh Arabic | Noto Sans Arabic | Arabic, RTL, cultural | Middle East, Islamic content |
| 27 | Legal Professional | EB Garamond | Lato | Formal, authoritative | Law firms, legal, government |

---

## Industry-Specific Reasoning Rules

When generating a design system, apply these industry-specific rules:

### Tech & SaaS
- **Recommended Styles**: Minimalism, Glassmorphism, Soft UI Evolution, Bento Grid
- **Color Mood**: Blues, indigos, neutral backgrounds with accent CTAs
- **Anti-Patterns**: Overly decorative elements, unclear CTAs, slow performance
- **Key Principle**: Clarity over decoration. Users need to understand the product instantly.

### E-commerce
- **Recommended Styles**: Vibrant & Block-based, Flat Design, Conversion-Optimized
- **Color Mood**: Brand primary + urgency accent (orange/red) for CTAs
- **Anti-Patterns**: Slow image loading, complex navigation, hidden cart
- **Key Principle**: Remove friction. Every extra click loses sales.

### Healthcare
- **Recommended Styles**: Soft UI Evolution, Accessible & Ethical, Minimalism
- **Color Mood**: Calm cyan, health green, white backgrounds
- **Anti-Patterns**: Dark mode as default, aggressive animations, low contrast
- **Key Principle**: Trust and accessibility above all. WCAG AAA minimum.

### Finance/Fintech
- **Recommended Styles**: Minimalism, Dark Mode, Data-Dense Dashboard
- **Color Mood**: Navy/dark + gold trust + green positive indicators
- **Anti-Patterns**: Playful fonts, AI purple/pink gradients, inconsistent data formatting
- **Key Principle**: Trust signals everywhere. Every number must be precise.

### Gaming/Entertainment
- **Recommended Styles**: Vibrant & Block-based, Retro-Futurism, Cyberpunk, Motion-Driven
- **Color Mood**: Neon, dark backgrounds, high contrast vibrant accents
- **Anti-Patterns**: Minimalism, low energy, conservative colors
- **Key Principle**: Immersion and energy. The UI itself is part of the experience.

### Creative/Portfolio
- **Recommended Styles**: Brutalism, Motion-Driven, Editorial Grid, Kinetic Typography
- **Color Mood**: Bold or monochrome, distinctive personality
- **Anti-Patterns**: Generic templates, overused fonts (Inter, Roboto), cookie-cutter layouts
- **Key Principle**: Be memorable. Your UI IS your portfolio.

### Education
- **Recommended Styles**: Claymorphism, Playful Creative, Accessible & Ethical
- **Color Mood**: Playful indigos, warm oranges, light backgrounds
- **Anti-Patterns**: Intimidating complexity, dark mode, tiny text
- **Key Principle**: Approachable and encouraging. Reduce cognitive load.

---

## Common Rules for Professional UI

### Icons & Visual Elements

| Rule | Do | Don't |
|------|----|----- |
| **No Emoji as Icons** | Use SVG icons (Lucide, Heroicons, Phosphor) | Emojis for navigation, settings, or controls |
| **Vector-Only Assets** | SVG or platform vector icons | Raster PNG icons |
| **Consistent Icon Sizing** | Define icon tokens (sm/md/lg = 16/24/32px) | Mixing arbitrary sizes |
| **Stroke Consistency** | Same stroke width within visual layer (1.5px or 2px) | Mixing thick and thin strokes |
| **Filled vs Outline** | One icon style per hierarchy level | Mixing at same level |
| **Touch Target Minimum** | 44x44pt minimum; expand with padding | Small icons without expanded tap area |
| **Icon Alignment** | Align to text baseline, consistent padding | Misaligned or inconsistent spacing |
| **Icon Contrast** | 4.5:1 for small elements, 3:1 for larger glyphs | Low-contrast icons blending into background |

### Light/Dark Mode Contrast

| Rule | Do | Don't |
|------|----|----- |
| **Surface readability** | Cards clearly separated from background | Overly transparent surfaces |
| **Text contrast (light)** | Body text >=4.5:1 against light surfaces | Low-contrast gray body text |
| **Text contrast (dark)** | Primary >=4.5:1, secondary >=3:1 on dark surfaces | Dark mode text blending into background |
| **Border visibility** | Separators visible in both themes | Theme-specific borders |
| **State contrast parity** | Pressed/focused/disabled equally distinguishable in both | One theme only |
| **Token-driven theming** | Semantic color tokens per theme | Hardcoded per-screen hex values |

### Layout & Spacing

| Rule | Do | Don't |
|------|----|----- |
| **Safe-area compliance** | Respect top/bottom safe areas for fixed elements | UI under notch or gesture bar |
| **8dp spacing rhythm** | 4/8dp spacing system for all gaps | Random spacing increments |
| **Readable text measure** | Limit line length on large devices | Full-width long text |
| **Section spacing hierarchy** | Clear vertical rhythm tiers (16/24/32/48) | Inconsistent spacing at same hierarchy |
| **Adaptive gutters** | Increase horizontal insets on larger widths | Same gutter on all sizes |
| **Scroll + fixed coexistence** | Bottom/top content insets for lists | Content hidden behind sticky elements |

---

## Pre-Delivery Checklist

### Visual Quality
- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon family and style
- [ ] Official brand assets with correct proportions
- [ ] Pressed-state visuals do not shift layout bounds
- [ ] Semantic theme tokens used consistently

### Interaction
- [ ] All tappable elements provide clear pressed feedback
- [ ] Touch targets >=44x44pt (iOS) / >=48x48dp (Android)
- [ ] Micro-interactions in 150-300ms range with native easing
- [ ] Disabled states visually clear and non-interactive
- [ ] Screen reader focus order matches visual order

### Light/Dark Mode
- [ ] Primary text contrast >=4.5:1 in both modes
- [ ] Secondary text contrast >=3:1 in both modes
- [ ] Dividers/borders and states distinguishable in both modes
- [ ] Modal scrim opacity strong enough (40-60% black)
- [ ] Both themes tested before delivery

### Layout
- [ ] Safe areas respected for headers, tab bars, CTAs
- [ ] Scroll content not hidden behind fixed/sticky bars
- [ ] Verified on small phone, large phone, tablet (portrait + landscape)
- [ ] Horizontal insets adapt by device size and orientation
- [ ] 4/8dp spacing rhythm maintained

### Accessibility
- [ ] All meaningful images/icons have accessibility labels
- [ ] Form fields have labels, hints, and clear error messages
- [ ] Color is not the only indicator
- [ ] Reduced motion and dynamic text size supported
- [ ] WCAG AA contrast minimum verified

### Common Sticking Points

| Problem | Solution |
|---------|----------|
| Can't decide on style/color | Re-analyze product type -> match industry rules -> recommend style |
| Dark mode contrast issues | Quick Reference 6: `color-dark-mode` + `color-accessible-pairs` |
| Animations feel unnatural | Quick Reference 7: `spring-physics` + `easing` + `exit-faster-than-enter` |
| Form UX is poor | Quick Reference 8: `inline-validation` + `error-clarity` + `focus-management` |
| Navigation confusing | Quick Reference 9: `nav-hierarchy` + `bottom-nav-limit` + `back-behavior` |
| Layout breaks on small screens | Quick Reference 5: `mobile-first` + `breakpoint-consistency` |
| Performance / jank | Quick Reference 3: `virtualize-lists` + `main-thread-budget` + `debounce-throttle` |
