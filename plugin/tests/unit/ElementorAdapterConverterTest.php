<?php
/**
 * Tests para el container converter (Elementor_Adapter::convert_tree_recursive).
 *
 * Cubre:
 *   - section con columns → wrapper container row + un container por column.
 *   - section sin columns → container simple.
 *   - column huérfana top-level → container simple.
 *   - widgets sueltos → preservados.
 *   - recursión en sections anidadas.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\Elementor\Elementor_Adapter;
use PHPUnit\Framework\TestCase;

final class ElementorAdapterConverterTest extends TestCase
{
    private Elementor_Adapter $adapter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->adapter = new Elementor_Adapter();
    }

    public function test_section_with_two_columns_becomes_row_with_two_containers(): void
    {
        $tree = [
            [
                'id' => 'sct001',
                'elType' => 'section',
                'settings' => [],
                'elements' => [
                    ['id' => 'col001', 'elType' => 'column', 'settings' => [], 'elements' => []],
                    ['id' => 'col002', 'elType' => 'column', 'settings' => [], 'elements' => []],
                ],
            ],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);
        $new_tree = $result['tree'];

        $this->assertCount(1, $new_tree, 'Should produce one wrapper container');
        $wrapper = $new_tree[0];
        $this->assertSame('container', $wrapper['elType']);
        $this->assertSame('row', $wrapper['settings']['flex_direction']);

        $this->assertCount(2, $wrapper['elements'], 'Wrapper should contain 2 column containers');
        foreach ($wrapper['elements'] as $col_container) {
            $this->assertSame('container', $col_container['elType']);
            $this->assertArrayHasKey('id', $col_container);
        }

        $this->assertSame(1, $result['stats']['sections_converted']);
        $this->assertSame(2, $result['stats']['columns_converted']);
    }

    public function test_section_without_columns_becomes_simple_container(): void
    {
        $tree = [
            [
                'id' => 'sct001',
                'elType' => 'section',
                'settings' => [],
                'elements' => [
                    ['id' => 'wdg001', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [], 'elements' => []],
                ],
            ],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);
        $new_tree = $result['tree'];

        $this->assertCount(1, $new_tree);
        $container = $new_tree[0];
        $this->assertSame('container', $container['elType']);
        $this->assertCount(1, $container['elements']);
        $this->assertSame('heading', $container['elements'][0]['widgetType']);
        $this->assertSame(1, $result['stats']['sections_converted']);
        $this->assertSame(0, $result['stats']['columns_converted']);
    }

    public function test_orphan_top_level_column_becomes_container(): void
    {
        $tree = [
            ['id' => 'col001', 'elType' => 'column', 'settings' => [], 'elements' => []],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);

        $this->assertCount(1, $result['tree']);
        $this->assertSame('container', $result['tree'][0]['elType']);
        $this->assertSame(0, $result['stats']['sections_converted']);
        $this->assertSame(1, $result['stats']['columns_converted']);
    }

    public function test_widgets_are_preserved_with_new_settings(): void
    {
        $tree = [
            [
                'id' => 'cnt001',
                'elType' => 'container',
                'settings' => ['flex_direction' => 'column'],
                'elements' => [
                    ['id' => 'wdg001', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => ['title' => 'Hola'], 'elements' => []],
                ],
            ],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);
        $container = $result['tree'][0];
        $this->assertSame('container', $container['elType'], 'Existing container preserved');
        $this->assertSame('column', $container['settings']['flex_direction'], 'Settings preserved');
        $this->assertSame('heading', $container['elements'][0]['widgetType']);
        $this->assertSame('Hola', $container['elements'][0]['settings']['title']);
    }

    public function test_nested_sections_are_converted_recursively(): void
    {
        // outer section > inner section > column > heading
        $tree = [
            [
                'id' => 'sct001',
                'elType' => 'section',
                'settings' => [],
                'elements' => [
                    [
                        'id' => 'sct002',
                        'elType' => 'section',
                        'settings' => [],
                        'elements' => [
                            ['id' => 'col001', 'elType' => 'column', 'settings' => [], 'elements' => [
                                ['id' => 'hdg001', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [], 'elements' => []],
                            ]],
                        ],
                    ],
                ],
            ],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);
        $outer = $result['tree'][0];
        $this->assertSame('container', $outer['elType']);
        $this->assertSame(2, $result['stats']['sections_converted']);
        $this->assertSame(1, $result['stats']['columns_converted']);
    }

    public function test_empty_tree_returns_empty_tree(): void
    {
        $result = $this->adapter->convert_tree_recursive([]);
        $this->assertSame([], $result['tree']);
        $this->assertSame(0, $result['stats']['sections_converted']);
        $this->assertSame(0, $result['stats']['columns_converted']);
    }

    public function test_new_container_ids_are_unique(): void
    {
        $tree = [
            ['id' => 'sct001', 'elType' => 'section', 'settings' => [], 'elements' => [
                ['id' => 'col001', 'elType' => 'column', 'settings' => [], 'elements' => []],
                ['id' => 'col002', 'elType' => 'column', 'settings' => [], 'elements' => []],
                ['id' => 'col003', 'elType' => 'column', 'settings' => [], 'elements' => []],
            ]],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);
        $wrapper = $result['tree'][0];
        $new_ids = [$wrapper['id']];
        foreach ($wrapper['elements'] as $col) {
            $new_ids[] = $col['id'];
        }

        $this->assertCount(4, $new_ids);
        $this->assertCount(4, array_unique($new_ids), 'All new container IDs must be unique');
        $this->assertNotContains('sct001', $new_ids, 'Original section ID should not appear');
        $this->assertNotContains('col001', $new_ids, 'Original column IDs should not appear');
    }

    public function test_mixed_tree_converts_only_section_and_column_nodes(): void
    {
        $tree = [
            ['id' => 'cnt001', 'elType' => 'container', 'settings' => [], 'elements' => []],
            ['id' => 'sct001', 'elType' => 'section', 'settings' => [], 'elements' => [
                ['id' => 'col001', 'elType' => 'column', 'settings' => [], 'elements' => []],
            ]],
            ['id' => 'wdg001', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [], 'elements' => []],
        ];

        $result = $this->adapter->convert_tree_recursive($tree);

        $this->assertCount(3, $result['tree']);
        // Original container stays as container.
        $this->assertSame('container', $result['tree'][0]['elType']);
        // Section becomes wrapper container.
        $this->assertSame('container', $result['tree'][1]['elType']);
        $this->assertCount(1, $result['tree'][1]['elements']);
        // Widget stays as widget.
        $this->assertSame('widget', $result['tree'][2]['elType']);
        $this->assertSame('heading', $result['tree'][2]['widgetType']);
    }
}
