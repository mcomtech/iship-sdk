<?php

declare(strict_types=1);

namespace IShip;

use IShip\Exception\ApiException;
use IShip\Exception\AuthException;
use IShip\Http\CurlTransport;
use IShip\Http\Transport;

/**
 * Client for the iShip shipping API.
 *
 * $iship = new Client('YOUR_API_TOKEN');
 * $order = $iship->createOrder($request);
 */
final class Client
{
    public const PRODUCTION = 'https://app.iship.cloud';
    public const UAT = 'https://app-uat.iship.cloud';

    private string $baseUrl;

    public function __construct(
        private ?string $token = null,
        string $baseUrl = self::PRODUCTION,
        private ?Transport $transport = null,
        private int $timeoutSeconds = 120,
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->transport ??= new CurlTransport();
    }

    /**
     * Exchange phone and password for an API token.
     *
     * WARNING: an account has exactly one token. This call replaces it, so every
     * existing integration using the old token stops working immediately.
     *
     * @return array{type: string, accessToken: string, expireIn: int}
     */
    public function requestToken(string $phone, string $password): array
    {
        return $this->send('POST', '/api/auth/requestToken', body: [
            'phone' => $phone,
            'password' => $password,
        ]);
    }

    /** Returns a copy of this client that authenticates with $token. */
    public function withToken(string $token): self
    {
        return new self($token, $this->baseUrl, $this->transport, $this->timeoutSeconds);
    }

    // ---------------------------------------------------------------- public

    /** Standard box sizes, in centimetres. No token required. */
    public function boxes(): array
    {
        return $this->send('GET', '/api/boxes');
    }

    /**
     * Price every courier for this route and parcel, at list prices.
     * Use checkPrice() for the prices this account actually pays.
     */
    public function recommendCouriers(Address $from, Address $to, Parcel $parcel): array
    {
        return $this->send('POST', '/api/v2/courier/recommend', body: [
            'user_id' => null,
        ] + $this->routeFields($from, $to, $parcel));
    }

    /** Public tracking for a parcel. Returns null when the number is unknown. */
    public function tracking(string $trackNo): ?array
    {
        $result = $this->send('GET', '/api/v2/tracking/' . rawurlencode($trackNo));

        return $result[0] ?? null;
    }

    /** Public URL of the A6 label PDF for the given tracking numbers. */
    public function labelUrl(string ...$trackNos): string
    {
        $this->assertNotEmpty($trackNos, 'trackNos');

        return $this->baseUrl . '/api/download/pdf?tracks=' . implode(',', array_map('rawurlencode', $trackNos));
    }

    /** The label PDF itself, as raw bytes. */
    public function downloadLabel(string ...$trackNos): string
    {
        $response = $this->transport->send('GET', $this->labelUrl(...$trackNos), $this->headers(), null, $this->timeoutSeconds);

        if ($response->statusCode >= 400) {
            throw new ApiException('ไม่สามารถดาวน์โหลดใบปะหน้าได้', (string) $response->statusCode, []);
        }

        return $response->body;
    }

    // ------------------------------------------------------------ token only

    /** Couriers this account is allowed to use. */
    public function couriers(): array
    {
        return $this->send('GET', '/api/courier_code', auth: true);
    }

    /** Order status ids, for queryOrders(). See OrderStatus for the same list as constants. */
    public function orderStatuses(): array
    {
        return $this->send('GET', '/api/order_statuses', auth: true);
    }

    /** Price for one courier at this account's rates, including remote-area fees. */
    public function checkPrice(string $courierCode, Address $from, Address $to, Parcel $parcel): array
    {
        return $this->send('POST', '/api/v2/check-price', auth: true, body: [
            'courier_code' => $courierCode,
        ] + $this->routeFields($from, $to, $parcel));
    }

    /** Remaining credit on the account. */
    public function balance(): array
    {
        return $this->send('GET', '/api/v2/check-balance', auth: true);
    }

