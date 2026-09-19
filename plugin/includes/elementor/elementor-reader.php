<?php
/**
 * Elementor_Reader
 *
 * Lee el formato `_elementor_data` (JSON) y lo expone como árbol PHP.
 *
 * El árbol tiene esta estructura:
 *   [
 *     ['id' => 'abc', 'elType' => 'container', 'settings' => [...], 'elements' => [...]],
 *     ...
 *   ]
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Elementor;

defined('ABSPATH') || exit;

final class Elementor_Reader
{
    /**
     * Parsea el JSON de _elementor_data y devuelve un array normalizado.
     *
     * @return array<int, array<string, mixed>>
     * @throws \InvalidArgumentException Si el JSON es inválido.
     */
    public function parse(string $json): array
    {
        if ('' === $json) {
            return [];
        }

        $data = json_decode($json, true);
        if (JSON_ERROR_NONE !== json_last_error()) {
            throw new \InvalidArgumentException('Invalid Elementor JSON: ' . json_last_error_msg());
        }

        if (!is_array($data)) {
            throw new \InvalidArgumentException('Elementor data must be a JSON array.');
        }

        return $this->normalize_tree($data);
    }

    /**
     * Busca un elemento por ID en el árbol.
     * Devuelve la referencia al nodo o null si no existe.
     *
     * @param array<int, array<string, mixed>> $tree
     * @return array<string, mixed>|null
     */
    public function find_by_id(array $tree, string $element_id): ?array
    {
        $found = null;
        $this->walk($tree, static function (array $node) use ($element_id, &$found): void {
            if (($node['id'] ?? null) === $element_id) {
                $found = $node;
            }
        });
        return $found;
    }

    /**
     * Busca un elemento por ID y devuelve su path (índices) en el árbol.
     * Útil para operaciones in-place como update/delete.
     *
     * @param array<int, array<string, mixed>> $tree
     * @return array<int, string>|null Array de claves (e.g. ['0', 'elements', '2'])
     */
    public function find_path_by_id(array $tree, string $element_id): ?array
    {
        return $this->find_path_recursive($tree, $element_id, []);
    }

    /**
     * Cuenta containers, widgets, imágenes, botones en el árbol.
     *
     * G2 fix: detecta automáticamente si el árbol es v3 (section+column) o v4 (container only)
     * y aplica la convención correcta. En v4, SOLO los nodos `container` cuentan como containers;
     * en v3, `section`, `column` y `container` (si los hay) cuentan.
     *
     * @param array<int, array<string, mixed>> $tree
     * @return array<string, int>
     */
    public function analyze(array $tree): array
    {
        $stats = [
            'containers'  => 0,
            'sections'    => 0,
            'columns'     => 0,
            'widgets'     => 0,
            'images'      => 0,
            'buttons'     => 0,
            'headings'    => 0,
            'total'       => 0,
            'layout_mode' => $this->detect_layout_mode($tree),
        ];

        $this->walk($tree, static function (array $node) use (&$stats): void {
            $stats['total']++;
            $elType = (string) ($node['elType'] ?? '');

            // Containers: en v4, solo `container`. En v3, también `section` y `column`.
            if ('container' === $elType) {
                $stats['containers']++;
                return;
            }
            if ('v3' === $stats['layout_mode']) {
                if ('section' === $elType) {
                    $stats['sections']++;
                    $stats['containers']++;
                    return;
                }
                if ('column' === $elType) {
                    $stats['columns']++;
                    $stats['containers']++;
                    return;
                }
            }

            if ('widget' === $elType) {
                $stats['widgets']++;
                $widget_type = (string) ($node['widgetType'] ?? '');
                if ('image' === $widget_type) {
                    $stats['images']++;
                } elseif ('button' === $widget_type) {
                    $stats['buttons']++;
                } elseif ('heading' === $widget_type) {
                    $stats['headings']++;
                }
            }
        });

        return $stats;
    }

    /**
     * Detecta si el árbol es v3 (section/column) o v4 (container only).
     * 'mixed' si contiene ambos.
     *
     * @param array<int, array<string, mixed>> $tree
     * @return 'v3'|'v4'|'mixed'
     */
    public function detect_layout_mode(array $tree): string
    {
        $has_section_or_column = false;
        $has_container = false;

        $this->walk($tree, static function (array $node) use (&$has_section_or_column, &$has_container): void {
            $elType = (string) ($node['elType'] ?? '');
            if ('section' === $elType || 'column' === $elType) {
                $has_section_or_column = true;
            } elseif ('container' === $elType) {
                $has_container = true;
            }
        });

        if ($has_section_or_column && $has_container) return 'mixed';
        if ($has_section_or_column) return 'v3';
        return 'v4';
    }

    /**
     * Normaliza un árbol (asegura que cada nodo tenga 'id', 'elType', 'settings', 'elements').
     *
     * @param array<int|string, mixed> $raw
     * @return array<int, array<string, mixed>>
     */
    private function normalize_tree(array $raw): array
    {
        $normalized = [];
        foreach ($raw as $node) {
            if (!is_array($node)) {
                continue;
            }
            $normalized[] = $this->normalize_node($node);
        }
        return $normalized;
    }

    /**
     * @param array<string, mixed> $node
     * @return array<string, mixed>
     */
    private function normalize_node(array $node): array
    {
        $id         = isset($node['id']) ? (string) $node['id'] : $this->generate_element_id();
        $elType     = isset($node['elType']) ? (string) $node['elType'] : 'widget';
        $settings   = isset($node['settings']) && is_array($node['settings']) ? $node['settings'] : [];
        $children   = isset($node['elements']) && is_array($node['elements']) ? $node['elements'] : [];

        $normalized = [
            'id'         => $id,
            'elType'     => $elType,
            'settings'   => $settings,
            'elements'   => $this->normalize_tree($children),
        ];

        if ('widget' === $elType && isset($node['widgetType'])) {
            $normalized['widgetType'] = (string) $node['widgetType'];
        }

        return $normalized;
    }

    /**
     * Recorre el árbol aplicando un callback a cada nodo.
     *
     * @param array<int, array<string, mixed>> $tree
     * @param callable $callback
     */
    public function walk(array $tree, callable $callback): void
    {
        foreach ($tree as $node) {
            $callback($node);
            if (!empty($node['elements']) && is_array($node['elements'])) {
                $this->walk($node['elements'], $callback);
            }
        }
    }

    /**
     * Busca el path de un elemento por ID de forma recursiva.
     *
     * @param array<int, array<string, mixed>> $tree
     * @param array<int, string> $current_path
     * @return array<int, string>|null
     */
    private function find_path_recursive(array $tree, string $element_id, array $current_path): ?array
    {
        foreach ($tree as $i => $node) {
            $path = array_merge($current_path, [(string) $i]);
            if (($node['id'] ?? null) === $element_id) {
                return $path;
            }
            if (!empty($node['elements']) && is_array($node['elements'])) {
                $found = $this->find_path_recursive($node['elements'], $element_id, array_merge($path, ['elements']));
                if (null !== $found) {
                    return $found;
                }
            }
        }
        return null;
    }

    /**
     * Genera un ID alfanumérico único para un nuevo elemento Elementor.
     */
    public function generate_element_id(): string
    {
        try {
            $bytes = random_bytes(7);
        } catch (\Throwable) {
            $bytes = '';
            for ($i = 0; $i < 7; $i++) {
                $bytes .= chr(mt_rand(0, 255));
            }
        }
        return substr(bin2hex($bytes), 0, 7);
    }
}
