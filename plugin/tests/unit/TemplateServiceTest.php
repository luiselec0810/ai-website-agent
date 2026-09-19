<?php
/**
 * Tests para Template_Service::list_templates — específicamente del filtro
 * `search` por substring del título (FIX del bug del LLM que sufría
 * template-id hallucination porque `/templates?search=Plantilla1` devolvía
 * los 6 templates en vez de los que contenían "Plantilla1").
 *
 * Estrategia: como el `unit-bootstrap` no carga WP core (no hay `WP_Query`
 * ni `sanitize_*`), no podemos instanciar un query real. En su lugar,
 * invocamos el método privado `build_query_args` por reflection y
 * verificamos que el argumento `s` aparece cuando `search` es no vacío,
 * y se omite cuando es vacío. El runtime real (producción / wp-phpunit)
 * lo verifica el smoke test con curl y los tests de integración.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\WordPress\Template_Service;
use PHPUnit\Framework\TestCase;

// Cargar los stubs globales de WP_* (definidos en el namespace global,
// NO en este namespace) ANTES de requerir el archivo del servicio. Si no,
// las llamadas `sanitize_key()` dentro de la clase
// `AIWebsiteBridge\WordPress\Template_Service` no podrían resolver.
require_once __DIR__ . '/wp-stubs.php';

// PSR-4 strict del plugin (ver tests/README.md → convención PSR-4) no
// resuelve archivos en kebab-case (`template-service.php`), por lo que el
// autoloader no encuentra `Template_Service`. Cargamos manualmente el
// archivo, igual que unit-bootstrap hace con los archivos de elementor/.
require_once dirname(__DIR__, 2) . '/includes/WordPress/template-service.php';

final class TemplateServiceTest extends TestCase
{
    private Template_Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new Template_Service();
    }

    /**
     * Helper: invoca el método privado `build_query_args` por reflection.
     *
     * PHP 8.1+ no requiere setAccessible(true) para invocar métodos
     * privados vía reflection — esa llamada está deprecada desde 8.1.
     *
     * @param array<string, mixed> $args
     * @return array<string, mixed>
     */
    private function invoke_build_query_args(array $args): array
    {
        $reflection = new \ReflectionClass($this->service);
        $method = $reflection->getMethod('build_query_args');
        return $method->invokeArgs($this->service, [$args]);
    }

    // ─────────────────────────────────────────────────────────────────
    // search filter
    // ─────────────────────────────────────────────────────────────────

    public function test_search_non_empty_adds_s_to_wp_query_args(): void
    {
        // El callback real: GET /templates?search=Plantilla1 debe filtrar
        // por título LIKE 'Plantilla1'. El user-facing test del LLM es
        // "search=Plantilla1" → solo templates cuyo título contiene "Plantilla1".
        $args = $this->invoke_build_query_args(['search' => 'Plantilla1']);

        $this->assertArrayHasKey('s', $args, 'search filter must add "s" to WP_Query args');
        $this->assertSame('Plantilla1', $args['s']);
    }

    public function test_search_empty_string_omits_s_from_wp_query_args(): void
    {
        // search vacío NO debe forzar un WHERE extra — tiene que ser
        // equivalente a no pasar `search` en absoluto.
        $args_empty = $this->invoke_build_query_args(['search' => '']);
        $args_absent = $this->invoke_build_query_args([]);

        $this->assertArrayNotHasKey('s', $args_empty, 'search="" must NOT add "s" to args');
        $this->assertArrayNotHasKey('s', $args_absent, 'search absent must NOT add "s" to args');
        $this->assertSame($args_absent, $args_empty, 'search="" and search absent must produce identical args');
    }

    public function test_search_null_or_missing_omits_s(): void
    {
        // Backward-compat: callers existentes que pasen `search => null`
        // o que omitan el key no deben romper ni añadir el filtro.
        $args_null = $this->invoke_build_query_args(['search' => null]);
        $args_missing = $this->invoke_build_query_args(['type' => 'page']);

        $this->assertArrayNotHasKey('s', $args_null);
        $this->assertArrayNotHasKey('s', $args_missing);
    }

    public function test_search_is_sanitized_via_sanitize_text_field(): void
    {
        // Defense in depth: el search debe pasar por sanitize_text_field
        // para neutralizar tags/scripts antes de llegar a WP_Query.
        $args = $this->invoke_build_query_args(['search' => '<script>foo</script>Plantilla1']);
        $this->assertArrayHasKey('s', $args);
        $this->assertStringNotContainsString('<script>', $args['s']);
        $this->assertStringContainsString('Plantilla1', $args['s']);
    }

    // ─────────────────────────────────────────────────────────────────
    // backward-compat: type / per_page siguen funcionando
    // ─────────────────────────────────────────────────────────────────

    public function test_type_filter_still_builds_meta_query(): void
    {
        $args = $this->invoke_build_query_args(['type' => 'page']);

        $this->assertArrayHasKey('meta_query', $args);
        $this->assertSame('_elementor_template_type', $args['meta_query'][0]['key']);
        $this->assertSame('page', $args['meta_query'][0]['value']);
    }

    public function test_per_page_is_clamped_1_to_100(): void
    {
        $args_low  = $this->invoke_build_query_args(['per_page' => 0]);
        $args_high = $this->invoke_build_query_args(['per_page' => 9999]);
        $args_mid  = $this->invoke_build_query_args(['per_page' => 25]);

        $this->assertSame(1, $args_low['posts_per_page'], 'per_page < 1 must clamp to 1');
        $this->assertSame(100, $args_high['posts_per_page'], 'per_page > 100 must clamp to 100');
        $this->assertSame(25, $args_mid['posts_per_page']);
    }

    public function test_search_and_type_compose_correctly(): void
    {
        // Cuando vienen ambos, search y type deben coexistir (no se pisan).
        $args = $this->invoke_build_query_args([
            'type'   => 'section',
            'search' => 'Hero',
        ]);

        $this->assertArrayHasKey('s', $args);
        $this->assertSame('Hero', $args['s']);
        $this->assertArrayHasKey('meta_query', $args);
        $this->assertSame('section', $args['meta_query'][0]['value']);
    }

    public function test_post_type_is_always_elementor_library(): void
    {
        $args = $this->invoke_build_query_args([]);
        $this->assertSame('elementor_library', $args['post_type']);
        $this->assertSame('publish', $args['post_status']);
    }
}