# AI Website Agent — Design System

> Visual language for the frontend, inspired by modern AI chat UIs
> (Ciphy-style: light theme, three fixed columns, soft surfaces,
> violet primary accent). This document is the **what + why**;
> `tailwind.config.ts` is the **how**.

---

## 1. Intent

The frontend is a control surface for a WordPress + Elementor AI agent.
Visually it must feel:

- **Calm and light.** Operators spend long sessions here; a dark,
  high-contrast UI fatigues. Surface is `#F9F9FB`, never `#FFFFFF`.
- **Familiar.** Three columns (sidebar / conversation / inspector)
  match the mental model of every chat AI product launched in the
  last two years. Lower onboarding cost.
- **Quiet.** Violet `#7C3AED` for primary actions only. Everything
  else is grayscale + soft borders. No rainbow status colors.
- **Restrained.** Shadows are hairline. Animations are 120–300 ms
  ease-out. We are not a SaaS marketing page.

---

## 2. Color tokens

| Token             | Value      | Use                                            |
| ----------------- | ---------- | ---------------------------------------------- |
| `surface`         | `#F9F9FB`  | App background. Off-white, almost neutral.     |
| `panel`           | `#FFFFFF`  | Cards, sidebars, popovers.                     |
| `panel-border`    | `#E4E4E7`  | z-200. Hairline dividers.                      |
| `accent.DEFAULT`  | `#7C3AED`  | violet-600. Primary CTA, send button, focus.   |
| `accent.soft`     | `#EDE9FE`  | violet-100. Selected nav, hover bg.            |
| `accent.muted`    | `#A78BFA`  | violet-400. Icons on `accent.soft` backgrounds. |
| `accent.ring`     | `#C4B5FD`  | violet-300. Focus ring outline.                |
| `success`         | `#10B981`  | emerald-500. Status badges, checkmarks.        |
| `success.soft`    | `#D1FAE5`  | emerald-100. Success chips.                    |
| `danger`          | `#EF4444`  | red-500. Destructive.                          |
| `text`            | `#18181B`  | z-900. Primary copy.                           |
| `text.muted`      | `#71717A`  | z-500. Secondary copy.                         |
| `text.faint`      | `#A1A1AA`  | z-400. Timestamps, placeholders.               |
| `divider`         | `#E4E4E7`  | Same as `panel-border`, used for inline lines. |

**Why violet over indigo.** `#6366F1` (indigo-500) reads cold and
generic — it has become the default for Vercel / Linear / SaaS
templates. `#7C3AED` (violet-600) is warmer, slightly more
"creative / AI" feeling, and pairs better with the soft pastel
avatars we plan to use.

---

## 3. Typography

- **Family**: Inter (loaded from Google Fonts in `globals.css`,
  with a system-font fallback stack in `tailwind.config.ts`).
- **Base**: 14 px / line-height 1.5.
- **Body**: `text-base` → 14 px.
- **Meta / timestamps**: `text-xs` → 12 px.
- **Card headers**: `text-md` → 15 px or `text-lg` → 17 px,
  `font-semibold`.
- **Mono**: `JetBrains Mono` (or `Fira Code`) via `font-mono` —
  used for IDs, plan JSON, change IDs.

Inter is the standard for AI-product UIs in 2025–2026 (ChatGPT,
Anthropic Console, Perplexity, Cursor). It's free, variable, and
has good tabular figures.

---

## 4. Spacing

- **Card inner padding**: 20 px (`p-5`, exposed as `spacing.card`).
- **Section gutter**: 32 px (`p-8`, `spacing.section`).
- **Sidebar item gap**: 2–4 px between rows.
- **Sidebar section gap**: 16–24 px between groups (PINNED,
  CHAT HISTORY).

We deliberately stay inside Tailwind's default scale — adding
custom spacing tokens only at semantic levels (card / gutter /
section) keeps the codebase legible.

---

## 5. Border radius

