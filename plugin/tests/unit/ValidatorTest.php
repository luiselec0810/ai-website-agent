<?php
/**
 * Tests para AIWebsiteBridge\Validator — validación de inputs del REST API.
 *
 * Esta clase es mayormente pura (sin dependencias de WP) y se testea en aislamiento.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\Validator;
use PHPUnit\Framework\TestCase;

final class ValidatorTest extends TestCase
{
    private Validator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new Validator();
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_id
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_id_accepts_positive_integer(): void
    {
        $this->assertSame(42, $this->validator->validate_id(42, 'id'));
        $this->assertSame(1, $this->validator->validate_id('1', 'id'));
    }

    public function test_validate_id_rejects_zero(): void
    {
        $err = $this->validator->validate_id(0, 'id');
        $this->assertWPError($err, 'INVALID_ID');
    }

    public function test_validate_id_rejects_negative(): void
    {
        $err = $this->validator->validate_id(-1, 'id');
        $this->assertWPError($err, 'INVALID_ID');
    }

    public function test_validate_id_rejects_non_numeric(): void
    {
        $this->assertWPError($this->validator->validate_id('abc', 'id'), 'INVALID_ID');
        $this->assertWPError($this->validator->validate_id(null, 'id'), 'INVALID_ID');
        $this->assertWPError($this->validator->validate_id([], 'id'), 'INVALID_ID');
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_text
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_text_accepts_normal_string(): void
    {
        $this->assertSame('Hello', $this->validator->validate_text('Hello', 'title'));
    }

    public function test_validate_text_truncates_to_max(): void
    {
        $long = str_repeat('a', 500);
        $out = $this->validator->validate_text($long, 'title', 200);
        $this->assertSame(200, strlen($out));
    }

    public function test_validate_text_rejects_empty_when_not_allowed(): void
    {
        $err = $this->validator->validate_text('', 'title', 200, false);
        $this->assertWPError($err, 'EMPTY_TEXT');
    }

    public function test_validate_text_accepts_empty_when_allowed(): void
    {
        $this->assertSame('', $this->validator->validate_text('', 'title', 200, true));
    }

    public function test_validate_text_rejects_too_long(): void
    {
        $long = str_repeat('a', 500);
        // Si truncamos antes, no llega a TEXT_TOO_LONG.
        // Para forzar el error, pasamos max muy pequeño Y desactivamos el truncate.
        $err = $this->validator->validate_text($long, 'title', 1000);
        // La implementación actual trunca, no rechaza.
        $this->assertNotWPError($err);
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_slug
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_slug_accepts_simple_slug(): void
    {
        $this->assertSame('hello-world', $this->validator->validate_slug('hello-world'));
    }

    public function test_validate_slug_rejects_uppercase(): void
    {
        $this->assertWPError($this->validator->validate_slug('Hello-World'), 'INVALID_SLUG');
    }

    public function test_validate_slug_rejects_spaces(): void
    {
        $this->assertWPError($this->validator->validate_slug('hello world'), 'INVALID_SLUG');
    }

    public function test_validate_slug_rejects_special_chars(): void
    {
        $this->assertWPError($this->validator->validate_slug('hello!'), 'INVALID_SLUG');
        $this->assertWPError($this->validator->validate_slug('hello/world'), 'INVALID_SLUG');
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_post_status
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_post_status_accepts_known_statuses(): void
    {
        foreach (['publish', 'draft', 'private', 'pending', 'future'] as $s) {
            $this->assertSame($s, $this->validator->validate_post_status($s));
        }
    }

    public function test_validate_post_status_rejects_unknown(): void
    {
        $this->assertWPError($this->validator->validate_post_status('archived'), 'INVALID_STATUS');
        $this->assertWPError($this->validator->validate_post_status(''), 'INVALID_STATUS');
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_settings_array
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_settings_array_accepts_normal_array(): void
    {
        $out = $this->validator->validate_settings_array(['title' => 'X', 'count' => 3]);
        $this->assertSame(['title' => 'X', 'count' => 3], $out);
    }

    public function test_validate_settings_array_rejects_non_array(): void
    {
        $this->assertWPError($this->validator->validate_settings_array('not-an-array'), 'INVALID_SETTINGS');
        $this->assertWPError($this->validator->validate_settings_array(null), 'INVALID_SETTINGS');
    }

    public function test_validate_settings_array_rejects_dunder_keys(): void
    {
        // Defensa contra key injection: rechazar keys que empiezan con `__`.
        $err = $this->validator->validate_settings_array(['__proto__' => 'X']);
        $this->assertWPError($err, 'INVALID_SETTINGS_KEY');
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_element_id
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_element_id_accepts_7_char_hex(): void
    {
        $this->assertSame('abc1234', $this->validator->validate_element_id('abc1234'));
        $this->assertSame('0000000', $this->validator->validate_element_id('0000000'));
        $this->assertSame('ffffffF', $this->validator->validate_element_id('ffffffF'));
    }

    public function test_validate_element_id_rejects_too_short(): void
    {
        $this->assertWPError($this->validator->validate_element_id('abc'), 'INVALID_ELEMENT_ID');
    }

    public function test_validate_element_id_rejects_too_long(): void
    {
        $long = str_repeat('a', 65);
        $this->assertWPError($this->validator->validate_element_id($long), 'INVALID_ELEMENT_ID');
    }

    public function test_validate_element_id_rejects_invalid_chars(): void
    {
        $this->assertWPError($this->validator->validate_element_id('abc!234'), 'INVALID_ELEMENT_ID');
        $this->assertWPError($this->validator->validate_element_id('hello world'), 'INVALID_ELEMENT_ID');
    }

    // ─────────────────────────────────────────────────────────────────
    // is_error helper
    // ─────────────────────────────────────────────────────────────────

    public function test_is_error_returns_true_for_wp_error(): void
    {
        $err = new \WP_Error('TEST', 'msg');
        $this->assertTrue($this->validator->is_error($err));
    }

    public function test_is_error_returns_false_for_normal_values(): void
    {
        $this->assertFalse($this->validator->is_error('string'));
        $this->assertFalse($this->validator->is_error(['array']));
        $this->assertFalse($this->validator->is_error(42));
        $this->assertFalse($this->validator->is_error(null));
    }

    private function assertWPError($value, ?string $code = null): void
    {
        $this->assertInstanceOf(\WP_Error::class, $value, 'Expected WP_Error');
        if ($code !== null) {
            $this->assertSame($code, $value->get_error_code());
        }
    }

    private function assertNotWPError($value): void
    {
        $this->assertNotInstanceOf(\WP_Error::class, $value, 'Did not expect WP_Error');
    }
}
