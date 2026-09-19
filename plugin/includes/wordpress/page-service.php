<?php
/**
 * Page_Service
 *
 * Lógica de negocio sobre páginas WordPress (lectura, creación, actualización, duplicación).
 * Usa exclusivamente las funciones oficiales de WP (wp_insert_post, wp_update_post, etc.).
 * No toca $wpdb directamente.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\WordPress;

defined('ABSPATH') || exit;

final class Page_Service
{
    /**
     * Lista páginas con filtros.
     *
     * @param array<string, mixed> $args {
     *     @type string $search
     *     @type string $status
     *     @type int    $per_page
     *     @type int    $page
     * }
     * @return array<int, array<string, mixed>>
     */
    public function list_pages(array $args = []): array
    {
        $search   = isset($args['search']) ? sanitize_text_field((string) $args['search']) : '';
        $status   = isset($args['status']) ? sanitize_key((string) $args['status']) : 'any';
        $per_page = isset($args['per_page']) ? max(1, min(100, (int) $args['per_page'])) : 10;
        $page     = isset($args['page']) ? max(1, (int) $args['page']) : 1;

        $query = new \WP_Query([
            'post_type'      => 'page',
            'post_status'    => $status,
            's'              => $search,
            'posts_per_page' => $per_page,
            'paged'          => $page,
            'orderby'        => 'modified',
            'order'          => 'DESC',
        ]);

        $items = array_map([$this, 'normalize_page'], $query->posts);

        return [
            'items' => $items,
            'pagination' => [
                'total'    => (int) $query->found_posts,
                'per_page' => $per_page,
                'page'     => $page,
            ],
        ];
    }

    /**
     * Obtiene una página por ID.
     *
     * @return array<string, mixed>|\WP_Error
     */
    public function get_page(int $page_id): array|\WP_Error
    {
        $post = get_post($page_id);
        if (!$post || 'page' !== $post->post_type) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['page_id' => $page_id]);
        }
        return $this->normalize_page($post);
    }

    /**
     * Crea una nueva página.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>|\WP_Error
     */
    public function create_page(array $data): array|\WP_Error
    {
        $title = isset($data['title']) ? sanitize_text_field((string) $data['title']) : '';
        if ('' === $title) {
            return new \WP_Error('INVALID_TITLE', 'Title is required.', ['field' => 'title']);
        }

        $status = isset($data['status']) ? sanitize_key((string) $data['status']) : 'draft';
        if (!in_array($status, ['draft', 'publish', 'private', 'pending'], true)) {
            return new \WP_Error('INVALID_STATUS', 'Invalid status.', ['status' => $status]);
        }

        $post_id = wp_insert_post([
            'post_type'   => 'page',
            'post_title'  => $title,
            'post_status' => $status,
            'post_name'   => isset($data['slug']) ? sanitize_title((string) $data['slug']) : '',
            'post_content'=> isset($data['content']) ? wp_kses_post((string) $data['content']) : '',
        ], true);

        if (is_wp_error($post_id)) {
            return $post_id;
        }

        // Si la página debe ser editada con Elementor, marcamos el meta + defaults optimizados.
        if (!empty($data['builder']) && 'elementor' === $data['builder']) {
            update_post_meta($post_id, '_elementor_edit_mode', 'builder');
            update_post_meta($post_id, '_elementor_template_type', 'wp-page');
            update_post_meta($post_id, '_elementor_version', $this->get_elementor_version() ?? '0.0.0');

            // Defaults: Lienzo de Elementor (elementor_canvas) si el caller no especifica.
            $page_template = !empty($data['template'])
                ? sanitize_key((string) $data['template'])
                : 'elementor_canvas';
            update_post_meta($post_id, '_wp_page_template', $page_template);

            // Defaults: hide_title = yes, salvo que el caller pase hide_title=false explícito.
            $hide_title = array_key_exists('hide_title', $data)
                ? filter_var($data['hide_title'], FILTER_VALIDATE_BOOLEAN)
                : true;
            $page_settings = ['hide_title' => $hide_title ? 'yes' : ''];
            update_post_meta($post_id, '_elementor_page_settings', $page_settings);
        }

        return $this->get_page($post_id);
    }

    /**
     * Actualiza una página existente.
     *
     * @param array<string, mixed> $data
     * @return array<string, mixed>|\WP_Error
     */
    public function update_page(int $page_id, array $data): array|\WP_Error
    {
        $post = get_post($page_id);
        if (!$post || 'page' !== $post->post_type) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['page_id' => $page_id]);
        }

        $update = ['ID' => $page_id];

        if (isset($data['title'])) {
            $update['post_title'] = sanitize_text_field((string) $data['title']);
        }
        if (isset($data['slug'])) {
            $update['post_name'] = sanitize_title((string) $data['slug']);
        }
        if (isset($data['status'])) {
            $status = sanitize_key((string) $data['status']);
            if (!in_array($status, ['draft', 'publish', 'private', 'pending'], true)) {
                return new \WP_Error('INVALID_STATUS', 'Invalid status.');
            }
            $update['post_status'] = $status;
        }
        if (isset($data['content'])) {
            $update['post_content'] = wp_kses_post((string) $data['content']);
        }

        $result = wp_update_post($update, true);
        if (is_wp_error($result)) {
            return $result;
        }

        // Ajustes opcionales de Elementor page settings.
        if (array_key_exists('hide_title', $data) || array_key_exists('page_settings', $data)) {
            $existing = get_post_meta($page_id, '_elementor_page_settings', true);
            $page_settings = is_array($existing) ? $existing : [];

            if (array_key_exists('hide_title', $data)) {
                $page_settings['hide_title'] = filter_var($data['hide_title'], FILTER_VALIDATE_BOOLEAN) ? 'yes' : '';
            }
            if (isset($data['page_settings']) && is_array($data['page_settings'])) {
                $page_settings = array_merge($page_settings, $data['page_settings']);
            }
            update_post_meta($page_id, '_elementor_page_settings', $page_settings);
        }

        if (!empty($data['page_template'])) {
            update_post_meta($page_id, '_wp_page_template', sanitize_key((string) $data['page_template']));
        }

        return $this->get_page($page_id);
    }

    /**
     * Duplica una página (post + meta).
     *
     * @param array<string, mixed> $options
     * @return array<string, mixed>|\WP_Error
     */
    public function duplicate_page(int $page_id, array $options = []): array|\WP_Error
    {
        $original = get_post($page_id);
        if (!$original || 'page' !== $original->post_type) {
            return new \WP_Error('PAGE_NOT_FOUND', sprintf('Page %d not found.', $page_id), ['page_id' => $page_id]);
        }

        $new_title = isset($options['new_title']) && '' !== $options['new_title']
            ? sanitize_text_field((string) $options['new_title'])
            : $original->post_title . ' (copia)';

        $new_status = isset($options['status']) ? sanitize_key((string) $options['status']) : 'draft';

        $new_id = wp_insert_post([
            'post_type'    => 'page',
            'post_title'   => $new_title,
            'post_content' => $original->post_content,
            'post_status'  => $new_status,
            'post_excerpt' => $original->post_excerpt,
            'post_parent'  => $original->post_parent,
            'menu_order'   => $original->menu_order,
            'post_author'  => get_current_user_id(),
        ], true);

        if (is_wp_error($new_id)) {
            return $new_id;
        }

        // Copiar todos los post meta (incluido _elementor_data).
        $meta = get_post_meta($page_id);
        foreach ($meta as $key => $values) {
            foreach ($values as $value) {
                // Slug debe ser único, lo regeneramos.
                if ('_wp_old_slug' === $key || 'post_name' === $key) {
                    continue;
                }
                add_post_meta($new_id, $key, maybe_unserialize($value));
            }
        }

        return $this->get_page($new_id);
    }

    /**
     * Normaliza un WP_Post a un array.
     */
    private function normalize_page(\WP_Post $post): array
    {
        $edit_mode     = (string) get_post_meta($post->ID, '_elementor_edit_mode', true);
        $elementor_data = get_post_meta($post->ID, '_elementor_data', true);
        $page_settings = get_post_meta($post->ID, '_elementor_page_settings', true);
        $page_template = (string) get_post_meta($post->ID, '_wp_page_template', true);

        // Una página es Elementor si su edit_mode='builder', aunque aún no tenga
        // _elementor_data (página recién creada vacía).
        $is_elementor  = 'builder' === $edit_mode;
        // hide_title se lee siempre de _elementor_page_settings, independiente
        // de si hay _elementor_data.
        $hide_title_val = is_array($page_settings) ? ($page_settings['hide_title'] ?? '') : '';

        return [
            'id'             => (int) $post->ID,
            'title'          => (string) $post->post_title,
            'slug'           => (string) $post->post_name,
            'status'         => (string) $post->post_status,
            'url'            => (string) get_permalink($post->ID),
            'builder'        => $is_elementor ? 'elementor' : 'classic',
            'has_elementor_data' => !empty($elementor_data),
            'author'         => (int) $post->post_author,
            'modified'       => (string) $post->post_modified,
            'created'        => (string) $post->post_date,
            'menu_order'     => (int) $post->menu_order,
            'parent'         => (int) $post->post_parent,
            'hide_title'     => 'yes' === $hide_title_val,
            'page_template'  => $page_template,
        ];
    }

    private function get_elementor_version(): ?string
    {
        return defined('ELEMENTOR_VERSION') ? ELEMENTOR_VERSION : null;
    }
}
