<?php
/**
 * Global_Widget_Controller
 *
 * Endpoints para gestionar Global Widgets de Elementor.
 *
 *   GET  /global-widgets                              Listar global widgets disponibles
 *   POST /global-widgets                              Crear un nuevo global widget desde cero
 *   DELETE /global-widgets/{id}                       Eliminar un global widget
 *   POST /pages/{id}/elementor/promote-global-widget  Promover un widget suelto a global
 *   POST /pages/{id}/elementor/insert-global-widget   Insertar referencia a un global widget
 *
 * Un "Global Widget" en Elementor es un CPT `elementor_library` con meta
 * `_elementor_template_type=widget` + `_elementor_global_widget=1`. Contiene un
 * único widget top-level que se puede referenciar desde múltiples páginas.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Audit_Log;
use AIWebsiteBridge\Elementor\Elementor_Adapter;
use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Revision_Manager;
use AIWebsiteBridge\Validator;

defined('ABSPATH') || exit;

final class Global_Widget_Controller
{
    private Elementor_Adapter $adapter;

    public function __construct(
        private Permissions $permissions,
        private Validator $validator,
        private Audit_Log $audit_log,
        private Revision_Manager $revision_manager
    ) {
        $this->adapter = new Elementor_Adapter();
    }

    public function register_routes(): void
    {
        $ns = 'ai-agent/v1';

        register_rest_route($ns, '/global-widgets', [
            [
                'methods'             => \WP_REST_Server::READABLE,
                'callback'            => [$this, 'list_global_widgets'],
                'permission_callback' => [$this, 'can_read'],
                'args'                => [
                    'search'   => ['type' => 'string', 'required' => false],
                    'per_page' => ['type' => 'integer', 'required' => false, 'default' => 50],
                ],
            ],
            [
                'methods'             => \WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'create_global_widget'],
                'permission_callback' => [$this, 'can_edit'],
            ],
        ]);

        register_rest_route($ns, '/global-widgets/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::DELETABLE,
            'callback'            => [$this, 'delete_global_widget'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/promote-global-widget', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'promote_to_global'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/insert-global-widget', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'insert_global_widget'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_read(): bool|\WP_Error
    {
        return $this->permissions->can_read() ? true : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    public function can_edit(): bool|\WP_Error
    {
        return $this->permissions->can_edit_pages() ? true : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    /**
     * GET /global-widgets — lista todos los global widgets disponibles.
     */
    public function list_global_widgets(\WP_REST_Request $request): \WP_REST_Response
    {
        $args = [
            'post_type'      => 'elementor_library',
            'post_status'    => 'publish',
            'posts_per_page' => max(1, min(100, (int) ($request->get_param('per_page') ?? 50))),
            'orderby'        => 'title',
            'order'          => 'ASC',
        ];
        if ($search = $request->get_param('search')) {
            $args['s'] = (string) $search;
        }
        $query = new \WP_Query($args);

        $items = [];
        foreach ($query->posts as $post) {
            // Filtrar solo los que tienen _elementor_global_widget=1.
            if ('1' !== (string) get_post_meta($post->ID, '_elementor_global_widget', true)) {
                continue;
            }
            $items[] = [
                'id'         => (int) $post->ID,
                'title'      => (string) $post->post_title,
                'type'       => 'global', // siempre global al filtrar arriba.
                'widget_type' => $this->extract_widget_type($post->ID),
                'created'    => (string) $post->post_date,
            ];
        }

        return new \WP_REST_Response([
            'success'    => true,
            'data'       => $items,
            'pagination' => [
                'total'    => (int) $query->found_posts,
                'per_page' => $args['posts_per_page'],
            ],
        ], 200);
    }

    /**
     * POST /global-widgets — crea un global widget desde cero.
     *
     * Body:
     *   {
     *     "title": "Mi botón CTA",
     *     "widget_type": "button",
     *     "settings": { "text": "Click me", "link": { "url": "https://..." } }
     *   }
     */
    public function create_global_widget(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $body        = $request->get_json_params() ?? [];
        $title       = isset($body['title']) ? (string) $body['title'] : '';
        $widget_type = isset($body['widget_type']) ? (string) $body['widget_type'] : '';
        $settings    = isset($body['settings']) && is_array($body['settings']) ? $body['settings'] : [];

        if ('' === $title || '' === $widget_type) {
            return new \WP_Error('INVALID_REQUEST', 'title and widget_type are required.', ['status' => 400]);
        }

        if (!$this->validator->widget_exists($widget_type)) {
            return new \WP_Error('INVALID_WIDGET_TYPE', sprintf('Widget "%s" is not available.', $widget_type), ['status' => 400]);
        }

        // Validar settings per-widget.
        $settings_error = $this->validator->validate_settings($widget_type, $settings);
        if (is_wp_error($settings_error)) {
            return $settings_error;
        }

        // Construir el árbol del global widget: un único widget top-level.
        $node = [
            'id'         => $this->generate_id(),
            'elType'     => 'widget',
            'widgetType' => $widget_type,
            'settings'   => $settings,
            'elements'   => [],
        ];
        $json = wp_json_encode([$node]);

        $post_id = wp_insert_post([
            'post_title'  => $title,
            'post_status' => 'publish',
            'post_type'   => 'elementor_library',
        ], true);

        if (is_wp_error($post_id)) {
            return $post_id;
        }

        update_post_meta($post_id, '_elementor_template_type', 'widget');
        update_post_meta($post_id, '_elementor_global_widget', '1');
        update_post_meta($post_id, '_elementor_edit_mode', 'builder');
        update_post_meta($post_id, '_elementor_data', $json);

        $this->audit_log->log([
            'action'      => 'create_global_widget',
            'page_id'     => $post_id,
            'after_state' => ['title' => $title, 'widget_type' => $widget_type],
            'success'     => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => [
                'id'          => $post_id,
                'title'       => $title,
                'widget_type' => $widget_type,
                'settings'    => $settings,
            ],
        ], 201);
    }

    /**
     * DELETE /global-widgets/{id} — elimina un global widget.
     */
    public function delete_global_widget(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $post = get_post($id);
        if (!$post || 'elementor_library' !== $post->post_type) {
            return new \WP_Error('NOT_FOUND', sprintf('Global widget %d not found.', $id), ['status' => 404]);
        }
        if ('1' !== (string) get_post_meta($id, '_elementor_global_widget', true)) {
            return new \WP_Error('NOT_A_GLOBAL_WIDGET', sprintf('Post %d is not a global widget.', $id), ['status' => 400]);
        }

        $deleted = wp_delete_post($id, true);
        if (!$deleted) {
            return new \WP_Error('DELETE_FAILED', 'Failed to delete global widget.', ['status' => 500]);
        }

        $this->audit_log->log([
            'action'   => 'delete_global_widget',
            'page_id'  => $id,
            'success'  => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => ['id' => $id, 'deleted' => true]], 200);
    }

    /**
     * POST /pages/{id}/elementor/promote-global-widget
     *
     * Promueve un widget suelto de la página a global widget. Crea un nuevo
     * CPT elementor_library, copia la estructura del widget, y opcionalmente
     * lo reemplaza en la página con un nodo "global" (referencia).
     *
     * Body:
     *   {
     *     "element_id": "abc1234",
     *     "title": "Mi CTA",
     *     "replace_in_page": true
     *   }
     */
    public function promote_to_global(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id  = (int) $request->get_param('id');
        $body     = $request->get_json_params() ?? [];
        $element_id = (string) ($body['element_id'] ?? '');
        $title    = isset($body['title']) ? (string) $body['title'] : '';
        $replace  = !empty($body['replace_in_page']);

        if ('' === $element_id) {
            return new \WP_Error('INVALID_REQUEST', 'element_id is required.', ['status' => 400]);
        }

        // Cargar el árbol de la página.
        $json = (string) get_post_meta($page_id, '_elementor_data', true);
        try {
            $tree = $this->adapter->reader()->parse($json);
        } catch (\InvalidArgumentException $e) {
            return new \WP_Error('INVALID_ELEMENTOR_DATA', $e->getMessage(), ['status' => 400]);
        }

        $node = $this->adapter->reader()->find_by_id($tree, $element_id);
        if (null === $node) {
            return new \WP_Error('ELEMENT_NOT_FOUND', sprintf('Element "%s" not found on page.', $element_id), ['status' => 404]);
        }
        if ('widget' !== ($node['elType'] ?? '')) {
            return new \WP_Error('NOT_A_WIDGET', sprintf('Element "%s" is not a widget (elType=%s).', $element_id, $node['elType'] ?? ''), ['status' => 400]);
        }

        $widget_type = (string) ($node['widgetType'] ?? '');
        $settings    = (array) ($node['settings'] ?? []);
        $final_title = '' !== $title ? $title : sprintf('Global %s', $widget_type);

        // Crear el global widget.
        $global_id = wp_insert_post([
            'post_title'  => $final_title,
            'post_status' => 'publish',
            'post_type'   => 'elementor_library',
        ], true);

        if (is_wp_error($global_id)) {
            return $global_id;
        }

        $global_node = [
            'id'         => $this->generate_id(),
            'elType'     => 'widget',
            'widgetType' => $widget_type,
            'settings'   => $settings,
            'elements'   => [],
        ];
        update_post_meta($global_id, '_elementor_template_type', 'widget');
        update_post_meta($global_id, '_elementor_global_widget', '1');
        update_post_meta($global_id, '_elementor_edit_mode', 'builder');
        update_post_meta($global_id, '_elementor_data', wp_json_encode([$global_node]));

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'promote_global_widget');

        // Si se pidió replace_in_page, sustituir el widget por una referencia global.
        if ($replace) {
            $reader = $this->adapter->reader();
            $path = $reader->find_path_by_id($tree, $element_id);
            if (null === $path) {
                return new \WP_Error('ELEMENT_NOT_FOUND', 'Element disappeared after promotion.', ['status' => 500]);
            }

            // Reemplazar el nodo en su posición con un nodo "global".
            $reference = [
                'id'         => $this->generate_id(),
                'elType'     => 'widget',
                'widgetType' => 'global',
                'settings'   => ['template_id' => (int) $global_id],
                'elements'   => [],
            ];

            // Walk down the path and replace.
            $cursor = &$tree;
            foreach ($path as $i => $key) {
                if ((int) $i === count($path) - 1) {
                    $cursor[(int) $key] = $reference;
                } else {
                    $cursor = &$cursor[$key];
                }
            }
            unset($cursor);

            $new_json = $this->adapter->reader()->parse(
                (string) get_post_meta($page_id, '_elementor_data', true)
            );
            // Reemplazar el árbol viejo con el nuevo.
            $final_tree = $this->replace_tree_node($tree, $element_id, $reference);
            // Hand-rolled serialize via adapter's writer.
            $writer = new \AIWebsiteBridge\Elementor\Elementor_Writer(
                $reader,
                new \AIWebsiteBridge\Elementor\Elementor_Validator()
            );
            update_post_meta($page_id, '_elementor_data', $writer->serialize($final_tree));

            if (class_exists('\Elementor\Plugin')) {
                try { \Elementor\Plugin::instance()->files_manager->clear_cache(); } catch (\Throwable) {}
            }
        }

        $this->audit_log->log([
            'action'      => 'promote_global_widget',
            'page_id'     => $page_id,
            'after_state' => [
                'element_id' => $element_id,
                'global_id'  => $global_id,
                'replaced'   => $replace,
            ],
            'success'     => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => [
                'global_id'    => $global_id,
                'title'        => $final_title,
                'widget_type'  => $widget_type,
                'replaced'     => $replace,
                'inserted_ref' => $replace ? ['template_id' => $global_id] : null,
            ],
        ], 201);
    }

    /**
     * POST /pages/{id}/elementor/insert-global-widget
     *
     * Inserta una referencia a un global widget en la página.
     *
     * Body:
     *   {
     *     "template_id": 123,
     *     "container_id": "abc1234",
     *     "position": "last"
     *   }
     */
    public function insert_global_widget(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id = (int) $request->get_param('id');
        $body    = $request->get_json_params() ?? [];
        $template_id  = isset($body['template_id']) ? (int) $body['template_id'] : 0;
        $container_id = (string) ($body['container_id'] ?? 'root');
        $position     = isset($body['position']) && 'first' === $body['position'] ? 'first' : 'last';

        if ($template_id <= 0) {
            return new \WP_Error('INVALID_REQUEST', 'template_id is required.', ['status' => 400]);
        }

        // Validar que el global widget existe.
        $post = get_post($template_id);
        if (!$post || 'elementor_library' !== $post->post_type) {
            return new \WP_Error('TEMPLATE_NOT_FOUND', sprintf('Global widget %d not found.', $template_id), ['status' => 404]);
        }
        if ('1' !== (string) get_post_meta($template_id, '_elementor_global_widget', true)) {
            return new \WP_Error('NOT_A_GLOBAL_WIDGET', sprintf('Post %d is not a global widget.', $template_id), ['status' => 400]);
        }

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'insert_global_widget');

        $result = $this->adapter->add_widget(
            $page_id,
            $container_id,
            'global',
            $position,
            ['template_id' => $template_id]
        );
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'insert_global_widget',
                'page_id'       => $page_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $result;
        }

        $this->audit_log->log([
            'action'      => 'insert_global_widget',
            'page_id'     => $page_id,
            'after_state' => ['template_id' => $template_id, 'container_id' => $container_id],
            'success'     => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => [
                'page_id'        => $page_id,
                'template_id'    => $template_id,
                'container_id'   => $container_id,
                'new_element_id' => $result['new_element_id'] ?? null,
            ],
        ], 201);
    }

    // ─────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────

    private function extract_widget_type(int $post_id): string
    {
        $json = (string) get_post_meta($post_id, '_elementor_data', true);
        if ('' === $json) return '';
        $data = json_decode($json, true);
        if (!is_array($data) || empty($data[0])) return '';
        return (string) ($data[0]['widgetType'] ?? '');
    }

    private function generate_id(): string
    {
        try {
            $bytes = random_bytes(7);
        } catch (\Throwable) {
            $bytes = '';
            for ($i = 0; $i < 7; $i++) $bytes .= chr(mt_rand(0, 255));
        }
        return substr(bin2hex($bytes), 0, 7);
    }

    private function replace_tree_node(array $tree, string $element_id, array $replacement): array
    {
        foreach ($tree as $i => $node) {
            if (($node['id'] ?? null) === $element_id) {
                $tree[$i] = $replacement;
                return $tree;
            }
            if (!empty($node['elements']) && is_array($node['elements'])) {
                $tree[$i]['elements'] = $this->replace_tree_node($node['elements'], $element_id, $replacement);
            }
        }
        return $tree;
    }

    private function get_change_id(\WP_REST_Request $request): string
    {
        $body = $request->get_json_params();
        $change_id = $request->get_header('X-AI-Agent-Change-Id') ?? ($body['change_id'] ?? null);
        if (is_string($change_id) && '' !== $change_id) {
            return sanitize_key($change_id);
        }
        return 'ch_' . substr(bin2hex(random_bytes(8)), 0, 16);
    }
}
