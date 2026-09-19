<?php
/**
 * Elementor_Controller
 *
 * Endpoints REST para Elementor (SRS §10, §11).
 *
 *   GET    /pages/{id}/elementor
 *   POST   /pages/{id}/elementor/containers
 *   POST   /pages/{id}/elementor/widgets
 *   PATCH  /pages/{id}/elementor/widgets/{element_id}
 *   DELETE /pages/{id}/elementor/elements/{element_id}
 *   POST   /pages/{id}/elementor/elements/{element_id}/duplicate
 *   POST   /pages/{id}/elementor/elements/{element_id}/move
 *
 * Antes de cada escritura, se crea un snapshot para permitir rollback.
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

final class Elementor_Controller
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

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'get_structure'],
            'permission_callback' => [$this, 'can_read'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/containers', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'add_container'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/widgets', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'add_widget'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/widgets/(?P<element_id>[a-zA-Z0-9_-]+)', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'update_widget'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/elements/(?P<element_id>[a-zA-Z0-9_-]+)', [
            'methods'             => \WP_REST_Server::DELETABLE,
            'callback'            => [$this, 'delete_element'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/elements/(?P<element_id>[a-zA-Z0-9_-]+)/duplicate', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'duplicate_element'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/elements/(?P<element_id>[a-zA-Z0-9_-]+)/move', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'move_element'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // G5 fix: endpoint para clonar la estructura de un template dentro de la página.
        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/use-template', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'use_template'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // Container converter: migra section+column legacy a container flex.
        register_rest_route($ns, '/pages/(?P<id>\d+)/elementor/convert-to-containers', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'convert_to_containers'],
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
     * Helper: extrae change_id del request (header o body). Si no existe, genera uno.
     */
    private function get_change_id(\WP_REST_Request $request): string
    {
        $body = $request->get_json_params();
        $change_id = $request->get_header('X-AI-Agent-Change-Id')
            ?? ($body['change_id'] ?? null);

        if (is_string($change_id) && '' !== $change_id) {
            return sanitize_key($change_id);
        }
        // Generar uno si no fue provisto (para operaciones one-off).
        return 'ch_' . substr(bin2hex(random_bytes(8)), 0, 16);
    }

    /**
     * G7 fix: convierte un WP_Error en una respuesta con el mismo formato
     * que las respuestas exitosas (`{success: false, error: {code, message, data}}`).
     *
     * Antes del fix, los WP_Error se devolvían "crudos" desde los callbacks REST y
     * WordPress los serializaba como `{code, message, data}` (sin el `success: false`
     * wrapper). El orquestador intentaba extraer `json.error.code` y
     * `json.error.message`, no los encontraba y mostraba "HTTP_ERROR / HTTP 500"
     * en lugar del mensaje real. Ahora la respuesta es consistente con el resto
     * del plugin y el orquestador puede mostrar mensajes descriptivos.
     *
     * @return \WP_REST_Response
     */
    private function error_response(\WP_Error $error): \WP_REST_Response
    {
        $status = 500;
        $data   = $error->get_error_data();
        if (is_array($data) && isset($data['status']) && is_int($data['status'])) {
            $status = $data['status'];
        }

        return new \WP_REST_Response(
            [
                'success' => false,
                'error'   => [
                    'code'    => $error->get_error_code(),
                    'message' => $error->get_error_message(),
                    'data'    => is_array($data) ? $data : [],
                ],
            ],
            $status
        );
    }

    public function get_structure(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id = (int) $request->get_param('id');
        $result = $this->adapter->get_structure($page_id);
        if (is_wp_error($result)) {
            return $this->error_response($result);
        }
        return new \WP_REST_Response(['success' => true, 'data' => $result], 200);
    }

    public function add_container(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id = (int) $request->get_param('id');
        $body    = $request->get_json_params();

        $parent_id = isset($body['parent_id']) ? (string) $body['parent_id'] : 'root';
        $position  = isset($body['position']) ? (string) $body['position'] : 'last';
        $settings  = isset($body['settings']) && is_array($body['settings']) ? $body['settings'] : [];

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'add_container');

        $result = $this->adapter->add_container($page_id, $parent_id, $position, $settings);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'add_container',
                'page_id'       => $page_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'add_container',
            'page_id'     => $page_id,
            'after_state' => ['parent_id' => $parent_id, 'position' => $position, 'settings' => $settings, 'new_element_id' => $result['new_element_id']],
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 201);
    }

    public function add_widget(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id = (int) $request->get_param('id');
        $body    = $request->get_json_params();

        $container_id = isset($body['container_id']) ? (string) $body['container_id'] : '';
        $widget_type  = isset($body['widget']) ? (string) $body['widget'] : '';
        $position     = isset($body['position']) ? (string) $body['position'] : 'last';
        $settings     = isset($body['settings']) && is_array($body['settings']) ? $body['settings'] : [];

        if ('' === $container_id || '' === $widget_type) {
            return $this->error_response(new \WP_Error('INVALID_REQUEST', 'container_id and widget are required.', ['status' => 400]));
        }

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'add_widget');

        $result = $this->adapter->add_widget($page_id, $container_id, $widget_type, $position, $settings);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'add_widget',
                'page_id'       => $page_id,
                'after_state'   => ['container_id' => $container_id, 'widget' => $widget_type],
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'add_widget',
            'page_id'     => $page_id,
            'after_state' => ['container_id' => $container_id, 'widget' => $widget_type, 'settings' => $settings, 'new_element_id' => $result['new_element_id']],
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 201);
    }

    public function update_widget(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id    = (int) $request->get_param('id');
        $element_id = (string) $request->get_param('element_id');
        $body       = $request->get_json_params();
        $settings   = isset($body['settings']) && is_array($body['settings']) ? $body['settings'] : [];

        // G7 compatibility: si llega `media_id` top-level (usado por la tool `replace_image`),
        // resolver la URL del attachment y construir `settings.image = {id, url}`.
        if (isset($body['media_id'])) {
            $media_id = (int) $body['media_id'];
            if ($media_id <= 0) {
                return $this->error_response(new \WP_Error('INVALID_REQUEST', 'media_id must be a positive integer.', ['status' => 400]));
            }
            $url = wp_get_attachment_url($media_id);
            if (!$url) {
                return $this->error_response(new \WP_Error('MEDIA_NOT_FOUND', "Media attachment {$media_id} not found.", ['status' => 404]));
            }
            $mime = get_post_mime_type($media_id);
            $settings['image'] = [
                'id'        => $media_id,
                'url'       => $url,
                'mime_type' => $mime ?: null,
            ];
        }

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'update_widget');

        $result = $this->adapter->update_widget($page_id, $element_id, $settings);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'update_widget',
                'page_id'       => $page_id,
                'element_id'    => $element_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'update_widget',
            'page_id'     => $page_id,
            'element_id'  => $element_id,
            'after_state' => $settings,
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 200);
    }

    public function delete_element(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id    = (int) $request->get_param('id');
        $element_id = (string) $request->get_param('element_id');

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'delete_element');

        $result = $this->adapter->delete_element($page_id, $element_id);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'delete_element',
                'page_id'       => $page_id,
                'element_id'    => $element_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'delete_element',
            'page_id'     => $page_id,
            'element_id'  => $element_id,
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 200);
    }

    public function duplicate_element(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id    = (int) $request->get_param('id');
        $element_id = (string) $request->get_param('element_id');

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'duplicate_element');

        $result = $this->adapter->duplicate_element($page_id, $element_id);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'duplicate_element',
                'page_id'       => $page_id,
                'element_id'    => $element_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'duplicate_element',
            'page_id'     => $page_id,
            'element_id'  => $element_id,
            'after_state' => ['new_element_id' => $result['new_element_id']],
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 201);
    }

    public function move_element(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id    = (int) $request->get_param('id');
        $element_id = (string) $request->get_param('element_id');
        $body       = $request->get_json_params();

        $new_parent_id = isset($body['parent_id']) ? (string) $body['parent_id'] : '';
        $position      = isset($body['position']) ? (int) $body['position'] : -1;

        if ('' === $new_parent_id) {
            return $this->error_response(new \WP_Error('INVALID_REQUEST', 'parent_id is required.', ['status' => 400]));
        }

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'move_element');

        $result = $this->adapter->move_element($page_id, $element_id, $new_parent_id, $position);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'move_element',
                'page_id'       => $page_id,
                'element_id'    => $element_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'move_element',
            'page_id'     => $page_id,
            'element_id'  => $element_id,
            'after_state' => ['new_parent_id' => $new_parent_id, 'position' => $position],
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 200);
    }

    /**
     * G5 fix: clona un template Elementor dentro de una página destino.
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function use_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id     = (int) $request->get_param('id');
        $body        = $request->get_json_params();
        $template_id = isset($body['template_id']) ? (int) $body['template_id'] : 0;
        $position    = isset($body['position']) && 'first' === $body['position'] ? 'first' : 'last';

        if ($template_id <= 0) {
            return $this->error_response(new \WP_Error('INVALID_REQUEST', 'template_id is required and must be a positive integer.', ['status' => 400]));
        }

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'use_template');

        $result = $this->adapter->use_template($page_id, $template_id, $position);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'use_template',
                'page_id'       => $page_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        // apply_and_save devuelve {result: {...}, before, after, page_id, new_element_id: null}.
        // Aquí extraemos new_element_ids y new_element_tree desde result para
        // devolverlos al orquestador.
        $adapter_result = $result['result'] ?? [];
        $new_ids        = is_array($adapter_result) ? ($adapter_result['new_element_ids'] ?? []) : [];
        $new_tree       = is_array($adapter_result) ? ($adapter_result['new_element_tree'] ?? []) : [];

        $this->audit_log->log([
            'action'      => 'use_template',
            'page_id'     => $page_id,
            'after_state' => [
                'template_id'      => $template_id,
                'position'         => $position,
                'new_element_ids'  => $new_ids,
                'new_element_tree' => $new_tree,
                'appended'         => count($new_ids),
            ],
            'success'     => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => [
                'page_id'          => $page_id,
                'template_id'      => $template_id,
                'position'         => $position,
                'new_element_ids'  => $new_ids,
                'new_element_tree' => $new_tree,
                'appended'         => count($new_ids),
            ],
        ], 201);
    }

    /**
     * Container converter: migra section+column (legacy v3) al modelo container (v4).
     *
     * Body (opcional):
     *   - create_snapshot: bool (default true) — captura snapshot pre-conversión.
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function convert_to_containers(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id = (int) $request->get_param('id');
        $body    = $request->get_json_params() ?? [];
        $with_snapshot = !isset($body['create_snapshot']) || true === $body['create_snapshot'];

        if ($with_snapshot) {
            $change_id = $this->get_change_id($request);
            $this->revision_manager->create_snapshot($page_id, $change_id, 'convert_to_containers');
        }

        $result = $this->adapter->convert_to_containers($page_id);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'convert_to_containers',
                'page_id'       => $page_id,
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $this->error_response($result);
        }

        $this->audit_log->log([
            'action'      => 'convert_to_containers',
            'page_id'     => $page_id,
            'after_state' => [
                'sections_converted' => $result['sections_converted'],
                'columns_converted'  => $result['columns_converted'],
                'layout_mode_before' => $result['layout_mode_before'],
                'layout_mode_after'  => $result['layout_mode_after'],
            ],
            'success'     => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => [
                'page_id'            => $page_id,
                'sections_converted' => $result['sections_converted'],
                'columns_converted'  => $result['columns_converted'],
                'containers_created' => $result['containers_created'],
                'layout_mode_before' => $result['layout_mode_before'],
                'layout_mode_after'  => $result['layout_mode_after'],
            ],
        ], 200);
    }
}
