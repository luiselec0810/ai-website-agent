<?php
/**
 * Elementor_Writer
 *
 * Aplica operaciones al árbol Elementor en memoria.
 * Cada operación modifica el árbol por referencia y devuelve true|WP_Error.
 *
 * Operaciones soportadas:
 *   - add_container(parent_id, position, settings)
 *   - add_widget(container_id, widget, position, settings)
 *   - update_widget(element_id, new_settings)
 *   - delete_element(element_id)
 *   - move_element(element_id, new_parent_id, position)
 *   - duplicate_element(element_id) → devuelve el nuevo ID
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Elementor;

defined('ABSPATH') || exit;

final class Elementor_Writer
{
    public function __construct(
        private Elementor_Reader $reader,
        private Elementor_Validator $validator
    ) {}

    /**
     * Default layout settings that Elementor 4.x expects inside `settings.default`.
     * Without this, Elementor opens the editor with an empty canvas (sees
     * `settings: {}` and shows "drag a widget here" but won't let you click +).
     *
     * @return array<string, mixed>
     */
    private function default_container_settings(): array
    {
        return [
            'default' => [
                'flexDirection'        => 'row',
                'flexWrap'             => 'wrap',
                'flexAlignItems'       => 'stretch',
                'flexGrow'             => 0,
                'flexShrink'           => 1,
                'flexBasis'            => 'auto',
                'flexOrder'            => 0,
                'flexBasisCustom'      => '',
                'position'             => 'relative',
                'zIndex'               => '',
                'inlineSize'           => '',
                'overflow'             => 'visible',
                'isLinked'             => true,
                '__globals__'          => [],
                'flexGrowCustom'       => '',
                'flexShrinkCustom'     => '',
                'gridAutoColumns'      => '',
                'gridAutoRows'         => '',
                'gridAutoFlow'         => '',
                'gridColumnGap'        => ['unit' => 'px', 'size' => 0, 'column' => '0'],
                'gridRowGap'           => ['unit' => 'px', 'size' => 0, 'row' => '0'],
                'gridColumn'           => 'auto',
                'gridColumnStart'      => 'auto',
                'gridColumnEnd'        => 'auto',
                'gridRow'              => 'auto',
                'gridRowStart'         => 'auto',
                'gridRowEnd'           => 'auto',
                'gridArea'             => '',
                'justifyItems'         => 'flex-start',
                'alignItems'           => 'flex-start',
                'justifyContent'       => 'flex-start',
                'alignContent'         => 'flex-start',
                'flexDirectionCustom'  => '',
                'flexWrapCustom'       => '',
                'gap'                  => ['unit' => 'px', 'size' => 0, 'column' => '0', 'row' => '0'],
            ],
            '_title'        => 'Container',
            'flex_direction' => 'row',
        ];
    }

    /**
     * Agrega un container al árbol.
     *
     * @param array<int, array<string, mixed>> $tree
     * @param string $parent_id   ID del container padre (o 'root' para nivel raíz).
     * @param string $position    'first' | 'last' | índice numérico.
     * @param array<string, mixed> $settings
     * @return string|\WP_Error ID del nuevo container.
     */
    public function add_container(array &$tree, string $parent_id, string $position, array $settings = []): string|\WP_Error
    {
        // Merge settings with Elementor's required `default` layout.
        $merged = array_merge($this->default_container_settings(), $settings);
        $new_container = [
            'id'       => $this->reader->generate_element_id(),
            'elType'   => 'container',
            'settings' => $merged,
            'elements' => [],
        ];

        if ('root' === $parent_id) {
            return $this->insert_at($tree, $position, $new_container);
        }

        $path = $this->reader->find_path_by_id($tree, $parent_id);
        if (null === $path) {
            return new \WP_Error('PARENT_NOT_FOUND', sprintf('Parent container "%s" not found.', $parent_id), ['status' => 404, 'parent_id' => $parent_id]);
        }

        $children = &$this->resolve_path($tree, $path, 'elements');
        if (null === $children) {
            return new \WP_Error('PARENT_NOT_FOUND', 'Cannot resolve parent children.', ['status' => 404]);
        }

        return $this->insert_at($children, $position, $new_container);
    }

    /**
     * Agrega un widget a un container.
     *
     * @param array<int, array<string, mixed>> $tree
     * @param string $container_id
     * @param string $widget_type
     * @param string $position
     * @param array<string, mixed> $settings
     * @return string|\WP_Error ID del nuevo widget.
     */
    public function add_widget(array &$tree, string $container_id, string $widget_type, string $position, array $settings = []): string|\WP_Error
    {
        if (!$this->validator->widget_exists($widget_type)) {
            return new \WP_Error('INVALID_WIDGET_TYPE', sprintf('Widget type "%s" is not available.', $widget_type), ['status' => 400, 'widget_type' => $widget_type]);
        }

        // G3 fix: validación por-widget (e.g. heading.header_size ∈ {h1..h6}, button.align ∈ {left,center,right,justify}).
        $settings_error = $this->validator->validate_settings($widget_type, $settings);
        if (is_wp_error($settings_error)) {
            return $settings_error;
        }

        $path = $this->reader->find_path_by_id($tree, $container_id);
        if (null === $path) {
            return new \WP_Error('CONTAINER_NOT_FOUND', sprintf('Container "%s" not found.', $container_id), ['status' => 404, 'container_id' => $container_id]);
        }

        $children = &$this->resolve_path($tree, $path, 'elements');
        if (null === $children) {
            return new \WP_Error('CONTAINER_NOT_FOUND', 'Cannot resolve container children.', ['status' => 404]);
        }

        $new_widget = [
            'id'         => $this->reader->generate_element_id(),
            'elType'     => 'widget',
            'widgetType' => $widget_type,
            'settings'   => $settings,
            'elements'   => [],
        ];

        return $this->insert_at($children, $position, $new_widget);
    }

    /**
     * Actualiza los settings de un elemento (widget o container).
     *
     * @param array<int, array<string, mixed>> $tree
     * @return bool|\WP_Error
     */
    public function update_widget(array &$tree, string $element_id, array $new_settings): bool|\WP_Error
    {
        $path = $this->reader->find_path_by_id($tree, $element_id);
        if (null === $path) {
            return new \WP_Error('ELEMENT_NOT_FOUND', sprintf('Element "%s" not found.', $element_id), ['status' => 404, 'element_id' => $element_id]);
        }

        $node = &$this->resolve_path($tree, $path);
        if (null === $node) {
            return new \WP_Error('ELEMENT_NOT_FOUND', 'Cannot resolve element.', ['status' => 404]);
        }

        // Si es widget, validar el widgetType.
        if (isset($node['widgetType'])) {
            if (!$this->validator->widget_exists((string) $node['widgetType'])) {
                return new \WP_Error('INVALID_WIDGET_TYPE', 'Widget type not available.', ['status' => 400]);
            }
        }

        // G7 fix: sanitizar settings antes del merge. Si un valor es array pero
        // contiene entradas no-escalares que fallen al serializar, descartamos
        // ese campo en lugar de tirar 500.
        $sanitized = $this->sanitize_settings_for_merge($new_settings);
        if (is_wp_error($sanitized)) {
            return $sanitized;
        }

        // Merge: preservar campos que no están en new_settings (especialmente responsive).
        $node['settings'] = array_merge((array) ($node['settings'] ?? []), $sanitized);

        return true;
    }

    /**
     * Sanitiza $settings antes de mergear con los existentes.
     *
     * G7: descarta entradas con valores que no se pueden serializar a JSON de forma
     * segura (recursos PHP, objetos circulares, valores con referencias inválidas).
     * Antes del fix, un único valor no-serializable dentro de un sub-array
     * (e.g. `image.url = "http://..."` que viniera como resource por error de upstream)
     * hacía que `wp_json_encode` fallara al guardar `_elementor_data`, lo que rompía
     * la página completa en lugar de rechazar la operación específica.
     *
     * @param array<string, mixed> $settings
     * @return array<string, mixed>|\WP_Error
     */
    private function sanitize_settings_for_merge(array $settings): array|\WP_Error
    {
        foreach ($settings as $key => $value) {
            // Permitimos null, bool, int, float, string — son todos JSON-seguros.
            if (null === $value || is_bool($value) || is_int($value) || is_float($value) || is_string($value)) {
                continue;
            }
            // Arrays anidados: recursar; si algo interno falla, descartar ese campo.
            if (is_array($value)) {
                $clean = [];
                foreach ($value as $k => $v) {
                    if (null === $v || is_bool($v) || is_int($v) || is_float($v) || is_string($v) || is_array($v)) {
                        $clean[$k] = $v;
                    }
                    // Cualquier otro tipo (object, resource) se descarta silenciosamente
                    // para no romper el guardado por un valor mal formado.
                }
                $settings[$key] = $clean;
                continue;
            }
            // Objetos / recursos: descartar el campo entero (no podemos serializarlo).
            unset($settings[$key]);
        }
        // Verificación final: el payload completo debe poder serializarse.
        $probe = wp_json_encode($settings);
        if (false === $probe) {
            return new \WP_Error(
                'INVALID_SETTINGS',
                'Settings contain non-serializable values.',
                ['status' => 400]
            );
        }
        return $settings;
    }

    /**
     * Elimina un elemento (y todos sus hijos).
     *
     * @param array<int, array<string, mixed>> $tree
     * @return bool|\WP_Error
     */
    public function delete_element(array &$tree, string $element_id): bool|\WP_Error
    {
        // Buscar el path.
        $path = $this->reader->find_path_by_id($tree, $element_id);
        if (null === $path) {
            return new \WP_Error('ELEMENT_NOT_FOUND', sprintf('Element "%s" not found.', $element_id), ['status' => 404, 'element_id' => $element_id]);
        }

        if (count($path) <= 1) {
            // Es elemento raíz.
            foreach ($tree as $i => $node) {
                if (($node['id'] ?? null) === $element_id) {
                    array_splice($tree, (int) $i, 1);
                    return true;
                }
            }
            return new \WP_Error('ELEMENT_NOT_FOUND', 'Cannot remove root element.', ['status' => 404]);
        }

        // Resolver el padre y eliminar el hijo.
        $parent_path = $path;
        $last_key    = (int) array_pop($parent_path);

        $children = &$this->resolve_path($tree, $parent_path);
        if (null === $children || !is_array($children)) {
            return new \WP_Error('PARENT_NOT_FOUND', 'Cannot resolve parent.', ['status' => 404]);
        }

        if (!isset($children[$last_key])) {
            return new \WP_Error('ELEMENT_NOT_FOUND', 'Element index out of bounds.', ['status' => 404]);
        }

        array_splice($children, $last_key, 1);
        return true;
    }

    /**
     * Mueve un elemento a otro parent en una posición específica.
     *
     * @param array<int, array<string, mixed>> $tree
     * @return bool|\WP_Error
     */
    public function move_element(array &$tree, string $element_id, string $new_parent_id, int $position): bool|\WP_Error
    {
        // Encontrar el elemento actual.
        $node = $this->reader->find_by_id($tree, $element_id);
        if (null === $node) {
            return new \WP_Error('ELEMENT_NOT_FOUND', sprintf('Element "%s" not found.', $element_id), ['status' => 404, 'element_id' => $element_id]);
        }

        // G4 fix: rechazar movimientos circulares antes de mutar el árbol.
        // Sin esta guarda, mover un elemento a sí mismo o a un descendiente
        // lo perdería silenciosamente (delete-then-insert elimina el nodo).
        if ($element_id === $new_parent_id) {
            return new \WP_Error('CIRCULAR_MOVE', 'Cannot move an element into itself.', [
                'status'        => 409,
                'element_id'    => $element_id,
                'new_parent_id' => $new_parent_id,
            ]);
        }
        if ('root' !== $new_parent_id && $this->is_descendant_of($tree, $new_parent_id, $element_id)) {
            return new \WP_Error('CIRCULAR_MOVE', 'Cannot move an element into one of its descendants.', [
                'status'        => 409,
                'element_id'    => $element_id,
                'new_parent_id' => $new_parent_id,
            ]);
        }

        // Eliminarlo del lugar actual (copia profunda).
        $deleted = $this->delete_element($tree, $element_id);
        if (is_wp_error($deleted)) {
            return $deleted;
        }

        // Re-insertar en el nuevo parent.
        if ('root' === $new_parent_id) {
            $target = &$tree;
        } else {
            $parent_path = $this->reader->find_path_by_id($tree, $new_parent_id);
            if (null === $parent_path) {
                return new \WP_Error('NEW_PARENT_NOT_FOUND', sprintf('New parent "%s" not found.', $new_parent_id), ['status' => 404, 'new_parent_id' => $new_parent_id]);
            }
            $target = &$this->resolve_path($tree, $parent_path, 'elements');
            if (null === $target) {
                return new \WP_Error('NEW_PARENT_NOT_FOUND', 'Cannot resolve new parent children.', ['status' => 404]);
            }
        }

        // Insertar respetando el índice.
        if ($position < 0 || $position > count($target)) {
            $position = count($target); // "last"
        }
        array_splice($target, $position, 0, [$node]);

        return true;
    }

    /**
     * Duplica un elemento (genera nuevos IDs para él y todos sus hijos).
     *
     * @param array<int, array<string, mixed>> $tree
     * @return string|\WP_Error El ID del nuevo elemento.
     */
    public function duplicate_element(array &$tree, string $element_id): string|\WP_Error
    {
        $path = $this->reader->find_path_by_id($tree, $element_id);
        if (null === $path) {
            return new \WP_Error('ELEMENT_NOT_FOUND', sprintf('Element "%s" not found.', $element_id), ['status' => 404, 'element_id' => $element_id]);
        }

        $node = $this->reader->find_by_id($tree, $element_id);
        $copy = $this->deep_copy_with_new_ids($node);

        // Insertar después del elemento original.
        if (count($path) <= 1) {
            $parent_array = &$tree;
            $insert_index = (int) $path[0] + 1;
        } else {
            $parent_path = $path;
            array_pop($parent_path);
            $parent_array = &$this->resolve_path($tree, $parent_path);
            $insert_index = (int) $path[count($path) - 1] + 1;
        }

        if (null === $parent_array) {
            return new \WP_Error('PARENT_NOT_FOUND', 'Cannot resolve parent for insertion.', ['status' => 404]);
        }

        array_splice($parent_array, $insert_index, 0, [$copy]);

        return $copy['id'];
    }

    /**
     * Serializa el árbol de vuelta a JSON.
     *
     * Elementor 4.x requires each node's `settings` to be a JSON object (`{}`),
     * not an empty array (`[]`). wp_json_encode serializes PHP arrays as `[]`
     * even when we cast to (object), so we hand-roll the encoder to guarantee
     * `settings` is always emitted as an object.
     */
    public function serialize(array $tree): string
    {
        $parts = [];
        foreach ($tree as $node) {
            $parts[] = $this->encode_node($node);
        }
        return '[' . implode(',', $parts) . ']';
    }

    /**
     * @param array<string, mixed> $node
     */
    private function encode_node(array $node): string
    {
        $parts = [];

        $parts[] = '"id":"' . $this->escape_json((string) ($node['id'] ?? '')) . '"';
        $parts[] = '"elType":"' . $this->escape_json((string) ($node['elType'] ?? 'widget')) . '"';

        // settings: always emit `{}` for empty arrays.
        $settings = $node['settings'] ?? [];
        if (empty($settings)) {
            $parts[] = '"settings":{}';
        } else {
            $parts[] = '"settings":' . wp_json_encode($settings, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        if (isset($node['widgetType'])) {
            $parts[] = '"widgetType":"' . $this->escape_json((string) $node['widgetType']) . '"';
        }

        // elements: recurse; always `[]` if empty.
        $elements = $node['elements'] ?? [];
        if (empty($elements)) {
            $parts[] = '"elements":[]';
        } else {
            $inner = [];
            foreach ($elements as $child) {
                $inner[] = $this->encode_node($child);
            }
            $parts[] = '"elements":[' . implode(',', $inner) . ']';
        }

        return '{' . implode(',', $parts) . '}';
    }

    private function escape_json(string $s): string
    {
        // Escape double quotes and backslashes minimally for JSON.
        return str_replace(['\\', '"'], ['\\\\', '\\"'], $s);
    }

    /**
     * Inserta un nodo en un array en una posición ('first', 'last', o índice numérico).
     *
     * @param array<int, mixed> $list
     * @param array<string, mixed> $node
     * @return string El ID del nodo insertado.
     */
    private function insert_at(array &$list, string $position, array $node): string
    {
        $new_id = (string) $node['id'];
        if ('first' === $position || 0 === $position) {
            array_unshift($list, $node);
        } elseif ('last' === $position || -1 === (int) $position) {
            $list[] = $node;
        } else {
            $idx = max(0, min((int) $position, count($list)));
            array_splice($list, $idx, 0, [$node]);
        }
        return $new_id;
    }

    /**
     * Resuelve un path (e.g. ['0', 'elements', '2']) en el árbol, devolviendo
     * una referencia al nodo o a sus 'elements' hijos.
     *
     * @param array<int|string, mixed> $tree
     * @param array<int, string> $path
     * @return array<int|string, mixed>|null
     */
    private function &resolve_path(array &$tree, array $path, ?string $children_key = null): ?array
    {
        $current = &$tree;
        foreach ($path as $key) {
            if (!isset($current[$key]) || !is_array($current[$key])) {
                $null = null;
                return $null;
            }
            $current = &$current[$key];
        }
        if (null !== $children_key) {
            if (!isset($current[$children_key]) || !is_array($current[$children_key])) {
                $current[$children_key] = [];
            }
            $children = &$current[$children_key];
            return $children;
        }
        return $current;
    }

    /**
     * Copia profunda de un nodo con nuevos IDs.
     *
     * @param array<string, mixed> $node
     * @return array<string, mixed>
     */
    private function deep_copy_with_new_ids(array $node): array
    {
        $copy = [
            'id'       => $this->reader->generate_element_id(),
            'elType'   => $node['elType'],
            'settings' => $node['settings'] ?? [],
            'elements' => [],
        ];
        if (isset($node['widgetType'])) {
            $copy['widgetType'] = $node['widgetType'];
        }
        foreach ($node['elements'] ?? [] as $child) {
            $copy['elements'][] = $this->deep_copy_with_new_ids($child);
        }
        return $copy;
    }

    /**
     * Determina si $candidate_id es descendiente de $ancestor_id en el árbol.
     * Usado por move_element (G4) para detectar movimientos circulares.
     *
     * @param array<int, array<string, mixed>> $tree
     */
    private function is_descendant_of(array &$tree, string $candidate_id, string $ancestor_id): bool
    {
        $ancestor = $this->reader->find_by_id($tree, $ancestor_id);
        if (null === $ancestor) {
            return false;
        }
        return $this->subtree_contains_id($ancestor, $candidate_id);
    }

    /**
     * Recorre recursivamente un subárbol buscando un nodo con el ID dado.
     *
     * @param array<string, mixed> $node
     */
    private function subtree_contains_id(array $node, string $target_id): bool
    {
        if (($node['id'] ?? null) === $target_id) {
            return true;
        }
        foreach ($node['elements'] ?? [] as $child) {
            if ($this->subtree_contains_id($child, $target_id)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Clona los nodos de un árbol regenerando todos los IDs (G5 helper para use_template).
     * Diferencia con deep_copy_with_new_ids: aquí regeneramos IDs pero preservamos el árbol completo.
     *
     * @param array<int, array<string, mixed>> $nodes
     * @return array<int, array<string, mixed>>
     */
    public function regenerate_ids(array $nodes): array
    {
        $out = [];
        foreach ($nodes as $node) {
            $copy = [
                'id'       => $this->reader->generate_element_id(),
                'elType'   => $node['elType'] ?? 'widget',
                'settings' => $node['settings'] ?? [],
                'elements' => isset($node['elements']) && is_array($node['elements'])
                    ? $this->regenerate_ids($node['elements'])
                    : [],
            ];
            if (isset($node['widgetType'])) {
                $copy['widgetType'] = $node['widgetType'];
            }
            $out[] = $copy;
        }
        return $out;
    }
}
