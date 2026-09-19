<?php
/**
 * Auth
 *
 * Maneja la autenticación por API Key. Cada key tiene un hash almacenado
 * y un usuario WP asociado (para capability checks).
 *
 * Headers soportados:
 *   X-AI-Agent-Key: <api-key>
 *
 * @package AIWebsiteBridge
 */

declare(strict_types=1);

namespace AIWebsiteBridge;

defined('ABSPATH') || exit;

final class Auth
{
    public const HEADER_NAME = 'X-AI-Agent-Key';

    private Permissions $permissions;

    public function __construct(Permissions $permissions)
    {
        $this->permissions = $permissions;
    }

    /**
     * Hook que se engancha a `determine_current_user` en REST API.
     * Devuelve el user_id si la key es válida, o false para que WP siga su flujo normal.
     *
     * @param int|false $user_id El user_id actual (false si no hay).
     * @return int|false
     */
    public function authenticate_rest(int|false $user_id)
    {
        // Si ya hay un usuario autenticado (vía cookie o app password), lo respetamos.
        if (!empty($user_id)) {
            return $user_id;
        }

        $api_key = $this->extract_api_key();
        if (null === $api_key || '' === $api_key) {
            return false;
        }

        return $this->verify_api_key($api_key);
    }

    /**
     * Lee el header X-AI-Agent-Key.
     */
    private function extract_api_key(): ?string
    {
        if (!function_exists('getallheaders')) {
            return null;
        }

        $headers = getallheaders();
        $normalized = [];
        foreach ($headers as $name => $value) {
            $normalized[strtolower((string) $name)] = $value;
        }

        $value = $normalized[strtolower(self::HEADER_NAME)] ?? null;
        if (!is_string($value)) {
            return null;
        }

        return sanitize_text_field($value);
    }

    /**
     * Verifica la API key contra las almacenadas en wp_options.
     *
     * @return int|false User ID si es válida, false si no.
     */
    public function verify_api_key(string $api_key): int|false
    {
        $keys = get_option('ai_agent_api_keys', []);
        if (!is_array($keys) || empty($keys)) {
            return false;
        }

        foreach ($keys as $stored) {
            if (!is_array($stored) || empty($stored['key_hash'])) {
                continue;
            }
            if (wp_check_password($api_key, (string) $stored['key_hash'])) {
                $user_id = (int) ($stored['user_id'] ?? 0);
                if ($user_id <= 0) {
                    return false;
                }
                $this->update_last_used((string) $stored['key_hash']);
                return $user_id;
            }
        }

        return false;
    }

    private function update_last_used(string $key_hash): void
    {
        $keys = get_option('ai_agent_api_keys', []);
        foreach ($keys as &$stored) {
            if (($stored['key_hash'] ?? '') === $key_hash) {
                $stored['last_used'] = current_time('mysql');
                break;
            }
        }
        unset($stored);
        update_option('ai_agent_api_keys', $keys, false);
    }

    /**
     * Crea una nueva API key. Devuelve la key en texto plano (solo se muestra una vez).
     *
     * @param int    $user_id Usuario WP asociado.
     * @param string $label   Etiqueta descriptiva.
     * @return string La key en texto plano.
     */
    public function create_api_key(int $user_id, string $label = 'AI Agent Key'): string
    {
        $plain = $this->generate_random_key();

        $keys   = get_option('ai_agent_api_keys', []);
        $keys[] = [
            'key_hash' => wp_hash_password($plain),
            'user_id'  => $user_id,
            'label'    => sanitize_text_field($label),
            'created'  => current_time('mysql'),
            'last_used'=> null,
        ];

        update_option('ai_agent_api_keys', $keys, false);

        return $plain;
    }

    /**
     * Revoca (elimina) una API key por su key_hash (prefijo).
     */
    public function revoke_api_key(string $key_prefix): bool
    {
        $keys = get_option('ai_agent_api_keys', []);
        $filtered = array_filter(
            $keys,
            static fn (array $stored): bool => strpos((string) ($stored['key_hash'] ?? ''), $key_prefix) === false
        );

        if (count($filtered) === count($keys)) {
            return false;
        }

        update_option('ai_agent_api_keys', array_values($filtered), false);
        return true;
    }

    /**
     * Lista todas las API keys (con hash truncado, nunca la key plana).
     *
     * @return array<int, array<string, mixed>>
     */
    public function list_api_keys(): array
    {
        $keys = get_option('ai_agent_api_keys', []);
        return array_map(static function (array $stored): array {
            return [
                'key_prefix' => substr((string) ($stored['key_hash'] ?? ''), 0, 12),
                'user_id'    => (int) ($stored['user_id'] ?? 0),
                'label'      => (string) ($stored['label'] ?? ''),
                'created'    => (string) ($stored['created'] ?? ''),
                'last_used'  => $stored['last_used'] ?? null,
            ];
        }, $keys);
    }

    private function generate_random_key(int $length = 40): string
    {
        try {
            $bytes = random_bytes($length);
        } catch (\Throwable) {
            // Fallback muy improbable; random_bytes solo lanza en sistemas rotos.
            $bytes = '';
            for ($i = 0; $i < $length; $i++) {
                $bytes .= chr(mt_rand(0, 255));
            }
        }
        return 'aiw_' . rtrim(strtr(base64_encode($bytes), '+/', '-_'), '=');
    }
}
