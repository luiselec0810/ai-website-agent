#!/usr/bin/env bash
#
# install-wp-tests.sh — Instala el entorno de tests PHPUnit + WordPress.
#
# Requisitos:
#   - PHP >= 8.1 con extensiones: mysqli, curl, mbstring, xml, zip
#   - mysql o mariadb disponible en localhost (o configurar WP_TESTS_DB_HOST)
#   - svn (para wp-cli install) o git
#
# Uso:
#   bash tests/install-wp-tests.sh <db_name> <db_user> <db_pass> [db_host] [wp_version]
#
# Ejemplos:
#   bash tests/install-wp-tests.sh wordpress_test root '' localhost latest
#   bash tests/install-wp-tests.sh wordpress_test wp_user wp_pass db.example.com 6.4
#
# Variables de entorno reconocidas:
#   WP_CORE_DIR   - dónde instalar WP. Default: /tmp/wordpress
#   WP_TESTS_DIR  - dónde instalar el test framework. Default: /tmp/wordpress-tests-lib

set -e

if [ $# -lt 3 ]; then
    echo "usage: $0 <db_name> <db_user> <db_pass> [db_host] [wp_version]"
    exit 1
fi

DB_NAME=$1
DB_USER=$2
DB_PASS=$3
DB_HOST=${4-localhost}
WP_VERSION=${5-latest}

WP_CORE_DIR=${WP_CORE_DIR-/tmp/wordpress}
WP_TESTS_DIR=${WP_TESTS_DIR-/tmp/wordpress-tests-lib}

# Asegurar que tenemos wp-cli (necesario para algunos pasos).
if ! command -v wp >/dev/null 2>&1; then
    echo "⚠️  wp-cli no está instalado. Algunos pasos pueden fallar."
    echo "    Instálalo: curl -O https://raw.githubusercontent.com/wp-cli/builds/gh-pages/phar/wp-cli.phar && chmod +x wp-cli.phar && mv wp-cli.phar /usr/local/bin/wp"
fi

download() {
    if command -v curl >/dev/null 2>&1; then
        curl -sL "$1" -o "$2"
    elif command -v wget >/dev/null 2>&1; then
        wget -nv "$1" -O "$2"
    else
        echo "❌ curl o wget requerido"
        exit 1
    fi
}

# 1. Crear DB de tests.
echo "→ Creando DB '$DB_NAME'..."
mysqladmin create "$DB_NAME" --user="$DB_USER" --password="$DB_PASS" --host="$DB_HOST" 2>/dev/null || true

# 2. Descargar WP core si no existe.
if [ ! -d "$WP_CORE_DIR" ]; then
    echo "→ Descargando WordPress $WP_VERSION..."
    mkdir -p "$WP_CORE_DIR"
    LATEST_URL="https://wordpress.org/latest.tar.gz"
    if [ "$WP_VERSION" != "latest" ]; then
        LATEST_URL="https://wordpress.org/wordpress-$WP_VERSION.tar.gz"
    fi
    download "$LATEST_URL" /tmp/wordpress.tar.gz
    tar --strip-components=1 -zxmf /tmp/wordpress.tar.gz -C "$WP_CORE_DIR"
    rm /tmp/wordpress.tar.gz
fi

# 3. Configurar wp-config.php para tests.
echo "→ Configurando wp-config.php..."
WP_CONFIG_PATH="$WP_CORE_DIR/wp-config.php"
cat > "$WP_CONFIG_PATH" <<EOF
<?php
define( 'DB_NAME', '$DB_NAME' );
define( 'DB_USER', '$DB_USER' );
define( 'DB_PASSWORD', '$DB_PASS' );
define( 'DB_HOST', '$DB_HOST' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );
define( 'AUTH_KEY',         'put your unique phrase here' );
define( 'SECURE_AUTH_KEY',  'put your unique phrase here' );
define( 'LOGGED_IN_KEY',    'put your unique phrase here' );
define( 'NONCE_KEY',        'put your unique phrase here' );
define( 'AUTH_SALT',        'put your unique phrase here' );
define( 'SECURE_AUTH_SALT', 'put your unique phrase here' );
define( 'LOGGED_IN_SALT',   'put your unique phrase here' );
define( 'NONCE_SALT',       'put your unique phrase here' );
\$table_prefix = 'wp_';
define( 'WP_DEBUG', false );
define( 'WP_DEBUG_DISPLAY', false );
if ( ! defined( 'ABSPATH' ) ) {
    define( 'ABSPATH', __DIR__ . '/' );
}
require_once ABSPATH . 'wp-settings.php';
EOF

# 4. Descargar test framework si no existe.
if [ ! -d "$WP_TESTS_DIR" ]; then
    echo "→ Descargando WP test framework..."
    mkdir -p "$WP_TESTS_DIR"
    download "https://raw.github.com/markoheijnen/wp-test-cli/master/install-wp-tests.sh" /tmp/install-wp-tests.sh
    SVNPATH="https://develop.svn.wordpress.org/tags/$WP_VERSION/tests/phpunit/includes/"
    if [ "$WP_VERSION" = "latest" ]; then
        SVNPATH="https://develop.svn.wordpress.org/trunk/tests/phpunit/includes/"
    fi
    svn co --quiet "$SVNPATH" "$WP_TESTS_DIR/includes" || {
        echo "❌ svn no disponible o falla de red. Instalación manual requerida."
        echo "   Descarga el test suite manualmente desde:"
        echo "   https://develop.svn.wordpress.org/tags/$WP_VERSION/tests/phpunit/"
        exit 1
    }
    download "https://develop.svn.wordpress.org/tags/$WP_VERSION/wp-tests-config-sample.php" "$WP_TESTS_DIR/wp-tests-config.php" || true
    if [ "$WP_VERSION" = "latest" ]; then
        download "https://develop.svn.wordpress.org/trunk/wp-tests-config-sample.php" "$WP_TESTS_DIR/wp-tests-config.php" || true
    fi
fi

# 5. Configurar wp-tests-config.php.
cat > "$WP_TESTS_DIR/wp-tests-config.php" <<EOF
<?php
define( 'ABSPATH', '$WP_CORE_DIR/' );
define( 'WP_TESTS_DOMAIN', 'example.org' );
define( 'WP_TESTS_EMAIL', 'admin@example.org' );
define( 'WP_TESTS_TITLE', 'Test Blog' );
define( 'DB_NAME', '$DB_NAME' );
define( 'DB_USER', '$DB_USER' );
define( 'DB_PASSWORD', '$DB_PASS' );
define( 'DB_HOST', '$DB_HOST' );
define( 'DB_CHARSET', 'utf8' );
define( 'DB_COLLATE', '' );
define( 'WP_TESTS_TABLE_PREFIX', 'wp_' );
define( 'WP_DEBUG', false );
define( 'WP_DEBUG_DISPLAY', false );
require_once ABSPATH . '/wp-includes/version.php';
EOF

echo ""
echo "✅ WordPress test environment instalado:"
echo "   WP core:        $WP_CORE_DIR"
echo "   WP test suite:  $WP_TESTS_DIR"
echo "   DB tests:       $DB_NAME en $DB_HOST"
echo ""
echo "Siguiente paso:"
echo "   cd $(dirname "$0")/.."
echo "   export WP_TESTS_DIR=$WP_TESTS_DIR"
echo "   composer test"
