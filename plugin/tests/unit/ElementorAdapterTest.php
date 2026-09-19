<?php
/**
 * Tests para Elementor_Adapter::collect_ids_recursive.
 *
 * Cubre:
 *   - árbol vacío → [].
 *   - árbol de un solo nodo → [id].
 *   - árbol anidado (containers + widgets) → todos los IDs en DFS pre-order.
 *   - nodos sin `id` o con `elements` mal formado no rompen el flatten.
 *   - el orden es estable para que el orquestador pueda resolver
 *     `{{element_id:N}}` apuntando a widgets internos tras use_template.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\Elementor\Elementor_Adapter;
use PHPUnit\Framework\TestCase;

final class ElementorAdapterTest extends TestCase
{
    private Elementor_Adapter $adapter;

    protected function setUp(): void
    {
        parent::setUp();
        $this->adapter = new Elementor_Adapter();
    }

    public function test_collect_ids_recursive_returns_empty_for_empty_tree(): void
    {
        $this->assertSame([], $this->adapter->collect_ids_recursive([]));
    }

    public function test_collect_ids_recursive_returns_single_id(): void
    {
        $tree = [
            ['id' => 'cnt0001', 'elType' => 'container', 'settings' => [], 'elements' => []],
        ];
        $this->assertSame(['cnt0001'], $this->adapter->collect_ids_recursive($tree));
    }

    public function test_collect_ids_recursive_flattens_full_tree_in_dfs_preorder(): void
    {
        // Estructura:
        //   root container (cnt00a)
        //   ├── inner container (cnt00b)
        //   │   ├── widget heading (wid001)
        //   │   └── widget image (wid002)
        //   └── widget video (wid003)
        $tree = [
            [
                'id' => 'cnt00a',
                'elType' => 'container',
                'settings' => [],
                'elements' => [
                    [
                        'id' => 'cnt00b',
                        'elType' => 'container',
                        'settings' => [],
                        'elements' => [
                            ['id' => 'wid001', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [], 'elements' => []],
                            ['id' => 'wid002', 'elType' => 'widget', 'widgetType' => 'image', 'settings' => [], 'elements' => []],
                        ],
                    ],
                    ['id' => 'wid003', 'elType' => 'widget', 'widgetType' => 'video', 'settings' => [], 'elements' => []],
                ],
            ],
        ];

        $ids = $this->adapter->collect_ids_recursive($tree);

        // DFS pre-order: padre antes que hijos, preservando el orden de los
        // hermanos tal como aparecen en el árbol original.
        $this->assertSame(['cnt00a', 'cnt00b', 'wid001', 'wid002', 'wid003'], $ids);
    }

    public function test_collect_ids_recursive_preserves_order_with_multiple_top_level_nodes(): void
    {
        // Dos contenedores top-level, cada uno con un widget interno.
        $tree = [
            ['id' => 'cnt001', 'elType' => 'container', 'settings' => [], 'elements' => [
                ['id' => 'wid001', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [], 'elements' => []],
            ]],
            ['id' => 'cnt002', 'elType' => 'container', 'settings' => [], 'elements' => [
                ['id' => 'wid002', 'elType' => 'widget', 'widgetType' => 'button', 'settings' => [], 'elements' => []],
            ]],
        ];

        $this->assertSame(
            ['cnt001', 'wid001', 'cnt002', 'wid002'],
            $this->adapter->collect_ids_recursive($tree)
        );
    }

    public function test_collect_ids_recursive_handles_nodes_missing_id(): void
    {
        // Defensivo: si por alguna razón un nodo no trae `id` (no debería
        // pasar con regenerate_ids, pero el helper es público y puede
        // recibir datos de fuera), no debe romper el flatten.
        $tree = [
            ['id' => 'cnt0001', 'elType' => 'container', 'settings' => [], 'elements' => [
                ['elType' => 'widget', 'widgetType' => 'heading', 'settings' => []], // sin id
                ['id' => 'wid0002', 'elType' => 'widget', 'widgetType' => 'image', 'settings' => [], 'elements' => []],
            ]],
        ];

        $this->assertSame(['cnt0001', 'wid0002'], $this->adapter->collect_ids_recursive($tree));
    }

    public function test_collect_ids_recursive_skips_non_array_nodes(): void
    {
        $tree = [
            ['id' => 'cnt0001', 'elType' => 'container', 'settings' => [], 'elements' => []],
            'string_no_es_nodo',
            null,
            ['id' => 'cnt0002', 'elType' => 'container', 'settings' => [], 'elements' => []],
        ];

        $this->assertSame(['cnt0001', 'cnt0002'], $this->adapter->collect_ids_recursive($tree));
    }

    public function test_collect_ids_recursive_handles_deeply_nested_tree(): void
    {
        // Anidamiento de 4 niveles con un widget hoja.
        $leaf = ['id' => 'widdeep', 'elType' => 'widget', 'widgetType' => 'heading', 'settings' => [], 'elements' => []];
        $level4 = ['id' => 'cnt0004', 'elType' => 'container', 'settings' => [], 'elements' => [$leaf]];
        $level3 = ['id' => 'cnt0003', 'elType' => 'container', 'settings' => [], 'elements' => [$level4]];
        $level2 = ['id' => 'cnt0002', 'elType' => 'container', 'settings' => [], 'elements' => [$level3]];
        $level1 = ['id' => 'cnt0001', 'elType' => 'container', 'settings' => [], 'elements' => [$level2]];

        $this->assertSame(
            ['cnt0001', 'cnt0002', 'cnt0003', 'cnt0004', 'widdeep'],
            $this->adapter->collect_ids_recursive([$level1])
        );
    }
}
