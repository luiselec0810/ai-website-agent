<?php
/**
 * Preview_Controller
 *
 * Genera una URL de preview para una página con dispositivo configurable.
 *
 *   GET /preview/{page_id}?device=desktop|tablet|mobile
 *
 * Devuelve la URL que el frontend puede cargar en un iframe.
 * Para Elementor, usamos el parámetro `elementor-preview-id` que es estándar.
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

final class Preview_Controller
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
        register_rest_route($ns, '/preview/(?P<id>\d+)', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'get_preview'],
            'permission_callback' => [$this, 'can_read'],
            'args'                => [
                'device' => [
                    'type'     => 'string',
                    'required' => false,
                    'default'  => 'desktop',
                ],
            ],
        ]);

        register_rest_route($ns, '/design-system', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'get_design_system'],
            'permission_callback' => [$this, 'can_read'],
        ]);

        // G8 fix: endpoint separado para site settings (era el mismo que design-system).
        register_rest_route($ns, '/site-settings', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'get_site_settings'],
            'permission_callback' => [$this, 'can_read'],
        ]);
    }

    public function can_read(): bool|\WP_Error
    {
        return $this->permissions->can_read() ? true : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    public function get_preview(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $page_id = (int) $request->get_param('id');
        $post    = get_post($page_id);
        if (!$post || 'page' !== $post->post_type) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['page_id' => $page_id]);
        }

        $device = (string) $request->get_param('device');
        if (!in_array($device, ['desktop', 'tablet', 'mobile'], true)) {
            $device = 'desktop';
        }

        $preview_id = wp_generate_uuid4();

        // URL base del post. Si es draft, añadir ?preview=true.
        $url = (string) get_permalink($page_id);
        if (in_array($post->post_status, ['draft', 'pending', 'future'], true)) {
            $url = add_query_arg(['preview' => 'true', 'preview_id' => $preview_id], $url);
        }

        // Si Elementor está activo, podemos forzar el preview con su parámetro.
        if (class_exists('\Elementor\Plugin')) {
            $url = add_query_arg('elementor-preview', (string) $page_id, $url);
        }

        // Viewport sugerido (CSS pixel sizes típicos).
        $viewport = match ($device) {
            'mobile' => ['width' => 375, 'height' => 812],
            'tablet' => ['width' => 768, 'height' => 1024],
            default  => ['width' => 1440, 'height' => 900],
        };

        return new \WP_REST_Response([
            'success' => true,
            'data' => [
                'url'        => esc_url_raw($url),
                'device'     => $device,
                'viewport'   => $viewport,
                'page_id'    => $page_id,
                'preview_id' => $preview_id,
            ],
        ], 200);
    }

    public function get_design_system(\WP_REST_Request $request): \WP_REST_Response
    {
        $ds   = new \AIWebsiteBridge\Design_System();
        $full = $ds->get();
        // G8 fix: este endpoint devuelve solo design tokens (colors, fonts, spacing, buttons).
        // Los site settings globales están en /site-settings.
        $design_only = array_filter(
            $full,
            static fn ($_v, $k): bool => $k !== 'global_settings',
            ARRAY_FILTER_USE_BOTH
        );
        return new \WP_REST_Response([
            'success' => true,
            'data'    => $design_only,
        ], 200);
    }

    /**
     * G8 fix: nuevo endpoint para site settings (antes mezclado con /design-system).
     */
    public function get_site_settings(\WP_REST_Request $request): \WP_REST_Response
    {
        $ds   = new \AIWebsiteBridge\Design_System();
        $full = $ds->get();
        $global = $full['global_settings'] ?? [];
        return new \WP_REST_Response([
            'success' => true,
            'data'    => $global,
        ], 200);
    }
}
