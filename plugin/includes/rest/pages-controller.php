<?php
/**
 * Pages_Controller
 *
 * Endpoints REST para Pages (SRS §9):
 *   GET    /pages
 *   GET    /pages/{id}
 *   POST   /pages
 *   PATCH  /pages/{id}
 *   POST   /pages/{id}/duplicate
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Audit_Log;
use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Revision_Manager;
use AIWebsiteBridge\Validator;
use AIWebsiteBridge\WordPress\Page_Service;

defined('ABSPATH') || exit;

final class Pages_Controller
{
    private Page_Service $service;

    public function __construct(
        private Permissions $permissions,
        private Validator $validator,
        private Audit_Log $audit_log,
        private Revision_Manager $revision_manager
    ) {
        $this->service = new Page_Service();
    }

    public function register_routes(): void
    {
        $ns = 'ai-agent/v1';

        register_rest_route($ns, '/pages', [
            [
                'methods'             => \WP_REST_Server::READABLE,
                'callback'            => [$this, 'list_pages'],
                'permission_callback' => [$this, 'can_read'],
                'args'                => [
                    'search'   => ['type' => 'string', 'required' => false],
                    'status'   => ['type' => 'string', 'required' => false],
                    'per_page' => ['type' => 'integer', 'required' => false, 'default' => 10],
                    'page'     => ['type' => 'integer', 'required' => false, 'default' => 1],
                ],
            ],
            [
                'methods'             => \WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'create_page'],
                'permission_callback' => [$this, 'can_edit'],
            ],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)', [
            [
                'methods'             => \WP_REST_Server::READABLE,
                'callback'            => [$this, 'get_page'],
                'permission_callback' => [$this, 'can_read'],
            ],
            [
                'methods'             => \WP_REST_Server::EDITABLE,
                'callback'            => [$this, 'update_page'],
                'permission_callback' => [$this, 'can_edit'],
            ],
        ]);

        register_rest_route($ns, '/pages/(?P<id>\d+)/duplicate', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'duplicate_page'],
            'permission_callback' => [$this, 'can_edit'],
        ]);

        // G12 fix: endpoint para set/clear la imagen destacada (featured image / thumbnail).
        register_rest_route($ns, '/pages/(?P<id>\d+)/thumbnail', [
            'methods'             => \WP_REST_Server::EDITABLE,
            'callback'            => [$this, 'set_thumbnail'],
            'permission_callback' => [$this, 'can_edit'],
        ]);
    }

    public function can_read(): bool|\WP_Error
    {
        return $this->permissions->can_read()
            ? true
            : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    public function can_edit(): bool|\WP_Error
    {
        return $this->permissions->can_edit_pages()
            ? true
            : new \WP_Error('FORBIDDEN', 'Insufficient capabilities to edit pages.', ['status' => 403]);
    }

    public function list_pages(\WP_REST_Request $request): \WP_REST_Response
    {
        $result = $this->service->list_pages([
            'search'   => $request->get_param('search'),
            'status'   => $request->get_param('status'),
            'per_page' => $request->get_param('per_page'),
            'page'     => $request->get_param('page'),
        ]);

        return new \WP_REST_Response([
            'success'    => true,
            'data'       => $result['items'],
            'pagination' => $result['pagination'],
        ], 200);
    }

    public function get_page(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id = (int) $request->get_param('id');
        $page = $this->service->get_page($id);
        if (is_wp_error($page)) {
            return $page;
        }
        return new \WP_REST_Response(['success' => true, 'data' => $page], 200);
    }

    public function create_page(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $body = $request->get_json_params();

        // Para publish, requerir publish_pages.
        $status = $body['status'] ?? 'draft';
        if ('publish' === $status && !$this->permissions->can_publish_pages()) {
            return new \WP_Error('FORBIDDEN', 'publish_pages capability required to create published pages.', ['status' => 403]);
        }

        $page = $this->service->create_page($body);
        if (is_wp_error($page)) {
            return $page;
        }

        $this->audit_log->log([
            'action'      => 'create_page',
            'page_id'     => $page['id'],
            'after_state' => $page,
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $page], 201);
    }

    public function update_page(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $id   = (int) $request->get_param('id');
        $body = $request->get_json_params();

        // Para publish, requerir publish_pages.
        if (isset($body['status']) && 'publish' === $body['status'] && !$this->permissions->can_publish_pages()) {
            return new \WP_Error('FORBIDDEN', 'publish_pages capability required.', ['status' => 403]);
        }

        $before = $this->service->get_page($id);
        if (is_wp_error($before)) {
            return $before;
        }

        // G1 fix: capturar snapshot pre-mutación para permitir rollback.
        // Sin esto, `rollback_changes` no podría revertir un update_page.
        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($id, $change_id, 'update_page');

        $page = $this->service->update_page($id, $body);
        if (is_wp_error($page)) {
            return $page;
        }

        $this->audit_log->log([
            'action'      => 'update_page',
            'page_id'     => $id,
            'before_state'=> $before,
            'after_state' => $page,
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $page], 200);
    }

    /**
     * G1 helper: extraer o generar change_id del request (header X-AI-Agent-Change-Id o body.change_id).
     */
    private function get_change_id(\WP_REST_Request $request): string
    {
        $body = $request->get_json_params();
        $change_id = $request->get_header('X-AI-Agent-Change-Id')
            ?? ($body['change_id'] ?? null);
        if (is_string($change_id) && '' !== $change_id) {
            return sanitize_key($change_id);
        }
        return 'ch_' . substr(bin2hex(random_bytes(8)), 0, 16);
    }

    public function duplicate_page(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $source_id = (int) $request->get_param('id');
        $body      = $request->get_json_params() ?? [];

        $new = $this->service->duplicate_page($source_id, $body);
        if (is_wp_error($new)) {
            return $new;
        }

        $this->audit_log->log([
            'action'      => 'duplicate_page',
            'page_id'     => $new['id'],
            'before_state'=> ['source_page_id' => $source_id],
            'after_state' => $new,
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $new], 201);
    }

    /**
     * G12 fix: set/clear la imagen destacada (post thumbnail) de una página.
     * Body: { "media_id": int }   — media_id = 0 o null limpia la imagen.
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function set_thumbnail(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id  = (int) $request->get_param('id');
        $body     = $request->get_json_params() ?? [];
        $media_id = isset($body['media_id']) ? (int) $body['media_id'] : null;

        if (!get_post($page_id) || 'page' !== get_post_type($page_id)) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['status' => 404]);
        }

        $change_id = $this->get_change_id($request);
        $this->revision_manager->create_snapshot($page_id, $change_id, 'set_thumbnail');

        $previous = (int) get_post_thumbnail_id($page_id);

        if (null === $media_id || $media_id <= 0) {
            delete_post_thumbnail($page_id);
            $this->audit_log->log([
                'action'       => 'set_thumbnail',
                'page_id'      => $page_id,
                'before_state' => ['media_id' => $previous],
                'after_state'  => ['media_id' => null],
                'success'      => true,
            ]);
            return new \WP_REST_Response([
                'success' => true,
                'data'    => ['page_id' => $page_id, 'media_id' => null, 'cleared' => true],
            ], 200);
        }

        $attachment = get_post($media_id);
        if (!$attachment || 'attachment' !== $attachment->post_type) {
            return new \WP_Error('MEDIA_NOT_FOUND', sprintf('Media %d not found.', $media_id), ['status' => 404]);
        }

        $ok = set_post_thumbnail($page_id, $media_id);
        if (!$ok) {
            return new \WP_Error('THUMBNAIL_FAILED', 'Failed to set thumbnail.', ['page_id' => $page_id, 'media_id' => $media_id], 500);
        }

        $this->audit_log->log([
            'action'       => 'set_thumbnail',
            'page_id'      => $page_id,
            'before_state' => ['media_id' => $previous],
            'after_state'  => ['media_id' => $media_id],
            'success'      => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => [
                'page_id'       => $page_id,
                'media_id'      => $media_id,
                'thumbnail_url' => (string) wp_get_attachment_url($media_id),
                'cleared'       => false,
            ],
        ], 200);
    }
}
