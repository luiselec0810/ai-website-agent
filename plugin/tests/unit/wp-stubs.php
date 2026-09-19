<?php
/**
 * Stubs globales de funciones WP_* usadas por unit-bootstrap.
 *
 * Solo se usan cuando `tests/unit-bootstrap.php` corre los tests SIN cargar
 * WP core (no hay DB de tests configurada). En `tests/bootstrap.php` con
 * WP core cargado, WP ya habrá definido estas funciones — el `if
 * (!function_exists(...))` evita redeclaraciones fatales.
 *
 * Estos stubs NO son perfectos — solo sirven para que las pruebas que
 * invocan los servicios `list_*` (que construyen args de `WP_Query`)
 * puedan verificar el cableado del filtro `search` sin necesidad de DB.
 * Las pruebas funcionales reales (que ejecutan `WP_Query` y leen de la DB)
 * necesitan wp-phpunit completo (ver `tests/README.md`).
 */

declare(strict_types=1);

if (!function_exists('sanitize_key')) {
    /**
     * Stub mínimo de WP\sanitize_key().
     */
    function sanitize_key(string $key): string
    {
        $key = strtolower($key);
        return preg_replace('/[^a-z0-9_\-]/', '', $key);
    }
}

if (!function_exists('sanitize_text_field')) {
    /**
     * Stub mínimo de WP\sanitize_text_field().
     */
    function sanitize_text_field(string $str): string
    {
        $str = strip_tags($str);
        $str = preg_replace('/[\r\n\t\0\x0B]/', ' ', $str);
        return trim($str);
    }
}

if (!class_exists('WP_Query')) {
    /**
     * Stub capturador de WP_Query — solo para unit-bootstrap.
     *
     * No ejecuta SQL real; en su lugar guarda los args del constructor
     * y devuelve `posts=[]` + `found_posts=0` para que los `array_map`
     * sobre `$query->posts` iteren cero veces (evitando llamadas a
     * `wp_get_attachment_url`, `wp_get_attachment_metadata`, etc., que
     * no existen en unit-bootstrap).
     *
     * Cada llamada al constructor empuja los args al registro estático
     * `WP_Query::$captured_args` para que los tests puedan verificar
     * después que el cableado del filtro `search` (`'s' => $search`)
     * llegó correctamente al constructor de WP_Query.
     */
    class WP_Query
    {
        /** @var array<int, array<string, mixed>> Stack de args de cada `new WP_Query(...)`. */
        public static array $captured_args = [];

        public static function reset_captured(): void
        {
            self::$captured_args = [];
        }

        /** @var array<string, mixed> */
        public array $args = [];

        /** @var array<int, object> */
        public array $posts = [];

        public int $found_posts = 0;

        /**
         * @param array<string, mixed> $args
         */
        public function __construct(array $args = [])
        {
            $this->args = $args;
            self::$captured_args[] = $args;
        }
    }
}