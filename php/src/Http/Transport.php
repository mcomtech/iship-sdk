<?php

declare(strict_types=1);

namespace IShip\Http;

/** Sends one HTTP request. Implement this to plug in your own HTTP client or to test without network. */
interface Transport
{
    /** @param array<string, string> $headers */
    public function send(string $method, string $url, array $headers, ?string $body, int $timeoutSeconds): HttpResponse;
}
