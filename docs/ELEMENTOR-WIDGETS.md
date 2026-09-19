# Elementor Widgets Reference

This document lists every Elementor widget the AI Website Bridge plugin supports, with valid `settings` keys. Use this as a reference when prompting the AI agent — copy/paste the example JSON.

---

## Core Widgets (always available)

### `heading`

```json
{
  "container_id": "{{container_id}}",
  "widget": "heading",
  "position": "last",
  "settings": {
    "title": "¡Hola Mundo!",
    "header_size": "h1",        // h1 | h2 | h3 | h4 | h5 | h6 | div | span | p
    "align": "left",            // left | center | right | justify
    "title_color": "#222222",
    "typography_typography": "default",  // default | custom
    "typography_font_family": "Roboto",
    "typography_font_size": {"unit": "px", "size": 48},
    "typography_font_weight": "700",
    "typography_line_height": {"unit": "px", "size": 56}
  }
}
```

### `text-editor`

```json
{
  "container_id": "{{container_id}}",
  "widget": "text-editor",
  "position": "last",
  "settings": {
    "editor": "<p>Este es un <strong>párrafo</strong> con HTML.</p>",
    "align": "left"
  }
}
```

### `button`

```json
{
  "container_id": "{{container_id}}",
  "widget": "button",
  "position": "last",
  "settings": {
    "text": "Click aquí",
    "link": {"url": "https://example.com", "is_external": true, "nofollow": false},
    "align": "center",          // left | center | right | justify
    "size": "md",                // sm | md | lg
    "typography_typography": "default",
    "background_color": "#f97316",
    "button_text_color": "#ffffff",
    "border_radius": {"unit": "px", "top": 8, "right": 8, "bottom": 8, "left": 8}
  }
}
```

### `image`

```json
{
  "container_id": "{{container_id}}",
  "widget": "image",
  "position": "last",
  "settings": {
    "image": {"url": "https://example.com/image.jpg", "id": 123, "alt": "Description"},
    "image_size": "large",       // thumbnail | medium | medium_large | large | full
    "align": "center",
    "caption_source": "custom",
    "caption": "Optional caption"
  }
}
```

### `icon`

```json
{
  "container_id": "{{container_id}}",
  "widget": "icon",
  "position": "last",
  "settings": {
    "selected_icon": {"value": "far fa-star", "library": "fa-regular"},
    "size": {"unit": "px", "size": 48},
    "primary_color": "#f97316",
    "align": "center"
  }
}
```

### `divider`

```json
{
  "container_id": "{{container_id}}",
  "widget": "divider",
  "position": "last",
  "settings": {
    "style": "solid",            // solid | double | dotted | dashed | curly | ...
    "width": {"unit": "%", "size": 80},
    "color": "#cccccc",
    "weight": 1,
    "gap": {"unit": "px", "size": 15}
  }
}
```

### `spacer`

```json
{
  "container_id": "{{container_id}}",
  "widget": "spacer",
  "position": "last",
  "settings": {
    "space": {"unit": "px", "size": 50}
  }
}
```

### `video`

```json
{
  "container_id": "{{container_id}}",
  "widget": "video",
  "position": "last",
  "settings": {
    "video_type": "youtube",     // youtube | vimeo | hosteda | external
    "youtube_url": "https://www.youtube.com/watch?v=...",
    "autoplay": false,
    "mute": false,
    "controls": true
  }
}
```

### `icon-list`, `counter`, `progress`, `star-rating`, `testimonial`, `tabs`, `accordion`, `toggle`, `alert`, `audio`, `counter`, `html`, `shortcode`, `rating`, `image-carousel`, `image-gallery`, `icon-box`, `image-box`, `star-rating`, `counter`, `progress`

These are also supported. The settings keys are the same as the Elementor editor uses. Reference: https://developers.elementor.com/docs/widgets/

---

## Pro Widgets (require Elementor Pro)

If the site has Elementor Pro installed, these additional widgets are available:

- `form` — Form builder
- `posts` — Posts grid/list
- `gallery` — Image gallery
- `slides` — Slideshow
- `price-table` — Pricing table
- `testimonial` — Testimonials
- `nav-menu` — Navigation menu
- `animated-headline` — Animated text
- `cta` — Call to action
- `flip-box` — Flip box
- `media-carousel` — Media carousel

Check availability via the health endpoint:
```bash
curl -H "X-AI-Agent-Key: …" http://example.com/wp-json/ai-agent/v1/health/ | jq .data.available_widgets
```

---

## Common mistakes

- ❌ `page_id: 0` or `container_id: "main-container"` — the LLM hallucinates an ID. Always use `"{{page_id}}"` / `"{{container_id}}"` placeholders; the orchestrator substitutes them.
- ❌ Forgetting `parent_id: "root"` for the first container. Elementor will reject the request if `parent_id` is empty.
- ❌ Forgetting `position: "last"`. Valid values: `"first"`, `"last"`, or a numeric index.
- ❌ Passing a complex `link` object as a string. Use the dict format: `{"url": "...", "is_external": true, "nofollow": false}`.
- ❌ Empty `settings: {}` for `heading` / `button` — the widget will render with no text. Always include the required text field.

---

## Full Elementor JSON output for debugging

The plugin's `get_structure` endpoint returns the tree with `settings` as object (`{}`) — Elementor 4.x requires this format. If you see `settings: []` in the response, OPCache is serving the old code. Reset by reloading the page and adding `opcache_reset()` to your `wp-config.php` (in dev only).

## Prompting tips

- Be specific: "create a page Promo with a centered heading '¡Oferta!' and a button 'Comprar ahora'"
- Specify the layout: "two columns: left with text, right with an image"
- Mention Elementor: "use Elementor, not the classic editor"
- After the agent makes mistakes, correct them: "use `{{page_id}}`, not `0`"
