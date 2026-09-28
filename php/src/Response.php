<?php

declare(strict_types=1);

namespace IShip;

use IShip\Exception\ApiException;
use IShip\Exception\AuthException;
use IShip\Exception\TransportException;
use IShip\Http\HttpResponse;

/**
 * Turns an iShip response into plain data, or into an exception.
 *
 * iShip answers HTTP 200 for failures too, marking them with "status": false,
 * so the envelope — not the status code — decides whether a call succeeded.
 */
final class Response
{
    public static function unwrap(HttpResponse $response): mixed
    {
        $decoded = json_decode($response->body, true);

        if (!is_array($decoded)) {
            throw new TransportException("iShip API ตอบกลับไม่ใช่ JSON (HTTP {$response->statusCode})");
        }

        if ($response->statusCode === 401 || ($decoded['message'] ?? null) === 'Unauthenticated') {
            throw new AuthException('API token ไม่ถูกต้องหรือถูกแทนที่ด้วย token ใหม่แล้ว');
        }

        if (array_key_exists('status', $decoded) && !self::isSuccess($decoded['status'])) {
            throw new ApiException(
                (string) ($decoded['message'] ?? $decoded['msg'] ?? 'iShip API ปฏิเสธคำขอนี้'),
                (string) ($decoded['code'] ?? (string) $response->statusCode),
                $decoded,
            );
        }

        if ($response->statusCode >= 400) {
            throw new ApiException(
                (string) ($decoded['message'] ?? $decoded['msg'] ?? "HTTP {$response->statusCode}"),
                (string) $response->statusCode,
                $decoded,
            );
        }

        // Endpoints that carry an envelope return their payload under "data";
        // the rest (boxes, tracking, check-price) answer with the payload itself.
        return array_key_exists('data', $decoded) ? $decoded['data'] : $decoded;
    }

    private static function isSuccess(mixed $status): bool
    {
        return $status === true || $status === 1 || $status === '1' || $status === 'success';
    }
}
