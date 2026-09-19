<?php
/**
 * Settings page (admin UI)
 *
 * Permite al administrador:
 *   - Ver y generar nuevas API keys para el agente.
 *   - Ver la lista de API keys activas (hash truncado, nunca la key plana).
 *   - Revocar API keys.
 *   - Ver últimas entradas del audit log.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\AdminPanel;

use AIWebsiteBridge\Plugin;

defined('ABSPATH') || exit;

final class Settings_Panel
{
    public static function register(): void
    {
        add_action('admin_menu', [self::class, 'add_menu']);
        add_action('admin_post_ai_agent_create_key', [self::class, 'handle_create_key']);
        add_action('admin_post_ai_agent_revoke_key', [self::class, 'handle_revoke_key']);
    }

    public static function add_menu(): void
    {
        add_options_page(
            __('AI Website Bridge', 'ai-website-bridge'),
            __('AI Agent', 'ai-website-bridge'),
            'manage_options',
            'ai-website-bridge',
            [self::class, 'render']
        );
    }

    public static function handle_create_key(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Insufficient permissions.', 'ai-website-bridge'));
        }
        check_admin_referer('ai_agent_create_key');

        $label  = isset($_POST['label']) ? sanitize_text_field((string) wp_unslash($_POST['label'])) : '';
        $user_id = get_current_user_id();

        $plain = Plugin::instance()->auth->create_api_key($user_id, $label);

        // Mostrar la key en una pantalla de confirmación (solo esta vez).
        set_transient('ai_agent_new_key_' . $user_id, $plain, MINUTE_IN_SECONDS * 5);

        wp_safe_redirect(add_query_arg(['page' => 'ai-website-bridge', 'created' => '1'], admin_url('options-general.php')));
        exit;
    }

    public static function handle_revoke_key(): void
    {
        if (!current_user_can('manage_options')) {
            wp_die(esc_html__('Insufficient permissions.', 'ai-website-bridge'));
        }
        check_admin_referer('ai_agent_revoke_key');

        $prefix = isset($_POST['key_prefix']) ? sanitize_text_field((string) wp_unslash($_POST['key_prefix'])) : '';
        if ('' === $prefix) {
            wp_safe_redirect(add_query_arg(['page' => 'ai-website-bridge', 'error' => 'empty_prefix'], admin_url('options-general.php')));
            exit;
        }

        Plugin::instance()->auth->revoke_api_key($prefix);

        wp_safe_redirect(add_query_arg(['page' => 'ai-website-bridge', 'revoked' => '1'], admin_url('options-general.php')));
        exit;
    }

    public static function render(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $plugin  = Plugin::instance();
        $keys    = $plugin->auth->list_api_keys();
        $entries = $plugin->audit_log->list_entries(['limit' => 20]);

        $user_id     = get_current_user_id();
        $new_key     = get_transient('ai_agent_new_key_' . $user_id);
        $just_created = isset($_GET['created']) && '1' === $_GET['created'];
        $just_revoked = isset($_GET['revoked']) && '1' === $_GET['revoked'];

        ?>
        <div class="wrap">
            <h1><?php esc_html_e('AI Website Bridge', 'ai-website-bridge'); ?></h1>

            <p><?php esc_html_e('Gestiona las API Keys que usa el agente IA para conectarse a este sitio.', 'ai-website-bridge'); ?></p>

            <?php if ($new_key && $just_created) : ?>
                <div class="notice notice-success is-dismissible">
                    <p><strong><?php esc_html_e('Nueva API Key generada. Cópiala ahora — no se mostrará de nuevo.', 'ai-website-bridge'); ?></strong></p>
                    <p><code style="font-size:14px; user-select:all;"><?php echo esc_html($new_key); ?></code></p>
                </div>
                <?php delete_transient('ai_agent_new_key_' . $user_id); ?>
            <?php endif; ?>

            <?php if ($just_revoked) : ?>
                <div class="notice notice-warning is-dismissible">
                    <p><?php esc_html_e('API Key revocada.', 'ai-website-bridge'); ?></p>
                </div>
            <?php endif; ?>

            <h2><?php esc_html_e('API Keys activas', 'ai-website-bridge'); ?></h2>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Prefijo (hash)', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Etiqueta', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Usuario WP', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Creada', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Último uso', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Acción', 'ai-website-bridge'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($keys)) : ?>
                        <tr><td colspan="6"><?php esc_html_e('No hay API keys todavía.', 'ai-website-bridge'); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ($keys as $k) : ?>
                            <tr>
                                <td><code><?php echo esc_html($k['key_prefix']); ?>…</code></td>
                                <td><?php echo esc_html($k['label']); ?></td>
                                <td><?php echo esc_html((string) $k['user_id']); ?></td>
                                <td><?php echo esc_html($k['created']); ?></td>
                                <td><?php echo esc_html((string) ($k['last_used'] ?? '—')); ?></td>
                                <td>
                                    <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>" style="display:inline;">
                                        <?php wp_nonce_field('ai_agent_revoke_key'); ?>
                                        <input type="hidden" name="action" value="ai_agent_revoke_key">
                                        <input type="hidden" name="key_prefix" value="<?php echo esc_attr($k['key_prefix']); ?>">
                                        <button type="submit" class="button button-small button-link-delete" onclick="return confirm('¿Revocar esta key?');">
                                            <?php esc_html_e('Revocar', 'ai-website-bridge'); ?>
                                        </button>
                                    </form>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>

            <h2><?php esc_html_e('Generar nueva API Key', 'ai-website-bridge'); ?></h2>
            <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
                <?php wp_nonce_field('ai_agent_create_key'); ?>
                <input type="hidden" name="action" value="ai_agent_create_key">
                <p>
                    <label for="label"><?php esc_html_e('Etiqueta (opcional):', 'ai-website-bridge'); ?></label>
                    <input type="text" name="label" id="label" class="regular-text" placeholder="Mi agente IA">
                </p>
                <?php submit_button(__('Generar API Key', 'ai-website-bridge')); ?>
            </form>

            <h2><?php esc_html_e('Últimas operaciones del agente', 'ai-website-bridge'); ?></h2>
            <table class="widefat striped">
                <thead>
                    <tr>
                        <th><?php esc_html_e('Fecha', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Acción', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Página', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Elemento', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Resultado', 'ai-website-bridge'); ?></th>
                        <th><?php esc_html_e('Error', 'ai-website-bridge'); ?></th>
                    </tr>
                </thead>
                <tbody>
                    <?php if (empty($entries)) : ?>
                        <tr><td colspan="6"><?php esc_html_e('Sin actividad todavía.', 'ai-website-bridge'); ?></td></tr>
                    <?php else : ?>
                        <?php foreach ($entries as $e) : ?>
                            <tr>
                                <td><?php echo esc_html($e['created_at']); ?></td>
                                <td><code><?php echo esc_html($e['action']); ?></code></td>
                                <td><?php echo $e['page_id'] ? esc_html((string) $e['page_id']) : '—'; ?></td>
                                <td><?php echo $e['element_id'] ? esc_html($e['element_id']) : '—'; ?></td>
                                <td>
                                    <?php if ($e['success']) : ?>
                                        <span style="color:green;">✓</span>
                                    <?php else : ?>
                                        <span style="color:red;">✗</span>
                                    <?php endif; ?>
                                </td>
                                <td><?php echo esc_html((string) ($e['error_code'] ?? '')); ?></td>
                            </tr>
                        <?php endforeach; ?>
                    <?php endif; ?>
                </tbody>
            </table>

            <hr>
            <p>
                <strong><?php esc_html_e('Endpoint REST:', 'ai-website-bridge'); ?></strong>
                <code><?php echo esc_html(rest_url('ai-agent/v1/health')); ?></code>
            </p>
            <p>
                <strong><?php esc_html_e('Auth header:', 'ai-website-bridge'); ?></strong>
                <code>X-AI-Agent-Key: &lt;tu-api-key&gt;</code>
            </p>
        </div>
        <?php
    }
}
