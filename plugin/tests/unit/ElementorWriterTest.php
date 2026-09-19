<?php
/**
 * Tests para AIWebsiteBridge\Elementor\Elementor_Writer.
 *
 * Cubre:
 *   - G3: add_widget llama validate_settings.
 *   - G4: move_element rechaza movimientos circulares.
 *   - regenerate_ids (helper de use_template / G5).
 *   - serialize emite `settings: {}` para Elementor 4.x.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\Elementor\Elementor_Reader;
use AIWebsiteBridge\Elementor\Elementor_Validator;
use AIWebsiteBridge\Elementor\Elementor_Writer;
use PHPUnit\Framework\TestCase;

final class ElementorWriterTest extends TestCase
{
    private Elementor_Writer $writer;
    private Elementor_Reader $reader;

    protected function setUp(): void
    {
        parent::setUp();
        $this->reader = new Elementor_Reader();
        // Validator con whitelists cargadas (CORE_WIDGETS + PRO_WIDGETS).
        $this->writer = new Elementor_Writer($this->reader, new Elementor_Validator());
    }

    /**
     * Helper: crea un árbol con un container raíz.
     */
    private function make_tree_with_container(string $container_id = 'cnt0001'): array
    {
        return [
            [
                'id' => $container_id,
                'elType' => 'container',
                'settings' => ['default' => []],
                'elements' => [],
            ],
        ];
    }

    // ─────────────────────────────────────────────────────────────────
    // add_container
    // ─────────────────────────────────────────────────────────────────

    public function test_add_container_to_root_returns_new_id(): void
    {
        $tree = [];
        $result = $this->writer->add_container($tree, 'root', 'last', []);

        $this->assertIsString($result);
        $this->assertSame(7, strlen($result));
        $this->assertCount(1, $tree);
        $this->assertSame($result, $tree[0]['id']);
        $this->assertSame('container', $tree[0]['elType']);
        $this->assertArrayHasKey('default', $tree[0]['settings']);
    }

    public function test_add_container_to_invalid_parent_returns_wp_error(): void
    {
        $tree = [];
        $result = $this->writer->add_container($tree, 'nonexistent', 'last', []);

        $this->assertWPError($result, 'PARENT_NOT_FOUND');
    }

    public function test_add_container_first_inserts_at_beginning(): void
    {
        $tree = $this->make_tree_with_container('first');
        $result = $this->writer->add_container($tree, 'root', 'first', []);

        $this->assertIsString($result);
        $this->assertCount(2, $tree);
        $this->assertSame($result, $tree[0]['id']);
        $this->assertSame('first', $tree[1]['id']);
    }

    public function test_add_container_appends_at_last_by_default(): void
    {
        $tree = $this->make_tree_with_container('first');
        $result = $this->writer->add_container($tree, 'root', 'last', []);

        $this->assertIsString($result);
        $this->assertCount(2, $tree);
        $this->assertSame('first', $tree[0]['id']);
        $this->assertSame($result, $tree[1]['id']);
    }

    public function test_add_container_to_nested_parent(): void
    {
        $tree = $this->make_tree_with_container('parent');
        $result = $this->writer->add_container($tree, 'parent', 'last', []);

        $this->assertIsString($result);
        $this->assertCount(1, $tree);
        $this->assertCount(1, $tree[0]['elements']);
        $this->assertSame($result, $tree[0]['elements'][0]['id']);
    }

    // ─────────────────────────────────────────────────────────────────
    // add_widget (G3: valida settings)
    // ─────────────────────────────────────────────────────────────────

    public function test_add_widget_with_valid_type_succeeds(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->add_widget($tree, 'cnt0001', 'heading', 'last', ['title' => 'Hi', 'header_size' => 'h2']);

        $this->assertIsString($result);
        $this->assertCount(1, $tree[0]['elements']);
        $widget = $tree[0]['elements'][0];
        $this->assertSame('widget', $widget['elType']);
        $this->assertSame('heading', $widget['widgetType']);
        $this->assertSame('Hi', $widget['settings']['title']);
    }

    public function test_add_widget_with_invalid_type_returns_wp_error(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->add_widget($tree, 'cnt0001', 'not-a-real-widget', 'last', []);

        $this->assertWPError($result, 'INVALID_WIDGET_TYPE');
    }

    public function test_add_widget_with_invalid_settings_returns_wp_error(): void
    {
        // G3 fix: validator rejects heading.header_size='h99'.
        $tree = $this->make_tree_with_container();
        $result = $this->writer->add_widget($tree, 'cnt0001', 'heading', 'last', ['header_size' => 'h99']);

        $this->assertWPError($result);
    }

    public function test_add_widget_with_invalid_container_returns_wp_error(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->add_widget($tree, 'nonexistent', 'heading', 'last', []);

        $this->assertWPError($result, 'CONTAINER_NOT_FOUND');
    }

    // ─────────────────────────────────────────────────────────────────
    // update_widget
    // ─────────────────────────────────────────────────────────────────

    public function test_update_widget_merges_settings_preserving_responsive(): void
    {
        $tree = $this->make_tree_with_container();
        $this->writer->add_widget($tree, 'cnt0001', 'heading', 'last', [
            'title' => 'Original',
            'title_color' => '#000000',
            'title_color_tablet' => '#FF0000',
        ]);

        $result = $this->writer->update_widget($tree, $tree[0]['elements'][0]['id'], ['title' => 'Updated']);

        $this->assertTrue($result);
        $widget = $tree[0]['elements'][0];
        $this->assertSame('Updated', $widget['settings']['title']);
        $this->assertSame('#000000', $widget['settings']['title_color'], 'desktop variant preserved');
        $this->assertSame('#FF0000', $widget['settings']['title_color_tablet'], 'tablet variant preserved');
    }

    public function test_update_widget_with_unknown_id_returns_wp_error(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->update_widget($tree, 'nonexistent', ['title' => 'X']);

        $this->assertWPError($result, 'ELEMENT_NOT_FOUND');
    }

    // ─────────────────────────────────────────────────────────────────
    // G7 regression — HTTP status codes on WP_Error
    //
    // Antes del fix, los WP_Error del writer no incluían `status` en sus datos,
    // por lo que WordPress devolvía HTTP 500 para cualquier error (incluso
    // ELEMENT_NOT_FOUND o INVALID_WIDGET_TYPE). El orquestador mostraba
    // "❌ X falló: HTTP 500" en lugar del mensaje real.
    // ─────────────────────────────────────────────────────────────────

    public function test_update_widget_not_found_returns_status_404(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->update_widget($tree, 'missing-id', ['title' => 'X']);

        $this->assertWPError($result, 'ELEMENT_NOT_FOUND');
        $data = $result->get_error_data();
        $this->assertIsArray($data);
        $this->assertSame(404, $data['status'] ?? null, 'ELEMENT_NOT_FOUND must map to HTTP 404');
    }

    public function test_update_widget_invalid_widget_type_returns_status_400(): void
    {
        // Construir un árbol con un widget cuyo widgetType no existe en el whitelist.
        $tree = [
            [
                'id' => 'cnt0001',
                'elType' => 'container',
                'settings' => ['default' => []],
                'elements' => [
                    [
                        'id' => 'w0001',
                        'elType' => 'widget',
                        'widgetType' => 'this-widget-does-not-exist',
                        'settings' => ['title' => 'X'],
                        'elements' => [],
                    ],
                ],
            ],
        ];

        $result = $this->writer->update_widget($tree, 'w0001', ['title' => 'Y']);

        $this->assertWPError($result, 'INVALID_WIDGET_TYPE');
        $data = $result->get_error_data();
        $this->assertSame(400, $data['status'] ?? null, 'INVALID_WIDGET_TYPE must map to HTTP 400');
    }

    public function test_update_widget_merges_nested_image_setting(): void
    {
        // G7 fix: settings con sub-objetos (e.g. `image: {id, url, mime_type}`)
        // deben mergearse sin perder datos y serializarse correctamente.
        $tree = $this->make_tree_with_container();
        $this->writer->add_widget($tree, 'cnt0001', 'image', 'last', [
            'title' => 'Original',
        ]);

        $widget_id = $tree[0]['elements'][0]['id'];

        $result = $this->writer->update_widget($tree, $widget_id, [
            'image' => [
                'id'        => 84,
                'url'       => 'http://example.com/flyer.png',
                'mime_type' => 'image/png',
            ],
        ]);

        $this->assertTrue($result);
        $widget = $tree[0]['elements'][0];
        $this->assertSame('Original', $widget['settings']['title'], 'preserves untouched fields');
        $this->assertSame(84, $widget['settings']['image']['id']);
        $this->assertSame('http://example.com/flyer.png', $widget['settings']['image']['url']);
        $this->assertSame('image/png', $widget['settings']['image']['mime_type']);

        // Verificar que el árbol resultante se serializa a JSON válido.
        $json = $this->writer->serialize($tree);
        $decoded = json_decode($json, true);
        $this->assertIsArray($decoded);
        $this->assertSame(84, $decoded[0]['elements'][0]['settings']['image']['id']);
    }

    public function test_update_widget_drops_non_scalar_values_silently(): void
    {
        // G7 fix: si un sub-array trae un valor no-serializable (e.g. un resource
        // PHP), antes el guardado de `_elementor_data` reventaba con HTTP 500.
        // Ahora ese campo se descarta y la operación continúa.
        $tree = $this->make_tree_with_container();
        $this->writer->add_widget($tree, 'cnt0001', 'heading', 'last', [
            'title' => 'Original',
        ]);
        $widget_id = $tree[0]['elements'][0]['id'];

        // Inyectar un resource PHP en settings vía una referencia a un stream abierto.
        $resource = fopen('php://memory', 'r');
        $result = $this->writer->update_widget($tree, $widget_id, [
            'title'        => 'Updated',
            'broken_field' => ['nested' => $resource, 'ok' => 'kept'],
        ]);

        $this->assertTrue($result);
        $widget = $tree[0]['elements'][0];
        $this->assertSame('Updated', $widget['settings']['title']);
        $this->assertSame('kept', $widget['settings']['broken_field']['ok']);
        $this->assertArrayNotHasKey('nested', $widget['settings']['broken_field'], 'resource must be stripped');

        // Verificar que el árbol resultante sigue siendo serializable.
        $json = $this->writer->serialize($tree);
        $this->assertNotFalse(json_decode($json));

        fclose($resource);
    }

    public function test_add_container_to_invalid_parent_returns_status_404(): void
    {
        $tree = [];
        $result = $this->writer->add_container($tree, 'nonexistent', 'last', []);

        $this->assertWPError($result, 'PARENT_NOT_FOUND');
        $data = $result->get_error_data();
        $this->assertSame(404, $data['status'] ?? null);
    }

    public function test_add_widget_invalid_widget_type_returns_status_400(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->add_widget($tree, 'cnt0001', 'not-a-real-widget', 'last', []);

        $this->assertWPError($result, 'INVALID_WIDGET_TYPE');
        $data = $result->get_error_data();
        $this->assertSame(400, $data['status'] ?? null);
    }

    public function test_add_widget_to_missing_container_returns_status_404(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->add_widget($tree, 'nonexistent', 'heading', 'last', []);

        $this->assertWPError($result, 'CONTAINER_NOT_FOUND');
        $data = $result->get_error_data();
        $this->assertSame(404, $data['status'] ?? null);
    }

    public function test_delete_element_unknown_returns_status_404(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->delete_element($tree, 'nonexistent');

        $this->assertWPError($result, 'ELEMENT_NOT_FOUND');
        $data = $result->get_error_data();
        $this->assertSame(404, $data['status'] ?? null);
    }

    public function test_duplicate_element_unknown_returns_status_404(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->duplicate_element($tree, 'nonexistent');

        $this->assertWPError($result, 'ELEMENT_NOT_FOUND');
        $data = $result->get_error_data();
        $this->assertSame(404, $data['status'] ?? null);
    }

    public function test_move_element_circular_returns_status_409(): void
    {
        // G4 + G7: movimientos circulares deben devolver 409 (Conflict), no 500.
        $tree = $this->make_tree_with_container();
        $result = $this->writer->move_element($tree, 'cnt0001', 'cnt0001', -1);

        $this->assertWPError($result, 'CIRCULAR_MOVE');
        $data = $result->get_error_data();
        $this->assertSame(409, $data['status'] ?? null);
    }

    public function test_move_element_missing_parent_returns_status_404(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->move_element($tree, 'cnt0001', 'nonexistent', -1);

        $this->assertWPError($result, 'NEW_PARENT_NOT_FOUND');
        $data = $result->get_error_data();
        $this->assertSame(404, $data['status'] ?? null);
    }

    // ─────────────────────────────────────────────────────────────────
    // delete_element
    // ─────────────────────────────────────────────────────────────────

    public function test_delete_root_element(): void
    {
        $tree = $this->make_tree_with_container('to_delete');
        $this->writer->add_container($tree, 'root', 'last');

        $result = $this->writer->delete_element($tree, 'to_delete');

        $this->assertTrue($result);
        $this->assertCount(1, $tree);
        $this->assertSame('to_delete', $tree[0]['id'] === 'to_delete' ? 'to_delete' : ''); // sanity
    }

    public function test_delete_nested_widget(): void
    {
        $tree = $this->make_tree_with_container();
        $this->writer->add_widget($tree, 'cnt0001', 'heading', 'last', ['title' => 'X']);
        $widget_id = $tree[0]['elements'][0]['id'];

        $result = $this->writer->delete_element($tree, $widget_id);

        $this->assertTrue($result);
        $this->assertCount(0, $tree[0]['elements']);
    }

    // ─────────────────────────────────────────────────────────────────
    // duplicate_element
    // ─────────────────────────────────────────────────────────────────

    public function test_duplicate_widget_generates_new_id(): void
    {
        $tree = $this->make_tree_with_container();
        $this->writer->add_widget($tree, 'cnt0001', 'heading', 'last', ['title' => 'Original']);
        $original_id = $tree[0]['elements'][0]['id'];

        $new_id = $this->writer->duplicate_element($tree, $original_id);

        $this->assertIsString($new_id);
        $this->assertNotSame($original_id, $new_id);
        $this->assertCount(2, $tree[0]['elements']);
        $this->assertSame('Original', $tree[0]['elements'][1]['settings']['title']);
    }

    public function test_duplicate_nested_tree_regenerates_all_ids(): void
    {
        // Construye un árbol anidado y verifica que TODOS los IDs cambien.
        $tree = [];
        $this->writer->add_container($tree, 'root', 'last');
        $outer_id = $tree[0]['id'];
        $this->writer->add_container($tree, $outer_id, 'last');
        $inner_id = $tree[0]['elements'][0]['id'];
        $this->writer->add_widget($tree, $inner_id, 'heading', 'last', ['title' => 'X']);
        $widget_id = $tree[0]['elements'][0]['elements'][0]['id'];

        // Recolectar IDs originales.
        $original_ids = [$outer_id, $inner_id, $widget_id];
        $this->writer->duplicate_element($tree, $outer_id);

        // El duplicado se inserta después del outer.
        $copy = $tree[1];
        $this->assertNotContains($copy['id'], $original_ids);
        $this->assertNotContains($copy['elements'][0]['id'], $original_ids);
        $this->assertNotContains($copy['elements'][0]['elements'][0]['id'], $original_ids);
    }

    // ─────────────────────────────────────────────────────────────────
    // move_element (G4: CIRCULAR_MOVE guard)
    // ─────────────────────────────────────────────────────────────────

    public function test_move_element_to_root(): void
    {
        $tree = $this->make_tree_with_container('parent');
        $this->writer->add_widget($tree, 'parent', 'heading', 'last', ['title' => 'X']);
        $widget_id = $tree[0]['elements'][0]['id'];
        $this->writer->add_container($tree, 'root', 'last');

        $result = $this->writer->move_element($tree, $widget_id, 'root', -1);

        $this->assertTrue($result);
        $this->assertCount(2, $tree);
        $this->assertSame($widget_id, $tree[1]['id']);
    }

    public function test_move_element_to_itself_returns_circular_error(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->move_element($tree, 'cnt0001', 'cnt0001', -1);

        $this->assertWPError($result, 'CIRCULAR_MOVE');
        $this->assertCount(1, $tree, 'Tree must not be mutated on circular move');
    }

    public function test_move_element_to_descendant_returns_circular_error(): void
    {
        // outer > inner; intentar mover outer dentro de inner sería circular.
        $tree = [];
        $this->writer->add_container($tree, 'root', 'last');
        $outer_id = $tree[0]['id'];
        $this->writer->add_container($tree, $outer_id, 'last');
        $inner_id = $tree[0]['elements'][0]['id'];

        $result = $this->writer->move_element($tree, $outer_id, $inner_id, -1);

        $this->assertWPError($result, 'CIRCULAR_MOVE');
        // El árbol no debe haber mutado: outer sigue en root, inner sigue dentro de outer.
        $this->assertCount(1, $tree);
        $this->assertSame($outer_id, $tree[0]['id']);
    }

    public function test_move_element_deeply_nested_descendant_returns_circular_error(): void
    {
        // outer > a > b > c; intentar mover outer dentro de c.
        $tree = [];
        $this->writer->add_container($tree, 'root', 'last');
        $outer_id = $tree[0]['id'];
        $this->writer->add_container($tree, $outer_id, 'last');
        $a_id = $tree[0]['elements'][0]['id'];
        $this->writer->add_container($tree, $a_id, 'last');
        $b_id = $tree[0]['elements'][0]['elements'][0]['id'];
        $this->writer->add_container($tree, $b_id, 'last');
        $c_id = $tree[0]['elements'][0]['elements'][0]['elements'][0]['id'];

        $result = $this->writer->move_element($tree, $outer_id, $c_id, -1);

        $this->assertWPError($result, 'CIRCULAR_MOVE');
    }

    public function test_move_element_to_nonexistent_parent_returns_wp_error(): void
    {
        $tree = $this->make_tree_with_container();
        $result = $this->writer->move_element($tree, 'cnt0001', 'nonexistent', -1);

        $this->assertWPError($result, 'NEW_PARENT_NOT_FOUND');
    }

    // ─────────────────────────────────────────────────────────────────
    // regenerate_ids (helper de use_template / G5)
    // ─────────────────────────────────────────────────────────────────

    public function test_regenerate_ids_changes_all_ids(): void
    {
        $tree = [
            [
                'id' => 'orig000',
                'elType' => 'container',
                'settings' => ['default' => []],
                'elements' => [
                    [
                        'id' => 'orig001',
                        'elType' => 'widget',
                        'widgetType' => 'heading',
                        'settings' => ['title' => 'X'],
                        'elements' => [],
                    ],
                ],
            ],
        ];

        $new = $this->writer->regenerate_ids($tree);

        $this->assertNotSame('orig000', $new[0]['id']);
        $this->assertNotSame('orig001', $new[0]['elements'][0]['id']);
        $this->assertSame('X', $new[0]['elements'][0]['settings']['title'], 'Settings preserved');
        $this->assertSame('heading', $new[0]['elements'][0]['widgetType'], 'widgetType preserved');
    }

    public function test_regenerate_ids_on_empty_array(): void
    {
        $this->assertSame([], $this->writer->regenerate_ids([]));
    }

    // ─────────────────────────────────────────────────────────────────
    // serialize (Elementor 4.x compat)
    // ─────────────────────────────────────────────────────────────────

    public function test_serialize_emits_empty_settings_as_object(): void
    {
        $tree = [
            ['id' => 'cnt001', 'elType' => 'container', 'settings' => [], 'elements' => []],
        ];
        $json = $this->writer->serialize($tree);

        $this->assertStringContainsString('"settings":{}', $json);
        $this->assertStringNotContainsString('"settings":[]', $json);
    }

    public function test_serialize_preserves_actual_settings(): void
    {
        $tree = [
            [
                'id' => 'cnt001',
                'elType' => 'container',
                'settings' => ['flex_direction' => 'column'],
                'elements' => [],
            ],
        ];
        $json = $this->writer->serialize($tree);

        $this->assertStringContainsString('"flex_direction":"column"', $json);
    }

    /**
     * Helper: assert $value is WP_Error with given code.
     */
    private function assertWPError($value, ?string $code = null): void
    {
        $this->assertInstanceOf(\WP_Error::class, $value, 'Expected WP_Error');
        if ($code !== null) {
            $this->assertSame($code, $value->get_error_code());
        }
    }
}
