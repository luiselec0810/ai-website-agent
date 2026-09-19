<?php
/**
 * Media_Controller
 *
 * Endpoints REST para Media Library (SRS §15).
 *   GET    /media
 *   GET    /media/{id}
 *   POST   /media
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Audit_Log;
use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Revision_Manager;
use AIWebsiteBridge\Validator;
use AIWebsiteBridge\WordPress\Media_Service;

defined('ABSPATH') || exit;

final class Media_Controller
{
    private Media_Service $service;

    public function __construct(
        private Permissions $permissions,
        private Validator $validator,
        private Audit_Log $audit_log,
        private Revision_Manager $revision_manager
    ) {
        $this->service = new Media_Service();
    }

    public function register_routes(): void
    {
        $ns = 'ai-agent/v1';
        register_rest_route($ns, '/media', [
            [
                'methods'             => \WP_REST_Server::READABLE,
                'callback'            => [$this, 'list_media'],
                'permission_callback' => [$this, 'can_read'],
                'args'                => [
                    'search'   => ['type' => 'string', 'required' => false],
                    'per_page' => ['type' => 'integer', 'required' => false, 'default' => 20],
                ],
            ],
            [
                'methods'             => \WP_REST_Server::CREATABLE,
                'callback'            => [$this, 'upload_media'],
                'permission_callback' => [$this, 'can_upload'],
            ],
        ]);

        register_rest_route($ns, '/media/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'get_media'],
            'permission_callback' => [$this, 'can_read'],
        ]);
    }

    public function can_read(): bool|\WP_Error
    {
        return $this->permissions->can_read() ? true : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    public function can_upload(): bool|\WP_Error
    {
        return current_user_can('upload_files') ? true : new \WP_Error('FORBIDDEN', 'upload_files capability required.', ['status' => 403]);
    }

    public function list_media(\WP_REST_Request $request): \WP_REST_Response
    {
        $result = $this->service->list_media([
            'search'   => $request->get_param('search'),
            'per_page' => $request->get_param('per_page'),
        ]);
        return new \WP_REST_Response([
            'success'    => true,
            'data'       => $result['items'],
            'pagination' => $result['pagination'],
        ], 200);
    }

    public function get_media(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $media = $this->service->get_media((int) $request->get_param('id'));
        if (is_wp_error($media)) {
            return $media;
        }
        return new \WP_REST_Response(['success' => true, 'data' => $media], 200);
    }

    public function upload_media(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $files = $request->get_file_params();
        if (empty($files['file'])) {
            return new \WP_Error('NO_FILE', 'No file provided in "file" field.', ['status' => 400]);
        }

        $body = $request->get_json_params() ?? [];
        $result = $this->service->upload_media($files['file'], $body);
        if (is_wp_error($result)) {
            return $result;
        }

        $this->audit_log->log([
            'action'      => 'upload_media',
            'after_state' => ['id' => $result['id'], 'url' => $result['url']],
            'success'     => true,
        ]);

        return new \WP_REST_Response(['success' => true, 'data' => $result], 201);
    }
}
