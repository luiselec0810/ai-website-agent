<?php
/**
 * PHPUnit bootstrap — carga el WordPress test suite y el plugin bajo test.
 *
 * Uso:
 *   1. composer install
 *   2. bash tests/install-wp-tests.sh wordpress_test root '' localhost latest
 *      (crea una DB de tests y descarga WP + WP test framework)
 *   3. composer test
 *
 * Variables de entorno reconocidas (todas opcionales, tienen defaults razonables):
 *   - WP_TESTS_DIR:        directorio del test framework de WP. Default: vendor/wp-phpunit/wp-phpunit
 *   - WP_TESTS_PHPUNIT_POLYFILLS_PATH: vendor/yoast/phpunit-polyfills/
 *   - WP_TESTS_TABLE_PREFIX: prefijo de tablas. Default: wp_
 *   - WP_TESTS_DB_NAME / USER / PASSWORD / HOST: conexión a la DB de tests
 */

declare(strict_types=1);

// Constantes para WP test suite.
if (!defined('WP_TESTS_PHPUNIT_POLYFILLS_PATH')) {
    define('WP_TESTS_PHPUNIT_POLYFILLS_PATH', __DIR__ . '/../vendor/yoast/phpunit-polyfills/');
}

if (!defined('WP_TESTS_DIR')) {
    define('WP_TESTS_DIR', __DIR__ . '/../vendor/wp-phpunit/wp-phpunit/');
}

// Cargar polyfills para compatibilidad PHPUnit 8/9/10.
require_once WP_TESTS_PHPUNIT_POLYFILLS_PATH . 'phpunitpolyfills-autoload.php';

// Cargar el bootstrap del WP test suite (define WP_TESTS_CONFIG_FILE_PATH,
// crea la instalación WP de tests, define wp_die, etc.).
require_once WP_TESTS_DIR . 'includes/functions.php';

tests_add_filter('muplugins_loaded', static function (): void {
    // Cargar el plugin bajo test.
    $plugin = __DIR__ . '/../ai-website-bridge.php';
    if (!file_exists($plugin)) {
        fwrite(STDERR, "Plugin file not found: $plugin\n");
        exit(1);
    }
    require $plugin;
});

// Cargar el bootstrap del WP core (no-op en versiones recientes).
require WP_TESTS_DIR . 'includes/bootstrap.php';
