<?php

declare(strict_types=1);

namespace IShip\Exception;

/**
 * iShip rejected the operation.
 *
 * The API answers HTTP 200 with {"status": false, ...} in this case, so this
 * exception — not the status code — is how a failure surfaces.
 *
 * $errorCode is iShip's own code, e.g. "1004" (not found) or "1013" (unknown
 * courier). It is a string because the API mixes "0000" and 9999 styles.
 */
final class ApiException extends IShipException
{
    public function __construct(
        string $message,
        public readonly string $errorCode,
        public readonly array $payload,
    ) {
        parent::__construct($message, is_numeric($errorCode) ? (int) $errorCode : 0);
    }
}
