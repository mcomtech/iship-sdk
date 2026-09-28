<?php

declare(strict_types=1);

namespace IShip;

use IShip\Exception\TransportException;

/**
 * Parses an iShip status callback.
 *
 * SECURITY: iShip does not sign webhook requests, so anyone who learns your
 * callback URL can post a fake event. Treat a webhook as a signal to call
 * Client::getOrder() for the authoritative status, not as proof by itself.
 */
final class Webhook
{
    public function __construct(
        public readonly string $trackingNumber,
        public readonly string $refCode,
        public readonly string $courierCode,
        /** Courier status slug, e.g. "delivered". */
        public readonly string $status,
        public readonly string $statusDescription,
        public readonly ?float $price,
        public readonly ?float $weightKg,
        public readonly bool $overSize,
        public readonly bool $overWeight,
        public readonly ?\DateTimeImmutable $occurredAt,
        public readonly array $raw,
    ) {
    }

    /** @param string|array $body Raw request body, or the already-decoded array. */
    public static function parse(string|array $body): self
    {
        $data = is_array($body) ? $body : json_decode($body, true);

        if (!is_array($data) || !isset($data['tracking'])) {
            throw new TransportException('webhook payload ไม่ถูกต้อง');
        }

        return new self(
            trackingNumber: (string) $data['tracking'],
            refCode: (string) ($data['ref_code'] ?? ''),
            courierCode: (string) ($data['courier_code'] ?? ''),
            status: (string) ($data['status'] ?? ''),
            statusDescription: (string) ($data['status_desc'] ?? ''),
            price: isset($data['price']) ? (float) $data['price'] : null,
            weightKg: isset($data['weight']) ? (float) $data['weight'] : null,
            overSize: (bool) ($data['is_over_size'] ?? false),
            overWeight: (bool) ($data['is_over_weight'] ?? false),
            occurredAt: isset($data['timestamp'])
                ? (new \DateTimeImmutable('@' . (int) $data['timestamp']))->setTimezone(new \DateTimeZone('Asia/Bangkok'))
                : null,
            raw: $data,
        );
    }
}
