<?php
/**
 * Revision_Manager
 *
 * Crea snapshots antes de cada escritura y permite restaurarlos (rollback).
 * Implementa SRS §23 y §24.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Revision_Manager
{
    /**
     * Crea un snapshot del estado actual de la página antes de una escritura.
     *
     * @param int    $page_id    ID de la página.
     * @param string $change_id  Identificador único del change (UUID del orchestrator).
     * @param string $operation  Nombre de la operación que se va a ejecutar.
     * @return int|false ID del snapshot creado, o false si falló.
     */
    public function create_snapshot(int $page_id, string $change_id, string $operation): int|false
    {
        global $wpdb;
        $table = $wpdb->prefix . 'ai_agent_snapshots';

        $post = get_post($page_id);
        if (!$post) {
            return false;
        }

        $row = [
            'change_id'      => sanitize_key($change_id),
            'page_id'        => $page_id,
            'operation'      => sanitize_key($operation),
            'elementor_data' => get_post_meta($page_id, '_elementor_data', true),
            'post_content'   => $post->post_content,
            'post_title'     => $post->post_title,
            'post_meta'      => wp_json_encode($this->snapshot_post_meta($page_id)),
            'created_at'     => current_time('mysql'),
        ];

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $result = $wpdb->insert($table, $row);
        return $result ? (int) $wpdb->insert_id : false;
    }

    /**
     * Restaura un snapshot. El change_id del snapshot debe ser el que se quiere revertir.
     *
     * @return bool|\WP_Error
     */
    public function rollback(string $change_id): bool|\WP_Error
    {
        global $wpdb;
        $table = $wpdb->prefix . 'ai_agent_snapshots';

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $snapshot = $wpdb->get_row(
            $wpdb->prepare("SELECT * FROM {$table} WHERE change_id = %s ORDER BY id DESC LIMIT 1", $change_id),
            ARRAY_A
        );

        if (!$snapshot) {
            return new \WP_Error('SNAPSHOT_NOT_FOUND', sprintf('No snapshot found for change "%s".', $change_id), ['change_id' => $change_id]);
        }

        $page_id = (int) $snapshot['page_id'];
        $post    = get_post($page_id);
        if (!$post) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['page_id' => $page_id]);
        }

        // Restaurar post_content y post_title.
        wp_update_post([
            'ID'           => $page_id,
            'post_content' => (string) $snapshot['post_content'],
            'post_title'   => (string) $snapshot['post_title'],
        ]);

        // Restaurar _elementor_data.
        if (!empty($snapshot['elementor_data'])) {
            update_post_meta($page_id, '_elementor_data', $snapshot['elementor_data']);
        } else {
            delete_post_meta($page_id, '_elementor_data');
        }

        // Restaurar otros meta del snapshot.
        $meta = json_decode((string) $snapshot['post_meta'], true);
        if (is_array($meta)) {
            foreach ($meta as $key => $value) {
                // No sobrescribir _elementor_data (ya lo hicimos arriba).
                if ($key === '_elementor_data') {
                    continue;
                }
                update_post_meta($page_id, $key, $value);
            }
        }

        return true;
    }

    /**
     * Snapshot de todos los post_meta relevantes para Elementor.
     */
    private function snapshot_post_meta(int $page_id): array
    {
        $keys = [
            '_elementor_data',
            '_elementor_edit_mode',
            '_elementor_template_type',
            '_elementor_version',
            '_elementor_pro_version',
            '_wp_page_template',
        ];

        $meta = [];
        foreach ($keys as $key) {
            $value = get_post_meta($page_id, $key, true);
            if ($value !== '' && $value !== false) {
                $meta[$key] = $value;
            }
        }

        return $meta;
    }

    /**
     * Lista snapshots para una página.
     *
     * @return array<int, array<string, mixed>>
     */
    public function list_snapshots(int $page_id, int $limit = 50): array
    {
        global $wpdb;
        $table = $wpdb->prefix . 'ai_agent_snapshots';

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $rows = $wpdb->get_results(
            $wpdb->prepare("SELECT id, change_id, page_id, operation, created_at FROM {$table} WHERE page_id = %d ORDER BY id DESC LIMIT %d", $page_id, $limit),
            ARRAY_A
        );

        return array_map(static fn (array $r): array => [
            'id'         => (int) $r['id'],
            'change_id'  => (string) $r['change_id'],
            'page_id'    => (int) $r['page_id'],
            'operation'  => (string) $r['operation'],
            'created_at' => (string) $r['created_at'],
        ], is_array($rows) ? $rows : []);
    }
}
