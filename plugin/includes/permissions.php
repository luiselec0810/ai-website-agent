<?php
/**
 * Permissions
 *
 * Centraliza las verificaciones de capabilities para los endpoints REST.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Permissions
{
    /**
     * Devuelve true si el usuario actual puede usar endpoints de lectura.
     */
    public function can_read(): bool
    {
        return current_user_can('edit_posts');
    }

    /**
     * Devuelve true si el usuario puede crear/editar páginas.
     */
    public function can_edit_pages(): bool
    {
        return current_user_can('edit_pages');
    }

    /**
     * Devuelve true si el usuario puede publicar páginas.
     */
    public function can_publish_pages(): bool
    {
        return current_user_can('publish_pages');
    }

    /**
     * Devuelve true si el usuario puede administrar el plugin (gestionar API keys, ver audit log).
     */
    public function can_manage_plugin(): bool
    {
        return current_user_can('manage_options');
    }

    /**
     * Mapea una capability a un nombre legible para errores.
     */
    public function capability_label(string $capability): string
    {
        $labels = [
            'edit_posts'      => 'edit_posts',
            'edit_pages'      => 'edit_pages',
            'publish_pages'   => 'publish_pages',
            'manage_options'  => 'manage_options',
        ];
        return $labels[$capability] ?? $capability;
    }
}
