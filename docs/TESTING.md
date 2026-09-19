# Testing

El proyecto tiene **tres niveles de tests** que se ejecutan en distintas etapas del desarrollo.

## Niveles

```
┌─────────────────────────────────────────────────────────┐
│  E2E (Playwright)                                       │
│  - Levanta docker-compose completo                      │
│  - Simula usuario real en el frontend                   │
│  - Valida los 7 criterios de aceptación del SRS §42    │
└─────────────────────────────────────────────────────────┘
            ▲
            │
┌─────────────────────────────────────────────────────────┐
│  Integración (scripts bash + Vitest con mocks)          │
│  - Plugin: curl contra WP REST API                      │
│  - Orchestrator: mockea WP REST, valida flujo           │
└─────────────────────────────────────────────────────────┘
            ▲
            │
┌─────────────────────────────────────────────────────────┐
│  Unitarios (PHPUnit + Vitest)                           │
│  - Funciones puras, sin red ni DB                       │
└─────────────────────────────────────────────────────────┘
```

## Unitarios — Plugin (PHPUnit)

### Ubicación
`plugin/tests/unit/`

### Configuración
`plugin/phpunit.xml` — configura el bootstrap con WP test suite.

### Cómo correrlos

```bash
cd plugin
composer install
composer test
```

### Cobertura objetivo

- `ElementorReader` — parsear JSON, manejar formato inválido
- `ElementorWriter` — agregar/modificar/eliminar elementos sin perder estructura
- `ElementorValidator` — verificar tipos de widgets
- `Auth` — hashear y verificar API keys
- `Validator` — sanitización y validación de IDs
- `RevisionManager` — crear y restaurar snapshots
- `AuditLog` — registrar entradas correctamente

### Ejemplo de test

```php
// plugin/tests/unit/ElementorReaderTest.php
namespace AIWebsiteBridge\Tests;

use PHPUnit\Framework\TestCase;
use AIWebsiteBridge\Elementor\Elementor_Reader;

class ElementorReaderTest extends TestCase {
    public function test_parses_valid_elementor_data() {
        $raw = '[{"id":"abc","type":"container","children":[]}]';
        $reader = new Elementor_Reader();
        $tree = $reader->parse($raw);
        $this->assertCount(1, $tree);
        $this->assertEquals('abc', $tree[0]['id']);
    }
    
    public function test_throws_on_invalid_json() {
        $this->expectException(\InvalidArgumentException::class);
        (new Elementor_Reader())->parse('not json');
    }
}
```

## Unitarios — Orchestrator (Vitest)

### Ubicación
`orchestrator/tests/unit/`

### Cómo correrlos

```bash
cd orchestrator
npm install
npm test
```

### Cobertura objetivo

- `tool-executor` — llama al WP REST en el orden correcto
- `approval-gate` — bloquea tools si no está approved
- `idempotency` — aborta operación con operation_id duplicado
- `plan-generator` — genera Change Plan JSON válido
- `context-builder` — carga contexto lazy
- `anthropic-provider`, `openai-provider`, `ollama-provider` — parseo de respuestas

### Ejemplo

```typescript
// orchestrator/tests/unit/approval-gate.test.ts
import { describe, it, expect } from 'vitest';
import { ApprovalGate } from '../src/executor/approval-gate';

describe('ApprovalGate', () => {
  it('bloquea tool de escritura si change no está approved', () => {
    const gate = new ApprovalGate({ status: 'awaiting_approval' });
    expect(() => gate.requireApproval('update_widget')).toThrow(/not approved/);
  });
  
  it('permite tool de lectura siempre', () => {
    const gate = new ApprovalGate({ status: 'draft' });
    expect(() => gate.requireApproval('get_page')).not.toThrow();
  });
});
```

## Integración — Plugin (curl)

### Ubicación
`plugin/tests/integration/`

### Requisito
docker-compose up debe estar corriendo.

### Cómo correrlos

```bash
cd plugin/tests/integration
bash run-all.sh
```

### Qué valida

Cada script bash hace `curl` contra los endpoints REST y verifica el JSON de respuesta.

```bash
#!/bin/bash
# plugin/tests/integration/test-health.sh
source .env

RESPONSE=$(curl -s -H "X-AI-Agent-Key: $DEFAULT_WP_API_KEY" \
  http://localhost:8000/wp-json/ai-agent/v1/health)

if echo "$RESPONSE" | jq -e '.success == true' > /dev/null; then
  echo "✅ /health OK"
else
  echo "❌ /health failed: $RESPONSE"
  exit 1
fi
```

## E2E — Frontend (Playwright)

### Ubicación
`tests/e2e/`

### Cómo correrlos

```bash
# Asegurarse de que docker-compose está corriendo
docker-compose up -d

# Instalar Playwright
cd tests/e2e
npm install
npx playwright install

# Correr todos los tests
npm test

# Correr un test específico
npx playwright test tests/cambiar-titulo.spec.ts

# Modo interactivo (debug)
npx playwright test --ui
```

### Tests que cubren el SRS §42

```typescript
// tests/e2e/test-1-listar-paginas.spec.ts
import { test, expect } from '@playwright/test';

test('Test 1: Lista las páginas del sitio', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.fill('[data-testid="api-key"]', process.env.DEFAULT_WP_API_KEY!);
  await page.click('[data-testid="connect-site"]');
  await page.click('text=Promociones');
  
  const chat = page.locator('[data-testid="chat-input"]');
  await chat.fill('Lista las páginas de mi sitio');
  await chat.press('Enter');
  
  await expect(page.locator('text=/Inicio|Nosotros|Servicios|Contacto/')).toBeVisible();
});
```

```typescript
// tests/e2e/test-4-cambiar-titulo.spec.ts
test('Test 4: Cambia el título principal con aprobación', async ({ page }) => {
  // Setup: ir a página "Nosotros"
  // Chat: "Cambia el título principal a 'Conoce nuestra historia'"
  // Verificar: aparece Change Plan
  // Click: Approve
  // Verificar: WordPress muestra el nuevo título
  // Click: Rollback
  // Verificar: vuelve al título original
});
```

## Criterios de aceptación (SRS §42)

Cada test del SRS §42 debe tener su correspondiente archivo en `tests/e2e/`:

| Test | Archivo |
|------|---------|
| 1. Lista páginas | `test-1-listar-paginas.spec.ts` |
| 2. Busca página | `test-2-buscar-pagina.spec.ts` |
| 3. Detecta Elementor | `test-3-detecta-elementor.spec.ts` |
| 4. Cambia título | `test-4-cambiar-titulo.spec.ts` |
| 5. Duplica página | `test-5-duplica-pagina.spec.ts` |
| 6. Agrega botón | `test-6-agrega-boton.spec.ts` |
| 7. Rollback | `test-7-rollback.spec.ts` |

## CI

```yaml
# .github/workflows/test.yml (sugerido)
name: Tests
on: [push, pull_request]

jobs:
  unit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - uses: actions/setup-php@v2
        with: { php-version: '8.2' }
      - run: cd plugin && composer install && composer test
      - run: cd orchestrator && npm ci && npm test
  
  e2e:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker-compose up -d
      - run: docker-compose logs -f wordpress-init
      - run: cd tests/e2e && npm ci && npx playwright install && npm test
```

## Métricas

- **Cobertura mínima**: 70% en código de negocio (Elementor Adapter, Executor, Planner).
- **Tiempo máximo**: tests E2E completos < 5 minutos.
- **Frecuencia**: en cada PR + nightly completo.
