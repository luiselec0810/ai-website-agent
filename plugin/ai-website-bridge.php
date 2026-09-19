<?php
/**
 * Plugin Name: AI Website Bridge
 * Plugin URI:  https://github.com/your-org/ai-website-agent
 * Description: REST API that lets an external AI agent read, create and modify WordPress + Elementor sites through safe, semantic, auditable and reversible tools. The agent never touches the WordPress database directly.
 * Version:     1.0.0
 * Requires at least: 6.0
 * Requires PHP: 8.1
 * Author:      AI Website Agent Team
 * License:     MIT
 * Text Domain: ai-website-bridge
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

// ─────────────────────────────────────────────────────────────────
// Constantes del plugin
// ─────────────────────────────────────────────────────────────────
define('AI_WEBSITE_BRIDGE_VERSION', '1.0.0');
define('AI_WEBSITE_BRIDGE_FILE', __FILE__);
define('AI_WEBSITE_BRIDGE_DIR', plugin_dir_path(__FILE__));
define('AI_WEBSITE_BRIDGE_URL', plugin_dir_url(__FILE__));
define('AI_WEBSITE_BRIDGE_REST_NAMESPACE', 'ai-agent/v1');

// ─────────────────────────────────────────────────────────────────
// Carga del autoloader de Composer (si existe)
// ─────────────────────────────────────────────────────────────────
$ai_website_bridge_autoload = AI_WEBSITE_BRIDGE_DIR . 'vendor/autoload.php';
if (file_exists($ai_website_bridge_autoload)) {
    require_once $ai_website_bridge_autoload;
} else {
    // Fallback: autoloader robusto para que el plugin funcione sin `composer install`.
    // Soporta DOS convenciones de naming:
    //   1. PSR-4 estricto: "AIWebsiteBridge\AuditLog" → "includes/AuditLog.php"
    //   2. Snake_case → kebab-case (WordPress convention):
    //      "AIWebsiteBridge\Audit_Log" → "includes/audit-log.php"
    //      "AIWebsiteBridge\Rest_API"  → "includes/rest-api.php"
    //
    // IMPORTANTE: cada segmento del namespace se prueba contra VARIAS variantes
    // de directorio y filename. Sin esto:
    //   - "AIWebsiteBridge\Rest\Health_Controller" buscaría "includes/Rest/..."
    //     y en Linux (case-sensitive) NO encontraría el archivo real
    //     "includes/rest/health-controller.php". Síntoma: 404 en TODAS las
    //     rutas REST aunque el plugin apareciera activo.
    //   - "AIWebsiteBridge\WordPress\Page_Service" generaría "word-press/"
    //     por kebab-case automático y NO encontraría "includes/wordpress/...".
    //     Síntoma: error crítico 500 en /wp-json/ (clases no encontradas al
    //     instanciar los controllers desde Rest_API::register_routes()).
    spl_autoload_register(static function (string $class): void {
        if (strpos($class, 'AIWebsiteBridge\\') !== 0) {
            return;
        }
        $relative = substr($class, strlen('AIWebsiteBridge\\'));

        // Construir el directorio y el basename esperado.
        $parts          = explode('\\', $relative);
        $class_basename = array_pop($parts);

        // Variantes del SUBDIRECTORIO (probar varias por segmento, por si la
        // convención local difiere — ej: "WordPress" vs "wordpress").
        $segment_variants = static function (string $seg): array {
            $lower = strtolower($seg);
            $kebab = strtolower(str_replace('_', '-', $seg));
            $camel_kebab = strtolower((string) preg_replace('/([a-z0-9])([A-Z])/', '$1-$2', $seg));
            return array_values(array_unique([$lower, $kebab, $camel_kebab, str_replace('-', '', $camel_kebab)]));
        };

        // Producto cartesiano de variantes de subdirectorios.
        $subdir_candidates = [''];
        foreach ($parts as $seg) {
            $next = [];
            foreach ($subdir_candidates as $prefix) {
                foreach ($segment_variants($seg) as $v) {
                    $next[] = $prefix === '' ? $v : $prefix . '/' . $v;
                }
            }
            $subdir_candidates = $next;
        }

        // Variantes del FILENAME (PSR-4 estricto + kebab).
        $file_variants = array_values(array_unique([
            $class_basename,
            strtolower(str_replace('_', '-', $class_basename)),
            lcfirst(str_replace('_', '-', $class_basename)),
            str_replace('_', '', $class_basename),
        ]));

        // Probar todas las combinaciones: subdir × filename.
        foreach ($subdir_candidates as $subdir) {
            $base_dir = AI_WEBSITE_BRIDGE_DIR . 'includes/' . ($subdir === '' ? '' : $subdir . '/');
            foreach ($file_variants as $fv) {
                $candidate = $base_dir . $fv . '.php';
                if (file_exists($candidate)) {
                    require_once $candidate;
                    return;
                }
            }
        }
    });
}

// ─────────────────────────────────────────────────────────────────
// Activation / Deactivation / Uninstall
// ─────────────────────────────────────────────────────────────────
register_activation_hook(__FILE__, static function (): void {
    require_once AI_WEBSITE_BRIDGE_DIR . 'includes/installer.php';
    AIWebsiteBridge\Installer::activate();
});

register_deactivation_hook(__FILE__, static function (): void {
    AIWebsiteBridge\Plugin::deactivate();
});

// Cargar uninstall.php (WP no usa hook, lo busca por convención de nombre)
if (defined('WP_UNINSTALL_PLUGIN')) {
    return;
}

// ─────────────────────────────────────────────────────────────────
// Bootstrap principal
// ─────────────────────────────────────────────────────────────────
add_action('plugins_loaded', static function (): void {
    \AIWebsiteBridge\Plugin::instance()->boot();
});

// ─────────────────────────────────────────────────────────────────
// DEBUG / DEV endpoint — crear API key sin auth
// Útil para reinicios de Local. SOLO activo si se define la constante.
// ─────────────────────────────────────────────────────────────────
add_action('rest_api_init', static function (): void {
    if (!defined('AI_WEBSITE_BRIDGE_DEV_BOOTSTRAP') || !AI_WEBSITE_BRIDGE_DEV_BOOTSTRAP) {
        return;
    }
    register_rest_route('ai-agent/v1', '/_dev/create-key', [
        'methods'             => 'POST,GET',
        'callback'            => static function (\WP_REST_Request $request): \WP_REST_Response {
            $user_id = (int) ($request->get_param('user_id') ?? 1);
            $user = get_user_by('id', $user_id);
            if (!$user) {
                return new \WP_REST_Response([
                    'success' => false,
                    'error'   => ['code' => 'USER_NOT_FOUND', 'message' => "User $user_id not found."],
                ], 404);
            }
            // Asegurar capabilities edit_pages
            $user->add_cap('edit_pages');
            $user->add_cap('edit_posts');
            $user->add_cap('publish_pages');
            $user->add_cap('read');

            $auth = new \AIWebsiteBridge\Auth(
                new \AIWebsiteBridge\Permissions()
            );
            $plain = $auth->create_api_key($user_id, 'Dev bootstrap');
            return new \WP_REST_Response([
                'success' => true,
                'data'    => [
                    'api_key'    => $plain,
                    'user_id'    => $user_id,
                    'user_login' => $user->user_login,
                    'message'    => 'Key created. Pass as X-AI-Agent-Key header.',
                ],
            ], 201);
        },
        'permission_callback' => '__return_true',
    ]);
});
