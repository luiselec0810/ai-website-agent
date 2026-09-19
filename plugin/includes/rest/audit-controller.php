<?php
/**
 * Audit_Controller
 *
 * Endpoints REST para Audit Log + Rollback (SRS §24, §25).
 *   GET    /audit
 *   POST   /changes/{change_id}/rollback
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Audit_Log;
use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Revision_Manager;
use AIWebsiteBridge\Validator;

defined('ABSPATH') || exit;

final class Audit_Controller
{
    public function __construct(
        private Permissions $permissions,
        private Validator $validator,
        private Audit_Log $audit_log,
        private Revision_Manager $revision_manager
    ) {}

    public function register_routes(): void
    {
        $ns = 'ai-agent/v1';

        register_rest_route($ns, '/audit', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'list_audit'],
            'permission_callback' => [$this, 'can_read'],
            'args'                => [
                'page_id' => ['type' => 'integer', 'required' => false],
                'action'  => ['type' => 'string',  'required' => false],
                'success' => ['type' => 'boolean', 'required' => false],
                'limit'   => ['type' => 'integer', 'required' => false, 'default' => 50],
                'offset'  => ['type' => 'integer', 'required' => false, 'default' => 0],
            ],
        ]);

        register_rest_route($ns, '/changes/(?P<change_id>[a-zA-Z0-9_-]+)/rollback', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'rollback_change'],
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

    public function list_audit(\WP_REST_Request $request): \WP_REST_Response
    {
        $entries = $this->audit_log->list_entries([
            'page_id' => $request->get_param('page_id'),
            'action'  => $request->get_param('action'),
            'success' => $request->get_param('success'),
            'limit'   => $request->get_param('limit'),
            'offset'  => $request->get_param('offset'),
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => $entries,
        ], 200);
    }

    public function rollback_change(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $change_id = (string) $request->get_param('change_id');
        if ('' === $change_id) {
            return new \WP_Error('INVALID_REQUEST', 'change_id is required.', ['status' => 400]);
        }

        $result = $this->revision_manager->rollback($change_id);
        if (is_wp_error($result)) {
            $this->audit_log->log([
                'action'        => 'rollback',
                'after_state'   => ['change_id' => $change_id],
                'success'       => false,
                'error_code'    => $result->get_error_code(),
                'error_message' => $result->get_error_message(),
            ]);
            return $result;
        }

        $this->audit_log->log([
            'action'      => 'rollback',
            'after_state' => ['change_id' => $change_id, 'restored' => true],
            'success'     => true,
        ]);

        return new \WP_REST_Response([
            'success' => true,
            'data'    => ['change_id' => $change_id, 'rolled_back' => true],
        ], 200);
    }
}
