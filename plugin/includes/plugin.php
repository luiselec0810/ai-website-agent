<?php
/**
 * Plugin (singleton principal)
 *
 * Coordina los hooks, inicializa los servicios y arranca el REST API.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

use AIWebsiteBridge\AdminPanel\Settings_Panel;

defined('ABSPATH') || exit;

final class Plugin
{
    private static ?Plugin $instance = null;

    public Rest_API $rest_api;
    public Auth $auth;
    public Permissions $permissions;
    public Validator $validator;
    public Audit_Log $audit_log;
    public Revision_Manager $revision_manager;

    public static function instance(): Plugin
    {
        if (null === self::$instance) {
            self::$instance = new self();
        }
        return self::$instance;
    }

    private function __construct()
    {
        $this->validator        = new Validator();
        $this->permissions      = new Permissions();
        $this->auth             = new Auth($this->permissions);
        $this->audit_log        = new Audit_Log();
        $this->revision_manager = new Revision_Manager();
        $this->rest_api         = new Rest_API(
            $this->auth,
            $this->permissions,
            $this->validator,
            $this->audit_log,
            $this->revision_manager
        );
    }

    /**
     * Llamado por el bootstrap (plugins_loaded).
     * Registra los hooks principales.
     */
    public function boot(): void
    {
        $this->rest_api->register_hooks();
        $this->register_admin();
        load_plugin_textdomain('ai-website-bridge', false, dirname(plugin_basename(AI_WEBSITE_BRIDGE_FILE)) . '/languages');
    }

    /**
     * Hook de deactivation.
     */
    public static function deactivate(): void
    {
        // Limpiar transients programados si los hubiera.
        wp_clear_scheduled_hook('ai_agent_cleanup_audit_log');
    }

    private function register_admin(): void
    {
        if (is_admin()) {
            require_once AI_WEBSITE_BRIDGE_DIR . 'includes/admin-panel/settings-panel.php';
            Settings_Panel::register();
        }
    }
}
