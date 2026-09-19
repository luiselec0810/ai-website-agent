<?php
/**
 * Design_System
 *
 * Lee el design system del sitio: colores globales, tipografías, espaciados.
 * Combina Global Colors y Global Fonts de Elementor con settings del theme.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Design_System
{
    /**
     * Devuelve el design system unificado del sitio.
     *
     * @return array<string, mixed>
     */
    public function get(): array
    {
        return [
            'colors'   => $this->get_colors(),
            'fonts'    => $this->get_fonts(),
            'spacing'  => $this->get_spacing(),
            'buttons'  => $this->get_button_defaults(),
            'global_settings' => $this->get_global_settings(),
        ];
    }

    /**
     * Lee los Global Colors de Elementor.
     *
     * @return array<string, string>
     */
    private function get_colors(): array
    {
        $colors = [];
        if (class_exists('\Elementor\Plugin')) {
            try {
                $kit = \Elementor\Plugin::instance()->kits_manager->get_active_kit();
                if ($kit) {
                    $system_colors = $kit->get_settings('system_colors');
                    if (is_array($system_colors)) {
                        foreach ($system_colors as $color) {
                            if (!empty($color['_id']) && !empty($color['color'])) {
                                $colors[(string) $color['_id']] = (string) $color['color'];
                            }
                        }
                    }
                    $custom_colors = $kit->get_settings('custom_colors');
                    if (is_array($custom_colors)) {
                        foreach ($custom_colors as $color) {
                            if (!empty($color['_id']) && !empty($color['color'])) {
                                $colors[(string) $color['_id']] = (string) $color['color'];
                            }
                        }
                    }
                }
            } catch (\Throwable) {
                // Si falla, devolver defaults.
            }
        }

        if (empty($colors)) {
            $colors = [
                'primary'   => '#FF6B00',
                'secondary' => '#1A1A1A',
                'text'      => '#333333',
                'accent'    => '#FFD700',
            ];
        }

        return $colors;
    }

    /**
     * Lee los Global Fonts de Elementor.
     *
     * @return array<string, string>
     */
    private function get_fonts(): array
    {
        $fonts = [];
        if (class_exists('\Elementor\Plugin')) {
            try {
                $kit = \Elementor\Plugin::instance()->kits_manager->get_active_kit();
                if ($kit) {
                    $system_fonts = $kit->get_settings('system_typography');
                    if (is_array($system_fonts)) {
                        foreach ($system_fonts as $font) {
                            if (!empty($font['_id'])) {
                                $id = (string) $font['_id'];
                                $fonts[$id] = [
                                    'family' => $font['typography_font_family'] ?? 'sans-serif',
                                    'weight' => $font['typography_font_weight'] ?? '400',
                                    'size'   => $font['typography_font_size'] ?? null,
                                ];
                            }
                        }
                    }
                }
            } catch (\Throwable) {
                // Fallback.
            }
        }

        if (empty($fonts)) {
            $fonts = [
                'heading' => ['family' => 'Montserrat', 'weight' => '700'],
                'body'    => ['family' => 'Open Sans',  'weight' => '400'],
            ];
        }

        return $fonts;
    }

    /**
     * Espaciados (pueden venir de theme.json en WP 6+ o ser defaults).
     *
     * @return array<string, int>
     */
    private function get_spacing(): array
    {
        // WP 6+ theme.json
        if (function_exists('wp_get_global_settings')) {
            $spacing = wp_get_global_settings(['spacing']);
            if (is_array($spacing) && !empty($spacing['spacing']['spacingScale'])) {
                return [
                    'small'  => 8,
                    'medium' => 16,
                    'large'  => 32,
                ];
            }
        }
        return [
            'small'  => 8,
            'medium' => 16,
            'large'  => 32,
        ];
    }

    /**
     * Defaults de botones (border_radius desde custom CSS o Elementor defaults).
     *
     * @return array<string, mixed>
     */
    private function get_button_defaults(): array
    {
        return [
            'border_radius' => 8,
            'text_color'    => '#FFFFFF',
            'bg_color'      => '#FF6B00',
        ];
    }

    /**
     * Settings globales del sitio.
     *
     * @return array<string, mixed>
     */
    private function get_global_settings(): array
    {
        return [
            'site_url'      => get_site_url(),
            'site_name'     => get_bloginfo('name'),
            'site_tagline'  => get_bloginfo('description'),
            'admin_email'   => get_option('admin_email'),
            'language'      => get_bloginfo('language'),
            'timezone'      => get_option('timezone_string') ?: 'UTC',
        ];
    }
}
