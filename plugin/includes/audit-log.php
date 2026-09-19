<?php
/**
 * Audit_Log
 *
 * Registra cada operación (exitosa o fallida) en la tabla wp_ai_agent_audit.
 * Implementa SRS §25.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Audit_Log
{
    /**
     * Registra una entrada de auditoría.
     *
     * @param array<string, mixed> $args {
     *     @type string      $action         Nombre de la acción (ej: update_widget).
     *     @type int|null    $page_id        ID de la página afectada.
     *     @type string|null $element_id     ID del elemento Elementor.
     *     @type mixed       $before_state   Estado anterior (cualquier tipo).
     *     @type mixed       $after_state    Estado nuevo (cualquier tipo).
     *     @type bool        $success        Si la operación fue exitosa.
     *     @type string|null $error_code     Código de error si falló.
     *     @type string|null $error_message  Mensaje de error si falló.
     *     @type string|null $api_key_id     Prefijo de la API key usada.
     * }
     */
    public function log(array $args): int|false
    {
        global $wpdb;
        $table = $wpdb->prefix . 'ai_agent_audit';

        $user_id = get_current_user_id();

        $row = [
            'api_key_id'    => isset($args['api_key_id']) ? sanitize_text_field((string) $args['api_key_id']) : '',
            'user_id'       => $user_id,
            'ip'            => $this->get_client_ip(),
            'action'        => sanitize_key((string) ($args['action'] ?? 'unknown')),
            'page_id'       => isset($args['page_id']) && is_numeric($args['page_id']) ? absint($args['page_id']) : null,
            'element_id'    => isset($args['element_id']) ? sanitize_text_field((string) $args['element_id']) : null,
            'before_state'  => $this->encode_state($args['before_state'] ?? null),
            'after_state'   => $this->encode_state($args['after_state'] ?? null),
            'success'       => !empty($args['success']) ? 1 : 0,
            'error_code'    => isset($args['error_code']) ? sanitize_key((string) $args['error_code']) : null,
            'error_message' => isset($args['error_message']) ? sanitize_text_field((string) $args['error_message']) : null,
            'created_at'    => current_time('mysql'),
        ];

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $result = $wpdb->insert($table, $row);
        return $result ? (int) $wpdb->insert_id : false;
    }

    /**
     * Lista entradas con paginación.
     *
     * @param array<string, mixed> $filters
     * @return array<int, array<string, mixed>>
     */
    public function list_entries(array $filters = []): array
    {
        global $wpdb;
        $table = $wpdb->prefix . 'ai_agent_audit';

        $where = ['1=1'];
        $params = [];

        if (!empty($filters['page_id'])) {
            $where[] = 'page_id = %d';
            $params[] = absint($filters['page_id']);
        }
        if (!empty($filters['action'])) {
            $where[] = 'action = %s';
            $params[] = sanitize_key((string) $filters['action']);
        }
        if (isset($filters['success'])) {
            $where[] = 'success = %d';
            $params[] = !empty($filters['success']) ? 1 : 0;
        }

        $limit  = isset($filters['limit']) ? max(1, min(100, (int) $filters['limit'])) : 50;
        $offset = isset($filters['offset']) ? max(0, (int) $filters['offset']) : 0;

        $where_sql = implode(' AND ', $where);
        $sql = "SELECT * FROM {$table} WHERE {$where_sql} ORDER BY created_at DESC LIMIT %d OFFSET %d";
        $params[] = $limit;
        $params[] = $offset;

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.PreparedSQL.InterpolatedNotPrepared
        $rows = $wpdb->get_results($wpdb->prepare($sql, $params), ARRAY_A);

        return array_map([$this, 'normalize_row'], is_array($rows) ? $rows : []);
    }

    /**
     * Devuelve una entrada por ID.
     *
     * @return array<string, mixed>|null
     */
    public function get_entry(int $id): ?array
    {
        global $wpdb;
        $table = $wpdb->prefix . 'ai_agent_audit';

        // phpcs:ignore WordPress.DB.DirectDatabaseQuery
        $row = $wpdb->get_row($wpdb->prepare("SELECT * FROM {$table} WHERE id = %d", $id), ARRAY_A);
        return $row ? $this->normalize_row($row) : null;
    }

    /**
     * Normaliza una fila de la BD a un array listo para JSON.
     */
    private function normalize_row(array $row): array
    {
        return [
            'id'            => (int) $row['id'],
            'api_key_id'    => (string) $row['api_key_id'],
            'user_id'       => (int) $row['user_id'],
            'ip'            => (string) $row['ip'],
            'action'        => (string) $row['action'],
            'page_id'       => $row['page_id'] !== null ? (int) $row['page_id'] : null,
            'element_id'    => $row['element_id'] !== null ? (string) $row['element_id'] : null,
            'before'        => $this->decode_state($row['before_state'] ?? null),
            'after'         => $this->decode_state($row['after_state'] ?? null),
            'success'       => (bool) $row['success'],
            'error_code'    => $row['error_code'] !== null ? (string) $row['error_code'] : null,
            'error_message' => $row['error_message'] !== null ? (string) $row['error_message'] : null,
            'created_at'    => (string) $row['created_at'],
        ];
    }

    /**
     * Codifica un estado (array/objeto) a JSON string para guardar en BD.
     */
    private function encode_state(mixed $state): ?string
    {
        if ($state === null) {
            return null;
        }
        return wp_json_encode($state, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    /**
     * Decodifica JSON string de BD a un array/objeto.
     */
    private function decode_state(?string $json): mixed
    {
        if ($json === null || '' === $json) {
            return null;
        }
        $decoded = json_decode($json, true);
        return $decoded;
    }

    private function get_client_ip(): string
    {
        $candidates = ['HTTP_CF_CONNECTING_IP', 'HTTP_X_FORWARDED_FOR', 'REMOTE_ADDR'];
        foreach ($candidates as $key) {
            if (!empty($_SERVER[$key])) {
                $ip = sanitize_text_field((string) $_SERVER[$key]);
                if (str_contains($ip, ',')) {
                    $ip = trim(explode(',', $ip)[0]);
                }
                if (filter_var($ip, FILTER_VALIDATE_IP)) {
                    return $ip;
                }
            }
        }
        return '0.0.0.0';
    }
}
