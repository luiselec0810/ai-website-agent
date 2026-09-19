<?php
/**
 * Media_Service
 *
 * Operaciones sobre la biblioteca multimedia de WordPress.
 * Usa exclusivamente wp_handle_upload y wp_insert_attachment.
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\WordPress;

defined('ABSPATH') || exit;

final class Media_Service
{
    /**
     * Lista attachments con búsqueda opcional.
     *
     * @param array<string, mixed> $args
     * @return array<string, mixed>
     */
    public function list_media(array $args = []): array
    {
        $search   = isset($args['search']) ? sanitize_text_field((string) $args['search']) : '';
        $per_page = isset($args['per_page']) ? max(1, min(100, (int) $args['per_page'])) : 20;

        $query = new \WP_Query([
            'post_type'      => 'attachment',
            'post_status'    => 'inherit',
            's'              => $search,
            'posts_per_page' => $per_page,
            'orderby'        => 'date',
            'order'          => 'DESC',
        ]);

        $items = array_map([$this, 'normalize_attachment'], $query->posts);

        return [
            'items' => $items,
            'pagination' => [
                'total'    => (int) $query->found_posts,
                'per_page' => $per_page,
            ],
        ];
    }

    /**
     * Obtiene un attachment por ID.
     *
     * @return array<string, mixed>|\WP_Error
     */
    public function get_media(int $id): array|\WP_Error
    {
        $post = get_post($id);
        if (!$post || 'attachment' !== $post->post_type) {
            return new \WP_Error('MEDIA_NOT_FOUND', sprintf('Attachment %d not found.', $id), ['id' => $id]);
        }
        return $this->normalize_attachment($post);
    }

    /**
     * Sube un archivo a la biblioteca.
     *
     * @param array<string, mixed> $file   Entrada de $_FILES.
     * @param array<string, mixed> $meta   title, alt, caption.
     * @return array<string, mixed>|\WP_Error
     */
    public function upload_media(array $file, array $meta = []): array|\WP_Error
    {
        if (empty($file['tmp_name']) || !is_uploaded_file($file['tmp_name'])) {
            return new \WP_Error('NO_FILE', 'No file uploaded.', ['status' => 400]);
        }

        require_once ABSPATH . 'wp-admin/includes/file.php';
        require_once ABSPATH . 'wp-admin/includes/media.php';
        require_once ABSPATH . 'wp-admin/includes/image.php';

        // WP's media_handle_upload espera el NOMBRE del campo (key en $_FILES), no el array.
        // Pero internamente re-indexa: hace $_FILES[$file_id], lo cual falla si pasamos el array.
        // La forma correcta: extraer el key. Como recibimos el array vía REST, podemos
        // iterar $_FILES para encontrar el primero que matchee por tmp_name.
        $file_id = $this->find_file_key($file);

        $attachment_id = media_handle_upload($file_id, 0);
        if (is_wp_error($attachment_id)) {
            return $attachment_id;
        }

        if (!empty($meta['title'])) {
            wp_update_post([
                'ID'         => $attachment_id,
                'post_title' => sanitize_text_field((string) $meta['title']),
            ]);
        }
        if (!empty($meta['alt'])) {
            update_post_meta($attachment_id, '_wp_attachment_image_alt', sanitize_text_field((string) $meta['alt']));
        }
        if (!empty($meta['caption'])) {
            wp_update_post([
                'ID'           => $attachment_id,
                'post_excerpt' => sanitize_text_field((string) $meta['caption']),
            ]);
        }

        return $this->get_media($attachment_id);
    }

    /**
     * Encuentra la clave en $_FILES correspondiente al file array recibido.
     * Compara por tmp_name para identificar el archivo correcto.
     */
    private function find_file_key(array $file): string
    {
        if (!empty($_FILES)) {
            foreach ($_FILES as $key => $candidate) {
                if (($candidate['tmp_name'] ?? null) === ($file['tmp_name'] ?? null)) {
                    return (string) $key;
                }
            }
        }
        // Fallback: si solo hay un archivo en $_FILES, devuelve su key.
        if (!empty($_FILES)) {
            return (string) array_key_first($_FILES);
        }
        return 'file';
    }

    /**
     * Normaliza un attachment a un array.
     */
    private function normalize_attachment(\WP_Post $post): array
    {
        $url = wp_get_attachment_url($post->ID);
        $metadata = wp_get_attachment_metadata($post->ID);

        return [
            'id'        => (int) $post->ID,
            'title'     => (string) $post->post_title,
            'alt'       => (string) get_post_meta($post->ID, '_wp_attachment_image_alt', true),
            'caption'   => (string) $post->post_excerpt,
            'mime_type' => (string) $post->post_mime_type,
            'url'       => (string) $url,
            'width'     => is_array($metadata) && isset($metadata['width']) ? (int) $metadata['width'] : null,
            'height'    => is_array($metadata) && isset($metadata['height']) ? (int) $metadata['height'] : null,
            'file'      => is_array($metadata) && isset($metadata['file']) ? (string) $metadata['file'] : null,
            'author'    => (int) $post->post_author,
            'created'   => (string) $post->post_date,
        ];
    }
}
