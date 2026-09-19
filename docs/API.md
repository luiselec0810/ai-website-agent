# API REST — AI Website Bridge

> **Namespace:** `/wp-json/ai-agent/v1/`
> **Auth:** Header `X-AI-Agent-Key: <api-key>`
> **Formato:** JSON en request y response
> **Errores:** Estructurados según SRS §28

## Tabla de endpoints

| Método | Endpoint                                  | Descripción                          |
|--------|-------------------------------------------|--------------------------------------|
| GET    | `/health`                                 | Info del sitio, WP, Elementor        |
| GET    | `/pages`                                  | Listar páginas                       |
| GET    | `/pages/{id}`                             | Obtener página                       |
| POST   | `/pages`                                  | Crear página                         |
| PATCH  | `/pages/{id}`                             | Actualizar página                    |
| POST   | `/pages/{id}/duplicate`                   | Duplicar página                      |
| GET    | `/pages/{id}/elementor`                   | Leer estructura Elementor            |
| POST   | `/pages/{id}/elementor/containers`        | Agregar container                    |
| POST   | `/pages/{id}/elementor/widgets`           | Agregar widget                       |
| PATCH  | `/pages/{id}/elementor/widgets/{eid}`     | Actualizar widget                    |
| DELETE | `/pages/{id}/elementor/elements/{eid}`    | Eliminar elemento                    |
| POST   | `/pages/{id}/elementor/elements/{eid}/duplicate` | Duplicar elemento              |
| POST   | `/pages/{id}/elementor/elements/{eid}/move`     | Mover elemento                 |
| GET    | `/templates`                              | Listar templates Elementor           |
| GET    | `/templates/{id}`                         | Obtener un template                  |
| GET    | `/media`                                  | Listar media library                 |
| GET    | `/media/{id}`                             | Obtener attachment                   |
| POST   | `/media`                                  | Subir archivo                        |
| GET    | `/design-system`                          | Colores, fuentes, espaciado globales |
| GET    | `/preview/{page_id}?device=desktop`       | URL de preview                       |
| GET    | `/audit`                                  | Listar cambios (audit log)           |
| POST   | `/changes/{id}/rollback`                  | Revertir un change                   |

## Autenticación

```http
GET /wp-json/ai-agent/v1/health HTTP/1.1
Host: example.com
X-AI-Agent-Key: demo-key-change-in-production-please
```

El plugin compara el header contra los hashes almacenados en `wp_options.ai_agent_api_keys` usando `wp_hash_password`. Si coincide, identifica al usuario WP asociado y aplica capability checks.

**Capacidad mínima por endpoint:**

| Endpoint                          | Capability         |
|-----------------------------------|--------------------|
| `GET /health`                     | `read`             |
| `GET /pages`, `/pages/{id}`       | `edit_pages`       |
| `POST/PATCH /pages`               | `edit_pages`       |
| `POST /pages/{id}/duplicate`      | `edit_pages`       |
| `GET /pages/{id}/elementor`       | `edit_pages`       |
| Operaciones Elementor (POST/PATCH/DELETE) | `edit_pages` |
| `POST /changes/{id}/rollback`     | `edit_pages`       |
| `POST /pages` con `status=publish`| `publish_pages`    |

## Health

```http
GET /wp-json/ai-agent/v1/health
```

```json
{
  "success": true,
  "wordpress_version": "6.6.2",
  "elementor_installed": true,
  "elementor_version": "3.27.0",
  "elementor_pro_installed": false,
  "php_version": "8.2.10",
  "available_widgets": ["heading", "text-editor", "button", "image", ...]
}
```

## Pages

### Listar

```http
GET /wp-json/ai-agent/v1/pages?search=promo&status=publish&per_page=20&page=1
```

**Query params:**
- `search` (string, opcional): buscar por título
- `status` (string, opcional): `publish`, `draft`, `private`, `any`
- `per_page` (int, opcional, default 10, max 100)
- `page` (int, opcional, default 1)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 12,
      "title": "Promociones",
      "slug": "promociones",
      "status": "publish",
      "url": "http://example.com/promociones/",
      "builder": "elementor",
      "modified": "2026-09-10T15:30:00"
    }
  ],
  "pagination": { "total": 1, "per_page": 20, "page": 1 }
}
```

### Obtener

```http
GET /wp-json/ai-agent/v1/pages/12
```

### Crear

```http
POST /wp-json/ai-agent/v1/pages
Content-Type: application/json
X-AI-Agent-Key: ...

