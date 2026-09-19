<?php
/**
 * Tests para Media_Service::upload_media — bug del $_FILES key.
 *
 * Bug original: media_handle_upload($file, 0) pasaba el ARRAY, pero WP espera
 * la CLAVE (string) en $_FILES. Resultado: "Illegal offset type" fatal error.
 *
 * Fix: extraer la key correcta desde $_FILES comparando por tmp_name.
 */

declare(strict_types=1);

namespace AIWebsiteBridge\Tests;

use AIWebsiteBridge\WordPress\Media_Service;
use PHPUnit\Framework\TestCase;

final class MediaServiceUploadTest extends TestCase
{
    private Media_Service $service;

    protected function setUp(): void
    {
        parent::setUp();
        $this->service = new Media_Service();
    }

    public function test_upload_media_requires_a_real_uploaded_file(): void
    {
        // Sin $_FILES poblado, find_file_key retorna 'file' (fallback).
        $file = [
            'name' => 'test.png',
            'type' => 'image/png',
            'tmp_name' => '/nonexistent/path',
            'error' => 0,
            'size' => 100,
        ];

        $result = $this->service->upload_media($file, []);

        $this->assertWPError($result);
        $this->assertSame('NO_FILE', $result->get_error_code());
    }

    public function test_find_file_key_returns_matching_key_by_tmp_name(): void
    {
        // Simulamos $_FILES poblado.
        $GLOBALS['_FILES'] = [
            'file' => [
                'name' => 'test.png',
                'type' => 'image/png',
                'tmp_name' => '/tmp/php_xyz',
                'error' => 0,
                'size' => 100,
            ],
        ];

        $reflection = new \ReflectionClass($this->service);
        $method = $reflection->getMethod('find_file_key');
        $method->setAccessible(true);

        $file = ['tmp_name' => '/tmp/php_xyz', 'name' => 'test.png'];
        $key = $method->invokeArgs($this->service, [$file]);
        $this->assertSame('file', $key);

        // Cleanup.
        unset($GLOBALS['_FILES']);
    }

    public function test_find_file_key_uses_first_key_when_no_match(): void
    {
        $GLOBALS['_FILES'] = [
            'attachment' => ['tmp_name' => '/tmp/something_else'],
        ];

        $reflection = new \ReflectionClass($this->service);
        $method = $reflection->getMethod('find_file_key');
        $method->setAccessible(true);

        $file = ['tmp_name' => '/tmp/this_isnt_in_files'];
        $key = $method->invokeArgs($this->service, [$file]);
        $this->assertSame('attachment', $key, 'Should fallback to first key');

        unset($GLOBALS['_FILES']);
    }

    public function test_find_file_key_returns_default_when_empty(): void
    {
        $GLOBALS['_FILES'] = [];

        $reflection = new \ReflectionClass($this->service);
        $method = $reflection->getMethod('find_file_key');
        $method->setAccessible(true);

        $file = ['tmp_name' => '/tmp/x'];
        $key = $method->invokeArgs($this->service, [$file]);
        $this->assertSame('file', $key, 'Default key when $_FILES is empty');

        unset($GLOBALS['_FILES']);
    }

    private function assertWPError($value, ?string $code = null): void
    {
        $this->assertInstanceOf(\WP_Error::class, $value);
        if ($code !== null) {
            $this->assertSame($code, $value->get_error_code());
        }
    }
}
