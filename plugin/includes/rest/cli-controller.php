<?php
/**
 * CLI_Controller
 *
 * Bridge para ejecutar comandos wp-cli desde el orchestrator con whitelist estricta.
 *
 *   POST /cli/exec
 *
 * Solo permite comandos explícitamente whitelisted. Caracteres peligrosos
 * (`;`, `|`, `&`, `$`, `` ` ``, redirects, etc.) se rechazan en TODOS los args.
 *
 * Whitelist actual (no editable por el cliente):
 *   - wp elementor flush-css
 *   - wp elementor replace-urls <old> <new>
 *   - wp elementor library sync
 *   - wp elementor-pro clear-theme-builder-conditions
 *   - wp cache flush
 *   - wp rewrite flush
 *
 * Para agregar comandos a la whitelist, editar este archivo (intencional:
 * forzar revisión humana al extender permisos).
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Rest;

use AIWebsiteBridge\Audit_Log;
use AIWebsiteBridge\Permissions;
use AIWebsiteBridge\Revision_Manager;
use AIWebsiteBridge\Validator;

defined('ABSPATH') || exit;

final class CLI_Controller
{
    /**
     * Whitelist de comandos permitidos.
     *
     * Estructura:
     *   '<wp-cli command string>' => [
     *       'description' => '...',
     *       'required_args' => ['old', 'new'],   // nombres de placeholders esperados
     *       'optional_args' => [],
     *   ]
     */
    private const WHITELIST = [
        'wp elementor flush-css' => [
            'description'  => 'Flush Elementor CSS cache.',
            'required_args' => [],
            'optional_args' => [],
        ],
        'wp elementor replace-urls' => [
            'description'  => 'Replace old URL with new URL in Elementor data.',
            'required_args' => ['old', 'new'],
            'optional_args' => [],
        ],
        'wp elementor library sync' => [
            'description'  => 'Sync the Elementor template library.',
            'required_args' => [],
            'optional_args' => [],
        ],
        'wp elementor-pro clear-theme-builder-conditions' => [
            'description'  => 'Clear all Theme Builder display conditions.',
            'required_args' => [],
            'optional_args' => [],
        ],
        'wp cache flush' => [
            'description'  => 'Flush the WordPress object cache.',
            'required_args' => [],
            'optional_args' => [],
        ],
        'wp rewrite flush' => [
            'description'  => 'Flush rewrite rules.',
            'required_args' => [],
            'optional_args' => ['hard'],
        ],
    ];

    /**
     * Caracteres prohibidos en cualquier argumento (defensa contra shell injection).
     */
    private const FORBIDDEN_CHARS = [';', '|', '&', '$', '`', "\n", "\r", "\0", '<', '>', '(', ')'];

    public function __construct(
        private Permissions $permissions,
        private Validator $validator,
        private Audit_Log $audit_log,
        private Revision_Manager $revision_manager
    ) {}

    public function register_routes(): void
    {
        $ns = 'ai-agent/v1';
        register_rest_route($ns, '/cli/exec', [
            'methods'             => \WP_REST_Server::CREATABLE,
            'callback'            => [$this, 'exec'],
            'permission_callback' => [$this, 'can_manage'],
            'args'                => [
                'command' => [
                    'type'     => 'string',
                    'required' => true,
                ],
                'args' => [
                    'type'     => 'object',
                    'required' => false,
                    'default'  => [],
                ],
            ],
        ]);

        // Endpoint informativo: devuelve la whitelist (para que el LLM sepa qué puede pedir).
        register_rest_route($ns, '/cli/whitelist', [
            'methods'             => \WP_REST_Server::READABLE,
            'callback'            => [$this, 'list_whitelist'],
            'permission_callback' => [$this, 'can_read'],
        ]);
    }

    public function can_read(): bool|\WP_Error
    {
        return $this->permissions->can_read()
            ? true
            : new \WP_Error('FORBIDDEN', 'Insufficient capabilities.', ['status' => 403]);
    }

    public function can_manage(): bool|\WP_Error
    {
        return $this->permissions->can_manage_plugin()
            ? true
            : new \WP_Error('FORBIDDEN', 'manage_options capability required for CLI bridge.', ['status' => 403]);
    }

    /**
     * GET /cli/whitelist — devuelve la lista de comandos permitidos con sus args esperados.
     */
    public function list_whitelist(\WP_REST_Request $request): \WP_REST_Response
    {
        $list = [];
        foreach (self::WHITELIST as $cmd => $meta) {
            $list[] = [
                'command'       => $cmd,
                'description'   => $meta['description'],
                'required_args' => $meta['required_args'],
                'optional_args' => $meta['optional_args'],
            ];
        }
        return new \WP_REST_Response(['success' => true, 'data' => $list], 200);
    }

    /**
     * POST /cli/exec — ejecuta un comando whitelisted.
     *
     * Body:
     *   {
     *     "command": "wp elementor replace-urls",
     *     "args": { "old": "https://old.com", "new": "https://new.com" }
     *   }
     *
     * @return \WP_REST_Response|\WP_Error
     */
    public function exec(\WP_REST_Request $request): \WP_REST_Response|\WP_Error
    {
        $command = (string) $request->get_param('command');
        $args    = (array) ($request->get_param('args') ?? []);

        // 1. Validar que el comando está whitelisted.
        if (!isset(self::WHITELIST[$command])) {
            return new \WP_Error(
                'COMMAND_NOT_WHITELISTED',
                sprintf('Command "%s" is not in the whitelist. Call GET /cli/whitelist to see allowed commands.', $command),
                ['status' => 403]
            );
        }

        $meta = self::WHITELIST[$command];

        // 2. Validar args requeridos.
        $cmd_args = [];
        foreach ($meta['required_args'] as $name) {
            if (!isset($args[$name]) || !is_string($args[$name]) || '' === $args[$name]) {
                return new \WP_Error(
                    'MISSING_ARG',
                    sprintf('Required arg "%s" missing or empty.', $name),
                    ['status' => 400, 'arg' => $name]
                );
            }
            $cmd_args[$name] = $args[$name];
        }
        foreach ($meta['optional_args'] as $name) {
            if (isset($args[$name]) && is_string($args[$name])) {
                $cmd_args[$name] = $args[$name];
            }
        }

        // 3. Validar args desconocidos (no deben pasarse).
        $allowed_arg_names = array_merge($meta['required_args'], $meta['optional_args']);
        foreach (array_keys($args) as $arg_name) {
            if (!in_array($arg_name, $allowed_arg_names, true)) {
                return new \WP_Error(
                    'UNKNOWN_ARG',
                    sprintf('Arg "%s" is not allowed for command "%s".', $arg_name, $command),
                    ['status' => 400, 'arg' => $arg_name]
                );
            }
        }

        // 4. Sanitizar TODOS los valores: rechazar shell metacharacters.
        foreach ($cmd_args as $name => $value) {
            foreach (self::FORBIDDEN_CHARS as $bad) {
                if (str_contains($value, $bad)) {
                    return new \WP_Error(
                        'FORBIDDEN_CHARACTER',
                        sprintf('Arg "%s" contains forbidden character "%s".', $name, $bad),
                        ['status' => 400, 'arg' => $name]
                    );
                }
            }
        }

        // 5. Verificar que WP-CLI esté disponible.
        if (!defined('WP_CLI') || !class_exists('WP_CLI')) {
            return new \WP_Error(
                'WP_CLI_UNAVAILABLE',
                'WP-CLI is not loaded in this PHP process. Run from CLI context or load WP-CLI bootstrap.',
                ['status' => 503]
            );
        }

        // 6. Construir el comando completo y ejecutarlo.
        $full_cmd = $command;
        foreach ($cmd_args as $val) {
            $full_cmd .= ' ' . escapeshellarg($val);
        }

        $this->audit_log->log([
            'action'      => 'cli_exec',
            'success'     => true,
            'after_state' => ['command' => $command, 'args' => $cmd_args],
        ]);

        try {
            \WP_CLI::runcommand($full_cmd);
            return new \WP_REST_Response([
                'success' => true,
                'data'    => [
                    'command' => $command,
                    'args'    => $cmd_args,
                    'output'  => 'OK', // WP_CLI::runcommand sin capture devuelve el último output o true.
                ],
            ], 200);
        } catch (\Throwable $e) {
            $this->audit_log->log([
                'action'        => 'cli_exec',
                'success'       => false,
                'error_code'    => 'WP_CLI_ERROR',
                'error_message' => $e->getMessage(),
            ]);
            return new \WP_Error('WP_CLI_ERROR', $e->getMessage(), ['status' => 500]);
        }
    }
}
