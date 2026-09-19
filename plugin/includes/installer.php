<?php
/**
 * Installer
 *
 * Se ejecuta en activation hook. Crea las tablas y opciones necesarias.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Installer
{
    public const DB_VERSION = '1.0.0';

    /**
     * Crea tablas y opciones por defecto.
     */
    public static function activate(): void
    {
        self::create_tables();
        self::create_default_options();
        update_option('ai_agent_db_version', self::DB_VERSION);
    }

    private static function create_tables(): void
    {
        global $wpdb;
        require_once ABSPATH . 'wp-admin/includes/upgrade.php';

        $charset_collate = $wpdb->get_charset_collate();

        $audit_table = $wpdb->prefix . 'ai_agent_audit';
        $snapshots_table = $wpdb->prefix . 'ai_agent_snapshots';

        // SQL de la tabla de auditoría. Cada operación del agente se registra aquí.
        // phpcs:disable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $sql_audit = "CREATE TABLE {$audit_table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            api_key_id VARCHAR(64) NOT NULL DEFAULT '',
            user_id BIGINT UNSIGNED NOT NULL DEFAULT 0,
            ip VARCHAR(45) NOT NULL DEFAULT '',
            action VARCHAR(64) NOT NULL,
            page_id BIGINT UNSIGNED NULL,
            element_id VARCHAR(64) NULL,
            before_state LONGTEXT NULL,
            after_state LONGTEXT NULL,
            success TINYINT(1) NOT NULL DEFAULT 1,
            error_code VARCHAR(64) NULL,
            error_message TEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY page_id (page_id),
            KEY action (action),
            KEY created_at (created_at)
        ) {$charset_collate};";

        // SQL de la tabla de snapshots. Antes de cada escritura, se guarda el estado
        // anterior aquí para permitir rollback.
        $sql_snapshots = "CREATE TABLE {$snapshots_table} (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
            change_id VARCHAR(64) NOT NULL,
            page_id BIGINT UNSIGNED NOT NULL,
            operation VARCHAR(64) NOT NULL,
            elementor_data LONGTEXT NULL,
            post_content LONGTEXT NULL,
            post_title TEXT NULL,
            post_meta LONGTEXT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            KEY change_id (change_id),
            KEY page_id (page_id)
        ) {$charset_collate};";

        dbDelta($sql_audit);
        dbDelta($sql_snapshots);
        // phpcs:enable WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
    }

    private static function create_default_options(): void
    {
        if (false === get_option('ai_agent_api_keys')) {
            update_option('ai_agent_api_keys', []);
        }

        if (false === get_option('ai_agent_settings')) {
            update_option('ai_agent_settings', [
                'rate_limit_per_minute' => 60,
                'enable_audit'          => true,
                'auto_snapshot'         => true,
            ]);
        }
    }
}