    /**
     * Create a shipment. This spends the account's credit.
     *
     * Retrying with the same CreateOrder::$customOrderId is safe: the API rejects
     * the duplicate instead of creating a second parcel.
     *
     * @return array{ref: string, tracking_number: string, ...}
     */
    public function createOrder(CreateOrder $order): array
    {
        return $this->send('POST', '/api/create_order', auth: true, body: $order->toPayload());
    }

    /** One order belonging to this account. Returns null when not found. */
    public function getOrder(string $trackNo): ?array
    {
        try {
            return $this->send('GET', '/api/get_order/' . rawurlencode($trackNo), auth: true);
        } catch (ApiException $e) {
            return $e->errorCode === '1004' ? null : throw $e;
        }
    }

    /** Orders of this account created between two dates. */
    public function queryOrders(OrderQuery $query): array
    {
        return $this->send('GET', '/api/query_orders', auth: true, query: $query->toQuery());
    }

    /** Full courier scan history for an order of this account. */
    public function traceOrder(string $trackNo): array
    {
        return $this->send('POST', '/api/traces', auth: true, body: ['track_no' => $trackNo]);
    }

    /**
     * Cancel an order that the courier has not collected yet.
     *
     * The API reports success even when the courier refuses, so this reads the
     * order back and fails with ApiException if it is not cancelled.
     */
    public function cancelOrder(string $trackNo): array
    {
        $order = $this->getOrder($trackNo);
        if ($order === null) {
            throw new ApiException("ไม่พบเลขพัสดุ {$trackNo} ในบัญชีนี้", '1004', []);
        }

        $this->send('POST', '/api/cancel_order', auth: true, body: [
            'courier_code' => $order['courier_code'] ?? null,
            'track_no' => $trackNo,
        ]);

        $after = $this->getOrder($trackNo);
        if (($after['status'] ?? null) !== OrderStatus::CANCELLED && empty($after['cancel_at'])) {
            throw new ApiException(
                'ยกเลิกไม่สำเร็จ สถานะปัจจุบัน: ' . ($after['status_name'] ?? 'ไม่ทราบ'),
                'not_cancelled',
                $after ?? [],
            );
        }

        return $after;
    }

    /** Remove an order from the account. Irreversible. */
    public function deleteOrder(string $trackNo): array
    {
        return $this->send('POST', '/api/confirm/delete_order', auth: true, body: ['track_no' => $trackNo]);
    }

    /** Ask a courier to collect parcels. This dispatches a real pickup. */
    public function requestPickup(PickupRequest $pickup): array
    {
        return $this->send('POST', '/api/request_courier', auth: true, body: $pickup->toPayload());
    }

    /** Cancel a pickup previously booked with requestPickup(). */
    public function cancelPickup(int|string $ticketPickupId): array
    {
        return $this->send('GET', '/api/cancel-notify/' . rawurlencode((string) $ticketPickupId), auth: true);
    }

    // --------------------------------------------------------------- internal

    private function routeFields(Address $from, Address $to, Parcel $parcel): array
    {
        return $from->toPayload('src') + $to->toPayload('dst') + $parcel->toPayload();
    }

    private function headers(bool $auth = false): array
    {
        $headers = ['Accept' => 'application/json'];

        if ($auth || $this->token !== null) {
            if ($this->token === null) {
                throw new AuthException('ต้องใส่ API token ก่อนเรียกเมธอดนี้');
            }
            $headers['Authorization'] = 'Bearer ' . $this->token;
        }

        return $headers;
    }

    private function send(string $method, string $path, bool $auth = false, ?array $body = null, array $query = []): mixed
    {
        $url = $this->baseUrl . $path;
        if ($query !== []) {
            $url .= '?' . http_build_query($query);
        }

        $headers = $this->headers($auth);
        $encoded = null;
        if ($body !== null) {
            $headers['Content-Type'] = 'application/json';
            $encoded = json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        }

        $response = $this->transport->send($method, $url, $headers, $encoded, $this->timeoutSeconds);

        return Response::unwrap($response);
    }

    /** @param list<string> $values */
    private function assertNotEmpty(array $values, string $name): void
    {
        if ($values === []) {
            throw new \InvalidArgumentException("{$name} ต้องมีอย่างน้อย 1 รายการ");
        }
    }
}