| Element              | Class            | Radius  | Why                                                          |
| -------------------- | ---------------- | ------- | ------------------------------------------------------------ |
| Card (default)       | `rounded-card`   | 14 px   | Softer than `rounded-xl` (12px) without feeling pill-y.      |
| Card info (large)    | `rounded-2xl`    | 16 px   | For ModelInfoCard-style panels.                              |
| Chat bubble          | `rounded-bubble` | 18 px   | Distinct from cards so messages read as bubbles.             |
| Pill / chip          | `rounded-full`   | 9999 px | Tags, badges, status dots.                                   |
| Input field          | `rounded-xl`     | 12 px   | The new chat footer input.                                   |
| Send button          | `rounded-full`   | 9999 px | Square-pill shape inside the input.                          |

---

## 6. Shadow

```
card       0 1px 2px rgb(0 0 0 / 0.04)       — hairline, almost flat
card-hover 0 2px 8px rgb(0 0 0 / 0.06)       — deeper on hover
popover    0 4px 24px rgb(0 0 0 / 0.08)      — modals, menus
focus      0 0 0 3px rgb(124 58 237 / 0.18)  — violet ring, a11y
```

**No `shadow-2xl`.** That's a MUI-era tell. AI products look
better with subtle elevation, lots of whitespace, and clear
borders instead.

---

## 7. Motion

- Hover / active: `transition-all duration-200 ease-out`.
- Page / card entrance: `animate-in fade-in slide-in-from-bottom-2 duration-300`
  (provided by `tailwindcss-animate`).
- Spinner: `animate-spin` (Tailwind built-in).
- Loading bar: `animate-[loading_1.5s_ease-in-out_infinite]`
  (custom keyframes in `globals.css`).

Duration tokens:

- `duration-fast` → 120 ms (micro-interactions).
- `duration` (default) → 200 ms (hover, click).
- `duration-slow` → 300 ms (cards entering).

---

## 8. Base components (visual reference)

These are the building blocks we will use in the next step. They
are **described here for reference only** — none have been
implemented yet.

### 8.1 `SidePanelCard`

A small white card used inside the right-hand inspector to
display compact info. Hover lifts the shadow.

```tsx
<div className="bg-panel border border-panel-border rounded-card p-card
                shadow-card hover:shadow-card-hover transition-all duration-200">
  ...
</div>
```

### 8.2 `ModelInfoCard`

The prominent header card at the top of the right inspector:
circular avatar + name + one-line description + small metrics
row (tokens, latency, cost). Uses `rounded-2xl` for a more
generous feel than the smaller cards below it.

```tsx
<section className="bg-panel border border-panel-border rounded-2xl p-card">
  <header className="flex items-center gap-3">
    <Avatar className="w-10 h-10 rounded-full bg-gradient-to-br from-accent to-accent-muted" />
    <div>
      <h2 className="text-md font-semibold">GPT-4</h2>
      <p className="text-sm text-text-muted">How the model determines token...</p>
    </div>
  </header>
  <dl className="mt-4 grid grid-cols-3 gap-2 text-xs text-text-muted"> ... </dl>
</section>
```

### 8.3 `ActionChip`

Small pill used for "Fact check", "Share", "Searched for: X",
status badges.

```tsx
<span className="inline-flex items-center gap-1.5 px-2.5 py-1
                 rounded-full bg-accent-soft text-accent-muted
                 text-xs font-medium">
  <CheckCircle2 className="w-3.5 h-3.5" />
  Fact check
</span>
```

### 8.4 `MessageBubble`

User and assistant messages in the conversation column.

```tsx
<div className="bg-panel border border-panel-border rounded-bubble
                p-card max-w-prose">
  <p className="text-base">{message.text}</p>
</div>
```

User bubbles can swap to `bg-accent text-text-inverse` for
emphasis.

### 8.5 `InputArea`

The footer of the conversation column — toolbar (B/I/s/T),
attach / library / mic icons, send button.

