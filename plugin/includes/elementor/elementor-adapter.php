<?php
/**
 * Elementor_Adapter
 *
 * Fachada que combina Reader + Writer + Validator.
 * Es la única clase que el Controller debería usar directamente.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Elementor;

defined('ABSPATH') || exit;

final class Elementor_Adapter
{
    private Elementor_Reader $reader;
    private Elementor_Writer $writer;
    private Elementor_Validator $validator;

    public function __construct()
    {
        $this->reader    = new Elementor_Reader();
        $this->validator = new Elementor_Validator();
        $this->writer    = new Elementor_Writer($this->reader, $this->validator);
    }

    public function reader(): Elementor_Reader
    {
        return $this->reader;
    }

    public function validator(): Elementor_Validator
    {
        return $this->validator;
    }

    /**
     * Lee la estructura Elementor de una página.
     *
     * @return array<string, mixed>|\WP_Error
     */
    public function get_structure(int $page_id): array|\WP_Error
    {
        $post = get_post($page_id);
        if (!$post || 'page' !== $post->post_type) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['status' => 404, 'page_id' => $page_id]);
        }

        if (!$this->validator->is_elementor_active()) {
            return new \WP_Error('ELEMENTOR_NOT_ACTIVE', 'Elementor is not installed or active on this site.', ['status' => 503]);
        }

        $json = (string) get_post_meta($page_id, '_elementor_data', true);
        try {
            $tree = $this->reader->parse($json);
        } catch (\InvalidArgumentException $e) {
            return new \WP_Error('INVALID_ELEMENTOR_DATA', $e->getMessage(), ['status' => 500, 'page_id' => $page_id]);
        }

        $edit_mode = get_post_meta($page_id, '_elementor_edit_mode', true);

        // Force `settings` to be a JSON object (`{}`) instead of array (`[]`).
        // Elementor 4.x rejects the builder data if `settings` is `[]`.
        $tree = $this->force_object_settings($tree);

        return [
            'page_id'      => $page_id,
            'elementor'    => 'builder' === $edit_mode,
            'version'      => $this->validator->elementor_version(),
            'content'      => $tree,
            'analysis'     => $this->reader->analyze($tree),
            'available_widgets' => $this->validator->available_widgets(),
        ];
    }

    /**
     * Force-converts each node's `settings` to a stdClass so wp_json_encode serializes it as `{}`.
     *
     * Elementor 4.x loads `settings` and expects a JSON object. An empty array `[]`
     * makes the editor render an empty canvas.
     *
     * @param array<int, array<string, mixed>> $tree
     * @return array<int, array<string, mixed>>
     */
    private function force_object_settings(array $tree): array
    {
        return array_map(function (array $node) {
            $settings = $node['settings'] ?? [];
            if (is_array($settings)) {
                $node['settings'] = empty($settings) ? new \stdClass() : (object) $settings;
            } elseif (is_object($settings)) {
                $node['settings'] = $settings;
            }
            if (!empty($node['elements']) && is_array($node['elements'])) {
                $node['elements'] = $this->force_object_settings($node['elements']);
            }
            return $node;
        }, $tree);
    }

    /**
     * Aplica una operación y guarda el resultado en `_elementor_data`.
     *
     * @param callable $operation Closure que modifica el árbol: function(array &$tree): string|bool|WP_Error
     * @return array<string, mixed>|\WP_Error
     */
    public function apply_and_save(int $page_id, callable $operation): array|\WP_Error
    {
        if (!$this->validator->is_elementor_active()) {
            return new \WP_Error('ELEMENTOR_NOT_ACTIVE', 'Elementor is not installed or active.', ['status' => 503]);
        }

        $json = (string) get_post_meta($page_id, '_elementor_data', true);
        try {
            $tree = $this->reader->parse($json);
        } catch (\InvalidArgumentException $e) {
            return new \WP_Error('INVALID_ELEMENTOR_DATA', $e->getMessage(), ['status' => 500]);
        }

        $before_state = $tree;
        $result = $operation($tree);

        if (is_wp_error($result)) {
            return $result;
        }

        $new_json = $this->writer->serialize($tree);

        // G7 fix: si el writer no pudo serializar (wp_json_encode devolvió false),
        // abortar con un error claro en vez de guardar JSON corrupto a `_elementor_data`.
        if (!is_string($new_json) || '' === $new_json) {
            return new \WP_Error(
                'SERIALIZE_FAILED',
                'Failed to serialize Elementor data. Settings may contain non-encodable values.',
                ['status' => 500, 'page_id' => $page_id]
            );
        }

        $saved = update_post_meta($page_id, '_elementor_data', $new_json);

        if (false === $saved && $new_json !== $json) {
            return new \WP_Error('WRITE_FAILED', 'Failed to save _elementor_data.', ['status' => 500, 'page_id' => $page_id]);
        }

        // Limpiar caché de Elementor si existe.
        if (class_exists('\Elementor\Plugin')) {
            try {
                \Elementor\Plugin::instance()->files_manager->clear_cache();
            } catch (\Throwable) {
                // No es crítico.
            }
        }

        return [
            'page_id'      => $page_id,
            'before'       => $before_state,
            'after'        => $tree,
            'result'       => $result,
            'new_element_id' => is_string($result) ? $result : null,
        ];
    }

    // ─────────────────────────────────────────────────────────────────
    // Wrappers semánticos (usados por el Controller)
    // ─────────────────────────────────────────────────────────────────

    public function add_container(int $page_id, string $parent_id, string $position, array $settings): array|\WP_Error
    {
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($parent_id, $position, $settings): string|\WP_Error {
                return $this->writer->add_container($tree, $parent_id, $position, $settings);
            }
        );
    }

    public function add_widget(int $page_id, string $container_id, string $widget_type, string $position, array $settings): array|\WP_Error
    {
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($container_id, $widget_type, $position, $settings): string|\WP_Error {
                return $this->writer->add_widget($tree, $container_id, $widget_type, $position, $settings);
            }
        );
    }

    public function update_widget(int $page_id, string $element_id, array $new_settings): array|\WP_Error
    {
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($element_id, $new_settings): bool|\WP_Error {
                // Validación defensiva (bug 2026-09-16): si el LLM manda keys de
                // widget a un container/section, el writer escribe settings
                // basura en el container y devuelve 200 OK — el orquestador
                // reporta `success` pero la página queda rota silenciosamente.
                // Rechazamos antes para devolver un WP_Error explícito.
                $node = $this->reader->find_by_id($tree, $element_id);
                if (null === $node) {
                    // No encontrado: lo dejamos al writer que ya devuelve
                    // `ELEMENT_NOT_FOUND` con mensaje específico.
                    return $this->writer->update_widget($tree, $element_id, $new_settings);
                }
                $elType = (string) ($node['elType'] ?? '');
                if ('widget' !== $elType) {
                    $widget_only_keys = [
                        'image', 'images', 'gallery', 'slides',
                        'video_type', 'hosted_url', 'youtube_url',
                        'vimeo_url', 'dailymotion_url', 'poster',
                        'html', 'icon', 'social_icon',
                    ];
                    $offending = array_values(array_intersect_key(
                        $new_settings,
                        array_flip($widget_only_keys)
                    ));
                    // Solo bloqueamos si hay keys reservadas de widget —
                    // otras (p.ej. `flex_direction` para containers) son válidas.
                    if (!empty($offending)) {
                        $key_list = implode(', ', array_keys($offending));
                        return new \WP_Error(
                            'NOT_A_WIDGET',
                            sprintf(
                                'Element "%s" is a "%s", not a widget. Cannot apply widget-only settings (%s). Verify `{{element_id:N}}` points to a widget, not its parent container.',
                                $element_id,
                                $elType,
                                $key_list
                            ),
                            [
                                'status'     => 400,
                                'element_id' => $element_id,
                                'elType'     => $elType,
                                'offending_keys' => array_keys($offending),
                            ]
                        );
                    }
                }
                return $this->writer->update_widget($tree, $element_id, $new_settings);
            }
        );
    }

    public function delete_element(int $page_id, string $element_id): array|\WP_Error
    {
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($element_id): bool|\WP_Error {
                return $this->writer->delete_element($tree, $element_id);
            }
        );
    }

    public function duplicate_element(int $page_id, string $element_id): array|\WP_Error
    {
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($element_id): string|\WP_Error {
                return $this->writer->duplicate_element($tree, $element_id);
            }
        );
    }

    public function move_element(int $page_id, string $element_id, string $new_parent_id, int $position): array|\WP_Error
    {
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($element_id, $new_parent_id, $position): bool|\WP_Error {
                return $this->writer->move_element($tree, $element_id, $new_parent_id, $position);
            }
        );
    }

    /**
     * Convierte una página del modelo section+column (legacy v3) al modelo container (v4).
     *
     * Estrategia:
     *   - Cada `section` con `columns` → se reemplaza por un container wrapper con
     *     `flex_direction: row` que contiene un container por cada column.
     *   - Cada `section` sin `columns` (solo widgets directos) → se convierte a un
     *     container simple con los mismos elementos.
     *   - Cada `column` huérfana (top-level) → se convierte a container simple.
     *   - Otros nodos se preservan tal cual pero se procesan recursivamente.
     *
     * @return array<string, mixed>|\WP_Error
     */
    public function convert_to_containers(int $page_id): array|\WP_Error
    {
        if (!$this->validator->is_elementor_active()) {
            return new \WP_Error('ELEMENTOR_NOT_ACTIVE', 'Elementor is not installed or active.', ['status' => 503]);
        }

        $json = (string) get_post_meta($page_id, '_elementor_data', true);
        try {
            $tree = $this->reader->parse($json);
        } catch (\InvalidArgumentException $e) {
            return new \WP_Error('INVALID_ELEMENTOR_DATA', $e->getMessage(), ['status' => 500, 'page_id' => $page_id]);
        }

        $result = $this->convert_tree_recursive($tree);
        $new_json = $this->writer->serialize($result['tree']);
        $saved = update_post_meta($page_id, '_elementor_data', $new_json);

        if (false === $saved && $new_json !== $json) {
            return new \WP_Error('WRITE_FAILED', 'Failed to save _elementor_data.', ['status' => 500, 'page_id' => $page_id]);
        }

        // Limpiar caché.
        if (class_exists('\Elementor\Plugin')) {
            try {
                \Elementor\Plugin::instance()->files_manager->clear_cache();
            } catch (\Throwable) {
                // no crítico
            }
        }

        return [
            'page_id'                => $page_id,
            'sections_converted'     => $result['stats']['sections_converted'],
            'columns_converted'      => $result['stats']['columns_converted'],
            'containers_created'     => $result['stats']['sections_converted'] + $result['stats']['columns_converted'],
            'layout_mode_before'     => $this->reader->detect_layout_mode($tree),
            'layout_mode_after'      => $this->reader->detect_layout_mode($result['tree']),
            'after'                  => $result['tree'],
        ];
    }

    /**
     * Versión pública del helper de conversión (usado también por tests).
     *
     * @param array<int, array<string, mixed>> $tree
     * @return array{tree: array<int, array<string, mixed>>, stats: array{sections_converted: int, columns_converted: int}}
     */
    public function convert_tree_recursive(array $tree): array
    {
        $stats = ['sections_converted' => 0, 'columns_converted' => 0];
        $new_tree = [];

        foreach ($tree as $node) {
            $elType = (string) ($node['elType'] ?? '');

            if ('section' === $elType) {
                $stats['sections_converted']++;
                $children = $node['elements'] ?? [];

                // Recursar primero: las columns pueden contener más sections anidadas.
                $converted_children = $this->convert_tree_recursive($children);

                // Buscar las columns resultantes en este section (post-recursión).
                $columns = array_values(array_filter(
                    $converted_children['tree'],
                    static fn ($n) => 'column' === ($n['elType'] ?? '')
                ));
                $non_columns = array_values(array_filter(
                    $converted_children['tree'],
                    static fn ($n) => 'column' !== ($n['elType'] ?? '')
                ));

                if (!empty($columns)) {
                    // Wrapper container con row direction; un container por cada column.
                    $wrapper = [
                        'id'       => $this->reader->generate_element_id(),
                        'elType'   => 'container',
                        'settings' => $this->make_container_settings(['flex_direction' => 'row']),
                        'elements' => [],
                    ];
                    foreach ($columns as $column) {
                        $stats['columns_converted']++;
                        $wrapper['elements'][] = [
                            'id'       => $this->reader->generate_element_id(),
                            'elType'   => 'container',
                            'settings' => $this->make_container_settings([
                                'content_width' => ['unit' => '%', 'size' => 50],
                            ]),
                            'elements' => $column['elements'] ?? [],
                        ];
                    }
                    // Hijos no-column van después del wrapper.
                    $new_tree[] = $wrapper;
                    foreach ($non_columns as $nc) {
                        $new_tree[] = $nc;
                    }
                } else {
                    // Section sin columns → container simple.
                    $new_tree[] = [
                        'id'       => $this->reader->generate_element_id(),
                        'elType'   => 'container',
                        'settings' => $this->make_container_settings([]),
                        'elements' => $converted_children['tree'],
                    ];
                }
            } elseif ('column' === $elType) {
                // Column huérfana top-level.
                $stats['columns_converted']++;
                $converted_children = $this->convert_tree_recursive($node['elements'] ?? []);
                $new_tree[] = [
                    'id'       => $this->reader->generate_element_id(),
                    'elType'   => 'container',
                    'settings' => $this->make_container_settings([]),
                    'elements' => $converted_children['tree'],
                ];
            } else {
                // Widgets y containers: preserva, pero recursa en hijos.
                if (!empty($node['elements']) && is_array($node['elements'])) {
                    $converted = $this->convert_tree_recursive($node['elements']);
                    $node['elements'] = $converted['tree'];
                }
                $new_tree[] = $node;
            }
        }

        return ['tree' => $new_tree, 'stats' => $stats];
    }

    /**
     * Construye settings mínimas para un container nuevo (defaults de Elementor 4.x).
     *
     * @param array<string, mixed> $overrides
     * @return array<string, mixed>
     */
    private function make_container_settings(array $overrides): array
    {
        $defaults = [
            'default' => [
                'flexDirection'  => 'row',
                'flexWrap'       => 'wrap',
                'flexAlignItems' => 'stretch',
                'position'       => 'relative',
                'overflow'       => 'visible',
                'gap'            => ['unit' => 'px', 'size' => 0, 'column' => '0', 'row' => '0'],
            ],
            '_title'        => 'Container',
            'flex_direction' => 'row',
            'content_width'  => ['unit' => '%', 'size' => 100],
        ];
        return array_merge($defaults, $overrides);
    }

    /**
     * G5 fix: clona la estructura de un template Elementor dentro de una página destino.
     * Cada nodo (containers + widgets) recibe un ID nuevo para evitar colisiones.
     *
     * @param int    $page_id     Página destino.
     * @param int    $template_id Template source (post_type=elementor_library).
     * @param string $position    'first' | 'last'.
     * @return array<string, mixed>|\WP_Error
     */
    public function use_template(int $page_id, int $template_id, string $position): array|\WP_Error
    {
        if (!$this->validator->is_elementor_active()) {
            return new \WP_Error('ELEMENTOR_NOT_ACTIVE', 'Elementor is not installed or active.', ['status' => 503]);
        }

        // 1. Cargar el template (post_type elementor_library).
        $template_post = get_post($template_id);
        if (!$template_post) {
            return new \WP_Error(
                'TEMPLATE_NOT_FOUND',
                sprintf('Template %d does not exist.', $template_id),
                [
                    'status'      => 404,
                    'template_id' => $template_id,
                    'hint'        => 'Call list_templates first to discover valid template IDs.',
                ]
            );
        }
        if ('elementor_library' !== $template_post->post_type) {
            return new \WP_Error(
                'TEMPLATE_WRONG_TYPE',
                sprintf('Post %d is a "%s", not an Elementor template (expected "elementor_library").', $template_id, $template_post->post_type),
                [
                    'status'           => 400,
                    'template_id'      => $template_id,
                    'actual_post_type' => $template_post->post_type,
                    'hint'             => 'Use list_templates?type=page (or section, header, footer, etc.) to find valid template IDs.',
                ]
            );
        }

        // 2. Parsear _elementor_data del template.
        $json = (string) get_post_meta($template_id, '_elementor_data', true);
        if ('' === $json) {
            return new \WP_Error('TEMPLATE_EMPTY', 'Template has no Elementor data.', ['status' => 400, 'template_id' => $template_id]);
        }
        try {
            $template_nodes = $this->reader->parse($json);
        } catch (\InvalidArgumentException $e) {
            return new \WP_Error('INVALID_TEMPLATE_DATA', $e->getMessage(), ['status' => 400, 'template_id' => $template_id]);
        }

        if (empty($template_nodes)) {
            return new \WP_Error('TEMPLATE_EMPTY', 'Template has no top-level elements.', ['status' => 400, 'template_id' => $template_id]);
        }

        // 3. Regenerar IDs para todos los nodos del template.
        $new_nodes = $this->writer->regenerate_ids($template_nodes);

        // 4. Aplicar: appendear (o anteponer) a la página destino.
        return $this->apply_and_save(
            $page_id,
            function (array &$tree) use ($new_nodes, $position, $template_id) {
                if ('first' === $position) {
                    $tree = array_merge($new_nodes, $tree);
                } else {
                    $tree = array_merge($tree, $new_nodes);
                }
                return [
                    // Devolvemos el árbol COMPLETO en orden DFS (containers + widgets)
                    // para que el orquestador pueda resolver placeholders tipo
                    // {{element_id:N}} referenciando widgets anidados. Antes solo
                    // devolvíamos los IDs top-level, lo que rompía cualquier op
                    // posterior que apuntara a un widget interno (update_widget,
                    // replace_image, delete_element, …).
                    'new_element_ids'  => $this->collect_ids_recursive($new_nodes),
                    // Metadata por elemento (id + elType + widgetType) para que el
                    // orquestador pueda hacer "smart fallback" cuando el LLM usa
                    // {{element_id}} sin índice tras use_template y el elemento
                    // apuntado es un container — en ese caso, el orquestador
                    // busca el primer widget del tipo apropiado en este árbol.
                    // Forma: [{id, elType, widgetType?}, ...] en orden DFS.
                    'new_element_tree' => $this->collect_tree_recursive($new_nodes),
                    'template_id'      => $template_id,
                    'appended'         => count($new_nodes),
                ];
            }
        );
    }

    /**
     * Aplana un árbol de nodos Elementor en una lista de IDs en orden DFS
     * (pre-order: parent antes que children).
     *
     * Cada nodo del árbol es un array con al menos las claves:
     *   - id       (string, 7 hex chars generado por regenerate_ids)
     *   - elType   (string: 'container' | 'section' | 'widget' | …)
     *   - elements (array<int, array>, hijos recursivos; opcional)
     *
     * Se usa tras `regenerate_ids` para que el orquestador obtenga TODOS
     * los IDs clonados (incluyendo widgets anidados), no solo los del
     * primer nivel. Esto permite resolver placeholders tipo
     * `{{element_id:N}}` que apunten a widgets internos después de
     * `use_template`.
     *
     * @param array<int, array<string, mixed>> $nodes
     * @return array<int, string>
     */
    public function collect_ids_recursive(array $nodes): array
    {
        $out = [];
        foreach ($nodes as $node) {
            if (!is_array($node)) {
                continue;
            }
            if (isset($node['id']) && is_string($node['id'])) {
                $out[] = $node['id'];
            }
            if (isset($node['elements']) && is_array($node['elements'])) {
                foreach ($this->collect_ids_recursive($node['elements']) as $child_id) {
                    $out[] = $child_id;
                }
            }
        }
        return $out;
    }

    /**
     * Igual que `collect_ids_recursive`, pero devuelve metadata completa
     * por nodo en vez de solo el ID. Se usa tras `regenerate_ids` para
     * que el orquestador pueda hacer "smart placeholder resolution"
     * después de `use_template`: cuando el LLM usa `{{element_id}}` (sin
     * índice) o `{{element_id:0}}` y el ID correspondiente apunta a un
     * container, el orquestador busca en este árbol el primer widget
     * del tipo apropiado a la operación (image widget si hay `media_id`
     * en args, video widget si hay `video_type`/`hosted_url`, etc.).
     *
     * Forma de cada item:
     *   - id         (string, 7 hex chars)
     *   - elType     (string: 'container' | 'section' | 'widget' | …)
     *   - widgetType (string|null): presente solo si elType='widget'
     *   - settings   (array): claves principales del widget (image,
     *                     video_type, title, etc.) para que el orquestador
     *                     pueda inferir la mejor pareja.
     *
     * @param array<int, array<string, mixed>> $nodes
     * @return array<int, array<string, mixed>>
     */
    public function collect_tree_recursive(array $nodes): array
    {
        $out = [];
        foreach ($nodes as $node) {
            if (!is_array($node)) {
                continue;
            }
            $entry = [
                'id'     => isset($node['id']) && is_string($node['id']) ? $node['id'] : null,
                'elType' => isset($node['elType']) && is_string($node['elType']) ? $node['elType'] : 'widget',
            ];
            if (isset($node['widgetType']) && is_string($node['widgetType'])) {
                $entry['widgetType'] = $node['widgetType'];
            } else {
                $entry['widgetType'] = null;
            }
            // Incluimos solo las settings "estructurales" (no '_title' ni similares)
            // para que el orquestador pueda inferir el tipo a partir de la
            // presencia de claves conocidas (image, video_type, etc.).
            $settings = isset($node['settings']) && is_array($node['settings']) ? $node['settings'] : [];
            if (!empty($settings)) {
                $entry['settings'] = $settings;
            }
            $out[] = $entry;
            if (isset($node['elements']) && is_array($node['elements'])) {
                foreach ($this->collect_tree_recursive($node['elements']) as $child) {
                    $out[] = $child;
                }
            }
        }
        return $out;
    }
}
