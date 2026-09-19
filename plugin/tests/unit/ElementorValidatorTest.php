<?php
/**
 * Tests para AIWebsiteBridge\Elementor\Elementor_Validator.
 *
 * Cubre whitelists CORE_WIDGETS y PRO_WIDGETS, validación per-widget (G3),
 * detección de Elementor / Elementor Pro activos.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\Elementor\Elementor_Validator;
use PHPUnit\Framework\TestCase;

final class ElementorValidatorTest extends TestCase
{
    private Elementor_Validator $validator;

    protected function setUp(): void
    {
        parent::setUp();
        $this->validator = new Elementor_Validator();
    }

    public function test_core_widgets_whitelist_is_populated(): void
    {
        $widgets = Elementor_Validator::CORE_WIDGETS;
        $this->assertNotEmpty($widgets);
        $this->assertContains('heading', $widgets);
        $this->assertContains('text-editor', $widgets);
        $this->assertContains('button', $widgets);
        $this->assertContains('image', $widgets);
        $this->assertContains('video', $widgets);
        $this->assertContains('divider', $widgets);
        $this->assertContains('spacer', $widgets);
    }

    public function test_pro_widgets_whitelist_is_populated(): void
    {
        $widgets = Elementor_Validator::PRO_WIDGETS;
        $this->assertNotEmpty($widgets);
        $this->assertContains('form', $widgets);
        $this->assertContains('posts', $widgets);
        $this->assertContains('gallery', $widgets);
        $this->assertContains('slides', $widgets);
        $this->assertContains('portfolio', $widgets);
        $this->assertContains('price-table', $widgets);
        $this->assertContains('price-list', $widgets);
    }

    public function test_core_and_pro_lists_do_not_overlap(): void
    {
        $intersection = array_intersect(
            Elementor_Validator::CORE_WIDGETS,
            Elementor_Validator::PRO_WIDGETS
        );
        $this->assertEmpty($intersection, 'Widget cannot be both Core and Pro');
    }

    // ─────────────────────────────────────────────────────────────────
    // widget_exists (with no Elementor active, only whitelists apply)
    // ─────────────────────────────────────────────────────────────────

    public function test_widget_exists_returns_true_for_core_widget(): void
    {
        $this->assertTrue($this->validator->widget_exists('heading'));
        $this->assertTrue($this->validator->widget_exists('button'));
        $this->assertTrue($this->validator->widget_exists('image'));
    }

    public function test_widget_exists_returns_true_for_pro_widget(): void
    {
        $this->assertTrue($this->validator->widget_exists('form'));
        $this->assertTrue($this->validator->widget_exists('posts'));
    }

    public function test_widget_exists_returns_false_for_unknown(): void
    {
        $this->assertFalse($this->validator->widget_exists('not-a-real-widget'));
        $this->assertFalse($this->validator->widget_exists(''));
    }

    public function test_widget_exists_rejects_atomic_widgets(): void
    {
        // G13: atomic widgets (V4 experimental) no están en whitelist.
        $this->assertFalse($this->validator->widget_exists('e-heading'));
        $this->assertFalse($this->validator->widget_exists('e-button'));
    }

    // ─────────────────────────────────────────────────────────────────
    // validate_settings (G3)
    // ─────────────────────────────────────────────────────────────────

    public function test_validate_settings_accepts_empty_array(): void
    {
        // Sin reglas específicas → válido.
        $result = $this->validator->validate_settings('heading', []);
        $this->assertTrue($result === true || $result === []);
    }

    public function test_validate_settings_accepts_valid_heading_size(): void
    {
        $result = $this->validator->validate_settings('heading', ['header_size' => 'h2']);
        $this->assertNotWPError($result);
    }

    public function test_validate_settings_rejects_invalid_heading_size(): void
    {
        $result = $this->validator->validate_settings('heading', ['header_size' => 'h99']);
        $this->assertWPError($result, 'INVALID_HEADER_SIZE');
    }

    public function test_validate_settings_rejects_invalid_button_align(): void
    {
        $result = $this->validator->validate_settings('button', ['align' => 'diagonal']);
        $this->assertWPError($result, 'INVALID_BUTTON_ALIGN');
    }

    public function test_validate_settings_accepts_valid_button_align(): void
    {
        $result = $this->validator->validate_settings('button', ['align' => 'center']);
        $this->assertNotWPError($result);
    }

    // ─────────────────────────────────────────────────────────────────
    // Detección de Elementor / Pro (sin WP cargados → false)
    // ─────────────────────────────────────────────────────────────────

    public function test_is_elementor_active_returns_false_in_isolation(): void
    {
        // Sin WP cargados, el Plugin class no existe.
        $this->assertFalse($this->validator->is_elementor_active());
    }

    public function test_is_elementor_pro_active_returns_false_in_isolation(): void
    {
        // Sin WP cargados, la constante ELEMENTOR_PRO_VERSION no está definida.
        $this->assertFalse($this->validator->is_elementor_pro_active());
    }

    public function test_elementor_version_returns_empty_string_when_not_loaded(): void
    {
        $this->assertSame('', $this->validator->elementor_version());
    }

    // ─────────────────────────────────────────────────────────────────
    // available_widgets (intersección de whitelist + WP-registered)
    // ─────────────────────────────────────────────────────────────────

    public function test_available_widgets_returns_at_least_core_list(): void
    {
        // Sin Elementor cargado, retorna la CORE_WIDGETS whitelist.
        $widgets = $this->validator->available_widgets();
        $this->assertNotEmpty($widgets);
        $this->assertContains('heading', $widgets);
    }

    /**
     * Helper: assert $value is WP_Error with given code.
     */
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
