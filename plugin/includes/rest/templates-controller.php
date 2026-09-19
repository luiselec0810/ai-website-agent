<?php
/**
 * Templates_Controller
 *
 * Endpoints REST para Templates (SRS §13).
 *   GET /templates
 *   GET /templates/{id}
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Audit_Log;
use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Revision_Manager;
use AIWebsiteBridge\Validator;
use AIWebsiteBridge\WordPress\Template_Service;

defined('ABSPATH') || exit;

final class Templates_Controller
{
    private Template_Service $service;

    public function __construct(
        private Permissions $permissions,
        private Validator $validator,
        private Audit_Log $audit_log,
        private Revision_Manager $revision_manager
    ) {
        $this->service = new Template_Service();
    }

    public function register_routes(): void
    {
        $ns = 'ai-agent/v1';
        register_rest_route($ns, '/templates', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'list_templates'],
            'permission_callback' => [$this, 'can_read'],
            'args'                => [
                'type'     => ['type' => 'string', 'required' => false],
                'search'   => ['type' => 'string', 'required' => false],
                'per_page' => ['type' => 'integer', 'required' => false, 'default' => 50],
            ],
        ]);

        register_rest_route($ns, '/templates/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'get_template'],
            'permission_callback' => [$this, 'can_read'],
        ]);
    }

    public function can_read(): bool|\WP_Error
    {
        return $this->permissions->can_read() ? true : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    public function list_templates(\WP_REST_Request $request): \WP_REST_Response
    {
        $templates = $this->service->list_templates([
            'type'     => $request->get_param('type'),
            'search'   => $request->get_param('search'),
            'per_page' => $request->get_param('per_page'),
        ]);
        return new \WP_REST_Response(['success' => true, 'data' => $templates], 200);
    }

    public function get_template(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $template = $this->service->get_template((int) $request->get_param('id'));
        if (is_wp_error($template)) {
            return $template;
        }
        return new \WP_REST_Response(['success' => true, 'data' => $template], 200);
    }
}
