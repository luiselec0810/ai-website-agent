<?php
/**
 * Elementor_Validator
 *
 * Valida que los widgets referenciados existan en la instalación actual de Elementor.
 * Detecta dinámicamente widgets disponibles (incluyendo Pro si está instalado).
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Elementor;

defined('ABSPATH') || exit;

final class Elementor_Validator
{
    /**
     * Lista de widgets core que asumimos disponibles si Elementor está instalado.
     * Estos son widgets built-in que vienen con Elementor free.
     */
    private const CORE_WIDGETS = [
        'heading',
        'text-editor',
        'button',
        'image',
        'video',
        'icon',
        'spacer',
        'divider',
        'html',
        'shortcode',
        'image-box',
        'star-rating',
        'google-maps',
        'progress',
        'counter',
        'accordion',
        'tabs',
        'toggle',
        'social-icons',
        'image-carousel',
        'basic-gallery',
        'icon-list',
        'image-gallery',
        'loop-grid',
    ];

    /**
     * Lista de widgets Pro (si Elementor Pro está instalado).
     */
    private const PRO_WIDGETS = [
        'form',
        'posts',
        'gallery',
        'slides',
        'price-table',
        'testimonial',
        'nav-menu',
        'animated-headline',
        'cta',
        'flip-box',
        'media-carousel',
        'template',
        'login',
        'author-box',
        'breadcrumbs',
        'call-to-action',
        'countdown',
        'hotspot',
        'image-comparison',
        'lottie',
        'mega-menu',
        'portfolio',
        'price-list',
        'reviews',
        'share-buttons',
        'skill-bar',
        'table-of-contents',
    ];

    /**
     * Verifica si Elementor está instalado y activo.
     */
    public function is_elementor_active(): bool
    {
        return class_exists('\Elementor\Plugin');
    }

    /**
     * Verifica si Elementor Pro está instalado y activo.
     */
    public function is_elementor_pro_active(): bool
    {
        return defined('ELEMENTOR_PRO_VERSION');
    }

    /**
     * Verifica si un widget existe en la instalación actual.
     */
    public function widget_exists(string $widget_type): bool
    {
        if (!$this->is_elementor_active()) {
            return false;
        }

        // Si el widget es Pro y Pro no está instalado, fallar.
        if (in_array($widget_type, self::PRO_WIDGETS, true) && !$this->is_elementor_pro_active()) {
            return false;
        }

        // Si el widget no es ni core ni Pro conocido, fallar.
        if (!in_array($widget_type, self::CORE_WIDGETS, true) && !in_array($widget_type, self::PRO_WIDGETS, true)) {
            return false;
        }

        // Verificación dinámica con widgets_manager (más estricto).
        try {
            $widgets = \Elementor\Plugin::instance()->widgets_manager->get_widget_types();
            return isset($widgets[$widget_type]);
        } catch (\Throwable) {
            // Si falla el lookup dinámico, caer al whitelist.
            return true;
        }
    }

    /**
     * Devuelve la lista de widgets disponibles en la instalación actual.
     *
     * @return array<int, string>
     */
    public function available_widgets(): array
    {
        if (!$this->is_elementor_active()) {
            return [];
        }
        try {
            $widgets = \Elementor\Plugin::instance()->widgets_manager->get_widget_types();
            return array_values(array_keys($widgets));
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * Valida los settings de un widget (validación básica por ahora).
     * Para MVP, solo verificamos que sea un array.
     * Una validación más estricta se puede agregar por widget con JSON Schema.
     */
    public function validate_settings(string $widget_type, array $settings): bool|\WP_Error
    {
        if (!$this->widget_exists($widget_type)) {
            return new \WP_Error('INVALID_WIDGET_TYPE', sprintf('Widget type "%s" is not available.', $widget_type));
        }
        // Validación específica por widget (versión MVP: solo casos comunes).
        switch ($widget_type) {
            case 'heading':
                if (isset($settings['header_size']) && !in_array($settings['header_size'], ['h1','h2','h3','h4','h5','h6','div','span','p'], true)) {
                    return new \WP_Error('INVALID_HEADER_SIZE', 'Invalid header_size value.');
                }
                break;
            case 'button':
                if (isset($settings['align']) && !in_array($settings['align'], ['left','center','right','justify'], true)) {
                    return new \WP_Error('INVALID_ALIGN', 'Invalid button align.');
                }
                break;
        }
        return true;
    }

    /**
     * Devuelve la versión de Elementor.
     */
    public function elementor_version(): ?string
    {
        return defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null;
    }
}
