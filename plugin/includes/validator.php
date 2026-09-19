<?php
/**
 * Validator
 *
 * Validaciones genéricas para todos los endpoints REST.
 * Cada método devuelve true o lanza WP_Error con código estructurado.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Validator
{
    /**
     * Valida que un ID sea un entero positivo.
     */
    public function validate_id(mixed $id, string $field = 'id'): bool|\WP_Error
    {
        if (!is_numeric($id)) {
            return new \WP_Error('INVALID_ID', sprintf('Field "%s" must be a positive integer.', $field), ['field' => $field, 'value' => $id]);
        }
        $abs = absint($id);
        if ($abs <= 0) {
            return new \WP_Error('INVALID_ID', sprintf('Field "%s" must be greater than zero.', $field), ['field' => $field]);
        }
        return true;
    }

    /**
     * Valida y sanea un string corto (títulos, labels).
     */
    public function validate_text(mixed $value, string $field, int $max_length = 200, bool $allow_empty = false): string|\WP_Error
    {
        if (!is_string($value)) {
            return new \WP_Error('INVALID_TEXT', sprintf('Field "%s" must be a string.', $field), ['field' => $field]);
        }
        $sanitized = sanitize_text_field($value);
        if (!$allow_empty && '' === $sanitized) {
            return new \WP_Error('EMPTY_TEXT', sprintf('Field "%s" cannot be empty.', $field), ['field' => $field]);
        }
        if (strlen($sanitized) > $max_length) {
            return new \WP_Error('TEXT_TOO_LONG', sprintf('Field "%s" exceeds max length (%d).', $field, $max_length), ['field' => $field, 'max' => $max_length]);
        }
        return $sanitized;
    }

    /**
     * Valida un slug de página.
     */
    public function validate_slug(mixed $value): string|\WP_Error
    {
        if (!is_string($value)) {
            return new \WP_Error('INVALID_SLUG', 'Slug must be a string.');
        }
        $sanitized = sanitize_title($value);
        if ('' === $sanitized) {
            return new \WP_Error('INVALID_SLUG', 'Slug is not valid after sanitization.');
        }
        return $sanitized;
    }

    /**
     * Valida un status de post contra los valores permitidos.
     */
    public function validate_post_status(mixed $status): string|\WP_Error
    {
        $allowed = ['publish', 'draft', 'private', 'pending', 'future'];
        if (!is_string($status)) {
            return new \WP_Error('INVALID_STATUS', 'Status must be a string.');
        }
        if (!in_array($status, $allowed, true)) {
            return new \WP_Error('INVALID_STATUS', sprintf('Status "%s" is not allowed. Allowed: %s', $status, implode(', ', $allowed)), ['allowed' => $allowed]);
        }
        return $status;
    }

    /**
     * Valida un array de settings contra un JSON Schema simplificado.
     *
     * Para el MVP, validamos solo que sea un array asociativo con claves string.
     * La validación estricta de cada setting de widget se hace en ElementorValidator.
     */
    public function validate_settings_array(mixed $settings): array|\WP_Error
    {
        if (!is_array($settings)) {
            return new \WP_Error('INVALID_SETTINGS', 'Settings must be an object/array.');
        }
        // No permitir claves con __ (PHP magic methods / object injection).
        foreach (array_keys($settings) as $key) {
            if (!is_string($key) || str_starts_with($key, '__')) {
                return new \WP_Error('INVALID_SETTINGS_KEY', 'Settings keys must be strings without __ prefix.', ['key' => $key]);
            }
        }
        return $settings;
    }

    /**
     * Valida un ID de elemento de Elementor (string alfanumérico).
     */
    public function validate_element_id(mixed $id): string|\WP_Error
    {
        if (!is_string($id) || !preg_match('/^[a-zA-Z0-9_-]{1,64}$/', $id)) {
            return new \WP_Error('INVALID_ELEMENT_ID', 'Element ID must be alphanumeric (1-64 chars).');
        }
        return $id;
    }

    /**
     * Helper: ¿es el resultado un WP_Error?
     */
    public function is_error(mixed $value): bool
    {
        return is_wp_error($value);
    }
}
