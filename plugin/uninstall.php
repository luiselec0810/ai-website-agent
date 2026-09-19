<?php
/**
 * uninstall.php
 *
 * Se ejecuta cuando el usuario elimina el plugin desde el admin de WordPress.
 * Limpia todas las opciones, tablas y transients creados por el plugin.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

if (!defined('WP_UNINSTALL_PLUGIN')) {
    exit;
}

global $wpdb;

// Eliminar opciones del plugin.
delete_option('ai_agent_api_keys');
delete_option('ai_agent_db_version');
delete_option('ai_agent_settings');

// Eliminar tablas del plugin.
$tables = [
    $wpdb->prefix . 'ai_agent_audit',
    $wpdb->prefix . 'ai_agent_snapshots',
];

foreach ($tables as $table) {
    // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    $wpdb->query("DROP TABLE IF EXISTS {$table}");
}

// Limpiar transients del plugin.
$wpdb->query(
    "DELETE FROM {$wpdb->options} WHERE option_name LIKE '_transient_ai_agent_%' OR option_name LIKE '_transient_timeout_ai_agent_%'"
);