```tsx
<form className="bg-panel border border-panel-border rounded-xl p-3
                 shadow-card flex flex-col gap-2">
  <div className="flex items-center gap-2 text-text-muted">
    <ToolbarButton icon={Bold} />
    <ToolbarButton icon={Italic} />
    <ToolbarButton icon={Strikethrough} />
    <ToolbarButton icon={Type} />
    <span className="ml-auto" />
    <ToolbarButton icon={Paperclip} />
    <ToolbarButton icon={Library} />
    <ToolbarButton icon={Mic} />
    <button type="submit"
            className="ml-1 w-9 h-9 rounded-full bg-accent text-white
                       hover:bg-accent/90 transition-all duration-200">
      <Send className="w-4 h-4 mx-auto" />
    </button>
  </div>
  <textarea className="w-full resize-none outline-none bg-transparent
                       text-base placeholder:text-text-faint"
            placeholder="Pregunta algo al agente..." />
</form>
```

---

## 9. Usage rules

1. **Contrast.** Body copy (`text`) on `surface` or `panel` always
   passes WCAG AA (≥ 4.5:1). `text-muted` on `panel` is AA for
   normal text.
2. **Hover.** Anything clickable (button, row, card) gets a
   200 ms transition + either a color shift to `accent.soft`,
   a border darken, or a `shadow-card-hover`. Never both.
3. **Spacing rhythm.** Use the semantic spacing tokens
   (`p-card`, `p-gutter`, `p-section`) for major surfaces;
   fall back to Tailwind's default scale (2/4/6/8) for inside.
4. **Motion.** Anything that animates more than 300 ms is wrong.
   99 % of motion in this app is 120–200 ms.
5. **Borders before shadows.** Prefer a 1 px `panel-border`
   to define a region. Reserve shadow for floating elements
   (popover, modal) and the interactive lift state (hover).

---

## 10. Migration status — legacy classes

The current components still use the previous design-system names.
We kept them as **aliases** in `tailwind.config.ts` so the app
keeps rendering while we refactor progressively.

| Legacy class         | Resolves to                       | Status                                |
| -------------------- | --------------------------------- | ------------------------------------- |
| `bg-bg`              | `surface` (#F9F9FB)               | legacy — was dark, now light; **fix** |
| `bg-panel`            | `panel` (#FFFFFF)                 | legacy — still works                  |
| `border-border`      | `divider` (#E4E4E7)               | legacy — still works                  |
| `text-muted`         | `text.muted` (#71717A)            | legacy — still works                  |
| `bg-accent`          | `accent.DEFAULT` (#7C3AED)        | legacy — color changed (was orange)   |
| `text-text`          | `text.DEFAULT` (#18181B)          | legacy — works but prefer `text-base` |
| `bg-success`         | `success.DEFAULT` (#10B981)       | legacy — works                        |
| `text-success`       | `success.DEFAULT` (#10B981)       | legacy — works                        |
| `bg-danger`          | `danger.DEFAULT` (#EF4444)        | legacy — works                        |

### Files still using legacy classes (will be migrated in a follow-up)

- `app/page.tsx`
- `app/sites/page.tsx`
- `app/sites/[siteId]/page.tsx`
- `app/not-found.tsx`
- `components/Chat.tsx`
- `components/QuickActions.tsx`
- `components/SiteInventoryBadge.tsx`
- `components/ChangePlan.tsx`
- `components/PageTree.tsx`
- `components/PreviewFrame.tsx`
- `components/AuditLog.tsx`

> **Note:** the legacy color palette (dark slate with orange
> accent) is no longer in effect — those classes now resolve to
> the new light palette. Components will visually match the new
> design immediately, but the class names in source still say
> `bg-bg`, etc. A future PR will rename them to the new tokens
> (`bg-surface`, `bg-panel`, `text-text-muted`, ...) to make
> intent explicit.

---

## 11. Files in this design system

| File                                 | Purpose                                                |
| ------------------------------------ | ------------------------------------------------------ |
| `tailwind.config.ts`                 | Token source for Tailwind + alias map for legacy.      |
| `app/globals.css`                    | CSS custom properties, font import, base defaults.     |
| `docs/design-tokens.json`            | Machine-readable mirror of the tokens (export-ready).  |
| `docs/design-system.md`              | This document.                                         |

**When changing a token, update all three** (config, CSS vars,
JSON) so the single source of truth remains intact.