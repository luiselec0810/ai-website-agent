<?php
/**
 * Tests para Media_Service::list_media — verificación del cableado del
 * filtro `search` (FIX del audit: media-controller.php declara `search`
 * en línea 47 y el callback lo pasa al servicio en línea 78; este test
 * confirma que el servicio efectivamente lo convierte en `'s' => $search`
 * en los args de `WP_Query`).
 *
 * Estrategia: usa el stub `WP_Query` en `tests/unit/wp-stubs.php` que
 * captura los args del constructor en `WP_Query::$captured_args`.
 * Como `posts=[]`, no se llama a `normalize_attachment` (que dependería
 * de funciones WP no disponibles en unit-bootstrap).
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\WordPress\Media_Service;
use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/wp-stubs.php';

// PSR-4 strict no resuelve `media-service.php` (kebab-case). Igual que en
// TemplateServiceTest, hacemos require manual.
require_once dirname(__DIR__, 2) . '/includes/WordPress/media-service.php';

final class MediaServiceListTest extends TestCase
{
    private Media_Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        \WP_Query::reset_captured();
        $this->service = new Media_Service();
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
        $this->service->list_media(['search' => 'logo']);

        $args = $this->last_captured_args();
        $this->assertArrayHasKey('s', $args);
        $this->assertSame('logo', $args['s']);
        $this->assertSame('attachment', $args['post_type']);
    }

    public function test_search_empty_string_still_runs_no_filter_in_wp(): void
    {
        // En WordPress, `'s' => ''` se trata como "sin filtro" (es un no-op
        // en WP_Query::get_posts()). Por tanto, search='' está OK — el
        // endpoint devolverá todos los attachments.
        $this->service->list_media(['search' => '']);

        $args = $this->last_captured_args();
        $this->assertArrayHasKey('s', $args);
        $this->assertSame('', $args['s']);
    }

    public function test_search_absent_defaults_to_empty_string(): void
    {
        // Backward-compat: callers que no pasan `search` no rompen.
        $this->service->list_media([]);

        $args = $this->last_captured_args();
        $this->assertArrayHasKey('s', $args);
        $this->assertSame('', $args['s']);
    }

    public function test_per_page_is_clamped_to_1_100(): void
    {
        $this->service->list_media(['per_page' => 9999]);
        $this->assertSame(100, $this->last_captured_args()['posts_per_page']);

        $this->service->list_media(['per_page' => 0]);
        $this->assertSame(1, $this->last_captured_args()['posts_per_page']);
    }

    public function test_search_is_sanitized(): void
    {
        // Defense in depth: tags/scripts son strippeados antes de llegar a WP_Query.
        $this->service->list_media(['search' => '<script>alert(1)</script>logo']);

        $args = $this->last_captured_args();
        $this->assertStringNotContainsString('<script>', $args['s']);
        $this->assertStringContainsString('logo', $args['s']);
    }
}