{
  "title": "Nueva Landing",
  "status": "draft",
  "template": "elementor-default"
}
```

Si `status` no se especifica, default es `draft`. Si se quiere `publish`, requiere `publish_pages`.

### Actualizar

```http
PATCH /wp-json/ai-agent/v1/pages/12
{
  "title": "Landing v2",
  "slug": "landing-v2"
}
```

### Duplicar

```http
POST /wp-json/ai-agent/v1/pages/12/duplicate
{
  "new_title": "Copia de Promociones",
  "status": "draft"
}
```

## Elementor

### Leer estructura

```http
GET /wp-json/ai-agent/v1/pages/12/elementor
```

**Response:**
```json
{
  "success": true,
  "page_id": 12,
  "elementor": true,
  "version": "3.27.0",
  "content": [
    {
      "id": "abc123",
      "type": "container",
      "settings": { ... },
      "children": [
        {
          "id": "def456",
          "type": "widget",
          "widgetType": "heading",
          "settings": { "title": "Bienvenido" }
        }
      ]
    }
  ]
}
```

### Agregar container

```http
POST /wp-json/ai-agent/v1/pages/12/elementor/containers
{
  "parent_id": "root",
  "position": "last",
  "settings": {
    "flex_direction": "column",
    "padding": { "top": 32, "bottom": 32 }
  }
}
```

### Agregar widget

```http
POST /wp-json/ai-agent/v1/pages/12/elementor/widgets
{
  "container_id": "abc123",
  "widget": "heading",
  "position": "last",
  "settings": {
    "title": "Nuevo heading",
    "header_size": "h2"
  }
}
```

**Widgets disponibles (core):**
`heading`, `text-editor`, `button`, `image`, `video`, `icon`, `spacer`, `divider`, `html`, `shortcode`

**Widgets Pro (si Elementor Pro está instalado):**
`form`, `posts`, `gallery`, `slides`, `price-table`, `testimonial`

### Actualizar widget

```http
PATCH /wp-json/ai-agent/v1/pages/12/elementor/widgets/def456
{
  "settings": {
    "title": "Título actualizado"
  }
}
```

### Eliminar elemento

```http
DELETE /wp-json/ai-agent/v1/pages/12/elementor/elements/def456
```

### Duplicar elemento

```http
POST /wp-json/ai-agent/v1/pages/12/elementor/elements/def456/duplicate
```

### Mover elemento

```http
POST /wp-json/ai-agent/v1/pages/12/elementor/elements/def456/move
{
  "parent_id": "xyz789",
  "position": 2
}
```

## Media

### Listar

```http
GET /wp-json/ai-agent/v1/media?search=hamburguesa&per_page=20
```

### Obtener

```http
GET /wp-json/ai-agent/v1/media/45
```

### Subir

```http
POST /wp-json/ai-agent/v1/media
Content-Type: multipart/form-data

file: <binary>
title: "Imagen de promoción"
alt: "Hamburguesa doble con queso"
```

## Design System

```http
GET /wp-json/ai-agent/v1/design-system
```

```json
{
  "success": true,
  "data": {
    "colors": {
      "primary": "#FF6B00",
      "secondary": "#1A1A1A",
      "accent": "#FFD700"
    },
    "fonts": {
      "heading": "Montserrat",
      "body": "Open Sans"
    },
    "spacing": { "small": 8, "medium": 16, "large": 32 },
    "buttons": { "border_radius": 8 }
  }
}
```

## Preview

```http
GET /wp-json/ai-agent/v1/preview/12?device=desktop
```

Devuelve una URL de preview que el frontend puede cargar en un iframe.

## Audit Log

```http
GET /wp-json/ai-agent/v1/audit?page_id=12&limit=50
```

```json
{
  "success": true,
  "data": [
    {
      "id": 87,
      "user_id": 1,
      "ip": "192.168.1.10",
      "action": "update_widget",
      "page_id": 12,
      "element_id": "def456",
      "before": { "title": "Bienvenido" },
      "after": { "title": "Bienvenidos a Jaguar" },
      "success": true,
      "error": null,
      "created_at": "2026-09-10T15:35:22"
    }
  ]
}
```

## Rollback

```http
POST /wp-json/ai-agent/v1/changes/45/rollback
```

Restaura el snapshot anterior al change 45.

## Errores

Todos los errores siguen el formato:

```json
{
  "success": false,
  "error": {
    "code": "ELEMENT_NOT_FOUND",
    "message": "No se encontró el elemento abc123 en la página 12",
    "details": { "page_id": 12, "element_id": "abc123" }
  }
}
```

**Códigos de error comunes:**

| Code                    | HTTP | Significado                           |
|-------------------------|------|---------------------------------------|
| `UNAUTHORIZED`          | 401  | API key inválida o ausente            |
| `FORBIDDEN`             | 403  | Capability insuficiente               |
| `PAGE_NOT_FOUND`        | 404  | Página inexistente                    |
| `ELEMENT_NOT_FOUND`     | 404  | Element ID no existe en la página     |
| `INVALID_WIDGET_TYPE`   | 400  | Tipo de widget no disponible          |
| `INVALID_SETTINGS`      | 400  | Settings del widget no válidos        |
| `ELEMENTOR_NOT_ACTIVE`  | 503  | Elementor no está instalado           |
| `SNAPSHOT_FAILED`       | 500  | No se pudo crear snapshot             |
| `WRITE_FAILED`          | 500  | Error al escribir en Elementor        |
| `INTERNAL_ERROR`        | 500  | Error inesperado                      |
