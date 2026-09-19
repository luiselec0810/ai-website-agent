<?php
/**
 * REST_API
 *
 * Registra todos los endpoints REST del plugin bajo el namespace `ai-agent/v1`.
 * Aplica autenticación por API Key antes de permitir cualquier request.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Rest_API
{
    private const NAMESPACE = 'ai-agent/v1';

    private Auth $auth;
    private Permissions $permissions;
    private Validator $validator;
    private Audit_Log $audit_log;
    private Revision_Manager $revision_manager;

    public function __construct(
        Auth $auth,
        Permissions $permissions,
        Validator $validator,
        Audit_Log $audit_log,
        Revision_Manager $revision_manager
    ) {
        $this->auth             = $auth;
        $this->permissions      = $permissions;
        $this->validator        = $validator;
        $this->audit_log        = $audit_log;
        $this->revision_manager = $revision_manager;
    }

    /**
     * Registra los hooks de WP.
     */
    public function register_hooks(): void
    {
        // Hook de autenticación: intercepta antes de que WP determine el usuario.
        add_filter('determine_current_user', [$this->auth, 'authenticate_rest'], 20);

        // Registra rutas cuando WP carga REST API.
        add_action('rest_api_init', [$this, 'register_routes']);
    }

    /**
     * Registra todas las rutas del plugin.
     */
    public function register_routes(): void
    {
        $controllers = [
            \AIWebsiteBridge\Rest\Health_Controller::class,
            \AIWebsiteBridge\Rest\Pages_Controller::class,
            \AIWebsiteBridge\Rest\Elementor_Controller::class,
            \AIWebsiteBridge\Rest\Media_Controller::class,
            \AIWebsiteBridge\Rest\Templates_Controller::class,
            \AIWebsiteBridge\Rest\Preview_Controller::class,
            \AIWebsiteBridge\Rest\Audit_Controller::class,
            \AIWebsiteBridge\Rest\CLI_Controller::class,
            \AIWebsiteBridge\Rest\Global_Widget_Controller::class,
        ];

        foreach ($controllers as $controller_class) {
            if (!class_exists($controller_class)) {
                continue;
            }
            $instance = new $controller_class(
                $this->permissions,
                $this->validator,
                $this->audit_log,
                $this->revision_manager
            );
            if (method_exists($instance, 'register_routes')) {
                $instance->register_routes();
            }
        }
    }

    public static function namespace(): string
    {
        return self::NAMESPACE;
    }
}
