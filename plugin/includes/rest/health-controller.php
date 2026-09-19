<?php
/**
 * Health_Controller
 *
 * Endpoint: GET /ai-agent/v1/health
 * Devuelve info del sitio: versión WP, Elementor, Elementor Pro, widgets disponibles.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Validator;

defined('ABSPATH') || exit;

final class Health_Controller
{
    public function __construct(
        private Permissions $permissions,
        private Validator $validator
    ) {}

    public function register_routes(): void
    {
        register_rest_route('ai-agent/v1', '/health', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'handle'],
            'permission_callback' => [$this, 'permissions'],
        ]);
    }

    public function permissions(\WP_REST_Request $request): bool|\WP_Error
    {
        if (!$this->permissions->can_read()) {
            return new \WP_Error('FORBIDDEN', 'Insufficient capabilities to access this endpoint.', ['status' => 403]);
        }
        return true;
    }

    public function handle(\WP_REST_Request $request): \WP_REST_Response
    {
        global $wp_version;

        $elementor_installed = defined('ELEMENTOR_VERSION');
        $elementor_version   = $elementor_installed ? ELEMENTOR_VERSION : null;
        $elementor_pro       = defined('ELEMENTOR_PRO_VERSION');

        return new \WP_REST_Response([
            'success' => true,
            'data' => [
                'wordpress_version'       => $wp_version,
                'php_version'             => PHP_VERSION,
                'plugin_version'          => AI_WEBSITE_BRIDGE_VERSION,
                'elementor_installed'     => (bool) $elementor_installed,
                'elementor_version'       => $elementor_version,
                'elementor_pro_installed' => (bool) $elementor_pro,
                'available_widgets'       => $this->detect_available_widgets(),
                'site_url'                => get_site_url(),
                'site_name'                => get_bloginfo('name'),
            ],
        ], 200);
    }

    /**
     * Lista los widgets Elementor disponibles (core + Pro si aplica).
     *
     * @return array<int, string>
     */
    private function detect_available_widgets(): array
    {
        if (!class_exists('\Elementor\Plugin')) {
            return [];
        }

        try {
            $widgets_manager = \Elementor\Plugin::instance()->widgets_manager;
            $registered      = $widgets_manager->get_widget_types();
            return array_values(array_keys($registered));
        } catch (\Throwable $e) {
            return [];
        }
    }
}
