<?php
/**
 * Template_Service
 *
 * Lee templates de Elementor (Custom Post Type `elementor_library`).
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\WordPress;

defined('ABSPATH') || exit;

final class Template_Service
{
    /**
     * Lista templates disponibles.
     *
     * @param array<string, mixed> $args {
     *     @type string $type     Filtrar por `_elementor_template_type`.
     *     @type string $search   Filtrar por substring del título (`WP_Query` 's').
     *     @type int    $per_page Cantidad máxima (default 50, max 100).
     * }
     * @return array<int, array<string, mixed>>
     */
    public function list_templates(array $args = []): array
    {
        $query = new \WP_Query($this->build_query_args($args));
        return array_map([$this, 'normalize_template'], $query->posts);
    }

    /**
     * Construye los argumentos de `WP_Query` para `list_templates`.
     *
     * Mantenido como método separado (no inline) para que los tests unitarios
     * puedan verificar via reflection que el filtro `search` realmente se
     * aplica — sin necesidad de instanciar `WP_Query` (no disponible fuera
     * de wp-phpunit). El método es `private` porque es un detalle de
     * implementación, no parte del contrato público.
     *
     * @param array<string, mixed> $args
     * @return array<string, mixed>
     */
    private function build_query_args(array $args): array
    {
        $type     = isset($args['type']) ? sanitize_key((string) $args['type']) : '';
        $search   = isset($args['search']) ? sanitize_text_field((string) $args['search']) : '';
        $per_page = isset($args['per_page']) ? max(1, min(100, (int) $args['per_page'])) : 50;

        $query_args = [
            'post_type'      => 'elementor_library',
            'post_status'    => 'publish',
            'posts_per_page' => $per_page,
            'orderby'        => 'title',
            'order'          => 'ASC',
        ];

        if ('' !== $type) {
            $query_args['meta_query'] = [
                [
                    'key'     => '_elementor_template_type',
                    'value'   => $type,
                    'compare' => '=',
                ],
            ];
        }

        // Filtro por substring en el título vía WP_Query 's' (mismo patrón
        // usado por media-service.php y pages-service.php, y por
        // global-widget-controller.php line 107-108). Con string vacío NO
        // añadimos 's' para no forzar un WHERE 1=0.
        if ('' !== $search) {
            $query_args['s'] = $search;
        }

        return $query_args;
    }

    /**
     * Obtiene un template por ID.
     *
     * @return array<string, mixed>|\WP_Error
     */
    public function get_template(int $id): array|\WP_Error
    {
        $post = get_post($id);
        if (!$post || 'elementor_library' !== $post->post_type) {
            return new \WP_Error('TEMPLATE_NOT_FOUND', sprintf('Template %d not found.', $id), ['id' => $id]);
        }
        return $this->normalize_template($post, include_data: true);
    }

    /**
     * Normaliza un template. Si include_data=true, incluye el contenido Elementor.
     */
    private function normalize_template(\WP_Post $post, bool $include_data = false): array
    {
        $out = [
            'id'    => (int) $post->ID,
            'title' => (string) $post->post_title,
            'type'  => (string) get_post_meta($post->ID, '_elementor_template_type', true),
            'source' => (string) get_post_meta($post->ID, '_elementor_source', true),
            'created' => (string) $post->post_date,
        ];

        if ($include_data) {
            $json = (string) get_post_meta($post->ID, '_elementor_data', true);
            $out['data'] = $json ? json_decode($json, true) : [];
        }

        return $out;
    }
}
