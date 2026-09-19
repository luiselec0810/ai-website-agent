# Elementor Adapter

El Elementor Adapter es la pieza más crítica del plugin: traduce operaciones semánticas (`add_widget`, `update_text`) a mutaciones del formato interno `_elementor_data`.

## Formato `_elementor_data`

Elementor almacena cada página como un **JSON** en el post meta `_elementor_data`. El JSON es un array de elementos con esta estructura:

```json
[
  {
    "id": "abc123def",
    "elType": "container",
    "settings": {
      "_title": "Section",
      "flex_direction": "column",
      "padding": { "top": "32", "bottom": "32" }
    },
    "elements": [
      {
        "id": "def456ghi",
        "elType": "widget",
        "widgetType": "heading",
        "settings": {
          "title": "Bienvenido",
          "header_size": "h2",
          "align": "left"
        },
        "elements": []
      }
    ]
  }
]
```

### Conceptos clave

- **`elType`**: puede ser `container` (sección/columna) o `widget`.
- **`widgetType`**: solo presente en widgets. Ej: `heading`, `text-editor`, `button`, `image`.
- **`id`**: hash alfanumérico único por elemento. Elementor lo genera. **El agente debe usar estos IDs**, no inventarlos.
- **`settings`**: objeto con la configuración del elemento. Cada widget tiene su propio schema.
- **`elements`**: hijos (solo en containers).

## Cómo funciona el Adapter

```
┌─────────────────────────────────────────────────────────┐
│  Elementor_Adapter                                      │
│                                                          │
│  ┌───────────────┐   ┌───────────────┐   ┌────────────┐│
│  │ Reader        │   │ Writer        │   │ Validator  ││
│  │ - parse()     │──▶│ - apply_ops() │──▶│ - widget   ││
│  │ - find_by_id()│   │ - serialize() │   │   exists?  ││
│  │ - to_tree()   │   │ - add()       │   │ - settings ││
│  │               │   │ - update()    │   │   valid?   ││
│  │               │   │ - delete()    │   │            ││
│  │               │   │ - move()      │   │            ││
│  │               │   │ - duplicate() │   │            ││
│  └───────────────┘   └───────────────┘   └────────────┘│
└─────────────────────────────────────────────────────────┘
```

### Reader

Lee el JSON y lo convierte a una estructura fácil de manipular en PHP:

```php
// plugin/includes/elementor/class-elementor-reader.php

class Elementor_Reader {
    public function parse(string $json): array {
        $data = json_decode($json, true);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw new \InvalidArgumentException('Invalid Elementor JSON');
        }
        return $this->normalize($data);
    }
    
    public function find_by_id(array $tree, string $id): ?array {
        // BFS/DFS recursivo
    }
}
```

### Writer

Aplica operaciones al árbol en memoria, valida, y luego re-serializa:

```php
// plugin/includes/elementor/class-elementor-writer.php

class Elementor_Writer {
    public function add_widget(array &$tree, string $container_id, array $widget): bool;
    public function update_widget(array &$tree, string $element_id, array $new_settings): bool;
    public function delete_element(array &$tree, string $element_id): bool;
    public function move_element(array &$tree, string $element_id, string $parent_id, int $position): bool;
    public function duplicate_element(array &$tree, string $element_id): ?string; // returns new ID
    public function serialize(array $tree): string; // back to JSON
}
```

### Validator

Verifica antes de escribir:

```php
// plugin/includes/elementor/class-elementor-validator.php

class Elementor_Validator {
    public function widget_exists(string $type): bool {
        if (!class_exists('\Elementor\Plugin')) {
            return false;
        }
        $widgets = \Elementor\Plugin::instance()->widgets_manager->get_widget_types();
        return isset($widgets[$type]);
    }
    
    public function validate_settings(string $widget_type, array $settings): bool {
        // Cada widget tiene su propio schema.
        // Para MVP validamos solo tipos básicos.
        // Para Pro widgets, validación más estricta.
    }
}
```

## Operaciones semánticas soportadas

### Agregar widget

```http
POST /pages/{id}/elementor/widgets
{
  "container_id": "abc123",
  "widget": "heading",
  "position": "last",
  "settings": { "title": "Hola" }
}
```

Internamente:
1. `Reader::find_by_id($tree, "abc123")` → busca el container.
2. `Validator::widget_exists("heading")` → true.
3. `Writer::add_widget($tree, "abc123", $newWidget)` → modifica el árbol.
4. `Adapter::save($page_id, $tree)` → actualiza `_elementor_data`.

### Actualizar texto (caso especial)

El SRS §33 menciona "cambiar texto". Esto es un caso especial de `update_widget` donde solo se cambia el setting `title`:

```http
PATCH /pages/{id}/elementor/widgets/def456
{ "settings": { "title": "Nuevo título" } }
```

El agente debe primero llamar a `GET /elementor` para encontrar el `id` del widget que tiene el texto, luego aplicar el update.

## Compatibilidad con versiones

| Elementor | Formato `_elementor_data` | Soporte |
|-----------|---------------------------|---------|
| 3.0+      | Array JSON como arriba    | ✅ Sí  |
| 2.x       | Similar pero con algunas diferencias | ⚠️  Parcial |

El Adapter verifica la versión con `get_post_meta($page_id, '_elementor_version', true)` y adapta el comportamiento.

## Responsive

Elementor permite valores responsive por setting:

```json
{
  "font_size": {
    "desktop": 48,
    "tablet": 40,
    "mobile": 32
  }
}
```

**Importante:** el Adapter detecta si ya existe configuración responsive antes de sobrescribirla. Si el usuario quiere cambiar solo `desktop`, los valores de `tablet` y `mobile` se preservan.

```php
// Writer::update_setting_responsive()
// Solo modifica la key específica, preserva las demás.
```

## Templates

Elementor almacena templates en el Custom Post Type `elementor_library`. El Adapter los lee con:

```php
$templates = get_posts([
    'post_type'      => 'elementor_library',
    'posts_per_page' => -1,
    'post_status'    => 'publish',
]);

foreach ($templates as $tpl) {
    $data = [
        'id'        => $tpl->ID,
        'title'     => $tpl->post_title,
        'type'      => get_post_meta($tpl->ID, '_elementor_template_type', true),
        'data'      => json_decode(get_post_meta($tpl->ID, '_elementor_data', true), true),
    ];
}
```

Endpoint: `GET /templates` devuelve este array.

## Errores comunes

| Error | Causa | Mitigación |
|-------|-------|------------|
| `ELEMENTOR_NOT_ACTIVE` | Elementor no instalado | Health check lo detecta |
| `ELEMENT_NOT_FOUND` | ID no existe en la página | Reader verifica antes de escribir |
| `INVALID_WIDGET_TYPE` | Widget no registrado | Validator consulta `widgets_manager` |
| `INVALID_SETTINGS` | Settings no compatibles con el widget | Validator + JSON Schema |
| `WRITE_FAILED` | Error al guardar `_elementor_data` | Snapshot permite rollback |

## Próximas mejoras (post-MVP)

- **Detección automática de heading hierarchy** (h1 → h2 → h3).
- **Migración de formato entre versiones de Elementor** (de 2.x a 3.x).
- **Soporte de Global Styles** (aplicar estilos globales a widgets).
- **Análisis de accesibilidad** (alt text, contraste, ARIA labels).
