# PHPUnit Setup — AI Website Bridge Plugin

> **Estado:** Setup completo + 9 archivos de test creados. Requieren PHP 8.1+ y DB MySQL/MariaDB para correr.

## Estructura

```
plugin/
├── composer.json                              # PHP 8.1, PHPUnit 9/10, WP test framework
├── phpunit.xml.dist                           # Configuración PHPUnit
└── tests/
    ├── bootstrap.php                          # Carga WP test suite + el plugin
    ├── install-wp-tests.sh                    # Script de instalación del entorno
    ├── README.md                              # Este archivo
    └── unit/                                  # Tests PHPUnit
        ├── ElementorReaderTest.php            # 16 tests (parse, analyze v3/v4, find_by_id, IDs)
        ├── ElementorWriterTest.php            # 24 tests (G3+G4+G5: container/widget/move/duplicate/serialize)
        ├── ElementorValidatorTest.php         # 16 tests (whitelists, validate_settings, atomic)
        ├── ValidatorTest.php                  # 24 tests (validate_id, slug, status, element_id, settings)
        ├── ElementorAdapterTest.php           # 7+ tests (collect_ids_recursive DFS)
        ├── ElementorAdapterConverterTest.php  # tree ↔ json conversion
        ├── MediaServiceUploadTest.php         # 4 tests (find_file_key para upload_media)
        ├── MediaServiceListTest.php           # 5 tests (search filter → 's' arg en WP_Query)
        ├── PageServiceListTest.php            # 6 tests (search filter → 's' arg en WP_Query)
        ├── TemplateServiceTest.php            # 8 tests (search filter → 's' arg en WP_Query)
        └── wp-stubs.php                       # Stubs globales de sanitize_* y WP_Query para unit-bootstrap
```

## Quick start

### 1. Prerequisitos

```bash
# PHP 8.1+ con extensiones
php --version        # >= 8.1
php -m | grep -E "mysqli|curl|mbstring|xml|zip"

# MySQL o MariaDB
mysql --version

# Composer
composer --version
```

### 2. Instalar dependencias

```bash
cd ai-website-agent/plugin
composer install
```

### 3. Crear el entorno de tests

```bash
# Sintaxis: bash tests/install-wp-tests.sh <db_name> <db_user> <db_pass> [db_host] [wp_version]
bash tests/install-wp-tests.sh wordpress_test root '' localhost latest
```

Esto:
- Crea una DB llamada `wordpress_test`.
- Descarga WordPress en `/tmp/wordpress`.
- Descarga el WP test framework en `/tmp/wordpress-tests-lib`.
- Genera `wp-config.php` y `wp-tests-config.php`.

### 4. Correr los tests

```bash
# Suite completa
composer test

# Suite con cobertura (requiere Xdebug o PCOV)
composer test -- --coverage-text

# Test específico
composer test -- --filter test_add_container_to_root

# Verbosidad
composer test -- --testdox
```

## Configuración alternativa

### Override de ubicación del WP test suite

```bash
export WP_TESTS_DIR=/path/to/wordpress-tests-lib
composer test
```

### DB de tests remota

```bash
export WP_TESTS_DB_HOST=db.example.com
export WP_TESTS_DB_USER=test_user
export WP_TESTS_DB_PASSWORD='secret'
export WP_TESTS_DB_NAME=wordpress_test
composer test
```

### En Docker / CI

```yaml
# .github/workflows/tests.yml (ejemplo)
services:
  mysql:
    image: mysql:5.7
    env:
      MYSQL_ROOT_PASSWORD: ''
      MYSQL_DATABASE: wordpress_test
    ports: ['3306:3306']

steps:
  - uses: actions/checkout@v3
  - uses: shivammathur/setup-php@v2
    with: { php-version: '8.1' }
  - run: cd plugin && composer install
  - run: bash plugin/tests/install-wp-tests.sh wordpress_test root '' localhost latest
  - run: cd plugin && composer test
```

## Cobertura por gap

| Gap | Test que lo cubre |
|-----|-------------------|
| **G2** (v3/v4 containers) | `ElementorReaderTest::test_analyze_counts_section_and_column_as_containers_in_v3` |
| **G2** | `ElementorReaderTest::test_analyze_counts_widgets_correctly_v4` |
| **G2** | `ElementorReaderTest::test_detects_v4_for_empty_tree` |
| **G3** (validate_settings en add_widget) | `ElementorWriterTest::test_add_widget_with_invalid_settings_returns_wp_error` |
| **G3** | `ElementorValidatorTest::test_validate_settings_rejects_invalid_heading_size` |
| **G4** (CIRCULAR_MOVE guard) | `ElementorWriterTest::test_move_element_to_itself_returns_circular_error` |
| **G4** | `ElementorWriterTest::test_move_element_to_descendant_returns_circular_error` |
| **G4** | `ElementorWriterTest::test_move_element_deeply_nested_descendant_returns_circular_error` |
| **G5** (regenerate_ids helper) | `ElementorWriterTest::test_regenerate_ids_changes_all_ids` |

## Limitaciones conocidas

- **`Plugin` singleton y `Auth` class** no tienen tests aquí porque dependen mucho del ciclo de vida de WordPress. Se recomienda Brain Monkey (`brain/monkey`) para tests sin DB, o el patrón `WP_UnitTestCase` para tests con DB.
- **`Audit_Log`, `Revision_Manager`, `Page_Service`** se testean mejor con `WP_UnitTestCase` (DB real). Crear `tests/integration/` separado si se quiere ese nivel.
- **11 elementos Pro del validator** están testeados por whitelist (true/false); los settings de cada Pro widget requerirían fixtures individuales.

## Próximos pasos

1. **Agregar Brain Monkey** para tests unitarios sin DB de `Auth` y `Permissions`.
2. **Crear `tests/integration/`** con `WP_UnitTestCase` para `Audit_Log`, `Revision_Manager`, `Page_Service`, `Media_Service`.
3. **CI integration** en `.github/workflows/tests.yml`.
