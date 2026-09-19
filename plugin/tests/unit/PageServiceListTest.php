<?php
/**
 * Tests para Page_Service::list_pages — verificación del cableado del
 * filtro `search` (FIX del audit: pages-controller.php declara `search`
 * en línea 50 y el callback lo pasa al servicio en línea 107; este test
 * confirma que el servicio efectivamente lo convierte en `'s' => $search`
 * en los args de `WP_Query`).
 *
 * Estrategia: usa el stub `WP_Query` en `tests/unit/wp-stubs.php` que
 * captura los args del constructor en `WP_Query::$captured_args`.
 * Como `posts=[]`, no se llama a `normalize_page` (que dependería de
 * funciones WP no disponibles en unit-bootstrap).
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\WordPress\Page_Service;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/wp-stubs.php';

// PSR-4 strict no resuelve `page-service.php` (kebab-case). Igual que en
// TemplateServiceTest, hacemos require manual.
require_once dirname(__DIR__, 2) . '/includes/WordPress/page-service.php';

final class PageServiceListTest extends TestCase
{
    private Page_Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        \WP_Query::reset_captured();
        $this->service = new Page_Service();
    }

    /**
     * Helper: devuelve los args del último `new WP_Query(...)` ejecutado.
     *
     * @return array<string, mixed>
     */
    private function last_captured_args(): array
    {
        $stack = \WP_Query::$captured_args;
        $this->assertNotEmpty($stack, 'expected at least one new WP_Query(...) call');
        return $stack[count($stack) - 1];
    }

    public function test_search_non_empty_propagates_to_wp_query_s_arg(): void
    {
        $this->service->list_pages(['search' => 'Inicio']);

        $args = $this->last_captured_args();
        $this->assertArrayHasKey('s', $args);
        $this->assertSame('Inicio', $args['s']);
        $this->assertSame('page', $args['post_type']);
    }

    public function test_search_empty_string_still_runs_no_filter_in_wp(): void
    {
        // En WordPress, `'s' => ''` se trata como "sin filtro" — el endpoint
        // devolverá todas las páginas según status/per_page.
        $this->service->list_pages(['search' => '']);

        $args = $this->last_captured_args();
        $this->assertArrayHasKey('s', $args);
        $this->assertSame('', $args['s']);
    }

    public function test_search_absent_defaults_to_empty_string(): void
    {
        // Backward-compat: callers que no pasan `search` no rompen.
        $this->service->list_pages([]);

        $args = $this->last_captured_args();
        $this->assertArrayHasKey('s', $args);
        $this->assertSame('', $args['s']);
    }

    public function test_status_defaults_to_any_and_search_composes(): void
    {
        $this->service->list_pages(['status' => 'draft', 'search' => 'Foo']);

        $args = $this->last_captured_args();
        $this->assertSame('draft', $args['post_status']);
        $this->assertSame('Foo', $args['s']);
    }

    public function test_page_arg_maps_to_paged(): void
    {
        $this->service->list_pages(['page' => 3, 'per_page' => 10]);

        $args = $this->last_captured_args();
        $this->assertSame(3, $args['paged']);
        $this->assertSame(10, $args['posts_per_page']);
    }

    public function test_search_is_sanitized(): void
    {
        // Defense in depth: tags/scripts son strippeados antes de llegar a WP_Query.
        $this->service->list_pages(['search' => '<b>Inicio</b>']);

        $args = $this->last_captured_args();
        $this->assertStringNotContainsString('<b>', $args['s']);
        $this->assertStringContainsString('Inicio', $args['s']);
    }
}