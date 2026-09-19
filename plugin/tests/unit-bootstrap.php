<?php
/**
 * Bootstrap mínimo para tests UNIT — SIN WordPress, SIN DB.
 *
 * Carga solo el autoload PSR-4 de composer (incluyendo autoload-dev para
 * el namespace `AIWebsiteBridge\Tests`) y define `ABSPATH` con un valor
 * truthy para evitar que el guard `defined('ABSPATH') || exit;` del plugin
 * aborte la carga cuando un test instancia una clase que lo contiene.
 *
 * Uso:
 *   vendor/bin/phpunit --bootstrap tests/unit-bootstrap.php tests/unit/ElementorAdapterTest.php
 *
 * Tests que NECESITAN WordPress (los de wp-phpunit, p.ej. integración con
 * `apply_and_save`, `get_post`, etc.) deben usar el bootstrap completo en
 * `tests/bootstrap.php` y el comando `composer test` tras correr
 * `tests/install-wp-tests.sh`.
 */

declare(strict_types=1);

// ABSPATH truthy: el plugin usa `defined('ABSPATH') || exit;` al cargar.
// Sin esto, el require del plugin aborta antes de declarar la clase.
if (!defined('ABSPATH')) {
    define('ABSPATH', __DIR__ . '/');
}

$composerAutoload = __DIR__ . '/../vendor/autoload.php';
if (!file_exists($composerAutoload)) {
    fwrite(STDERR, "Composer autoload not found. Run `composer install` first.\n");
    exit(1);
}
require_once $composerAutoload;

// PSR-4 strict no resuelve archivos en kebab-case (`elementor-adapter.php`),
// que es la convención del plugin (ver tests/README.md → convención PSR-4).
// Cargamos manualmente las dependencias del Adapter para que los tests
// unitarios puedan instanciarlo sin requerir el bootstrap completo de WP.
foreach ([
    'elementor-reader.php',
    'elementor-validator.php',
    'elementor-writer.php',
    'elementor-adapter.php',
] as $rel) {
    $path = __DIR__ . '/../includes/elementor/' . $rel;
    if (!file_exists($path)) {
        fwrite(STDERR, "Missing source file: $path\n");
        exit(1);
    }
    require_once $path;
}
