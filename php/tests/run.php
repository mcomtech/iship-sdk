<?php

declare(strict_types=1);

/**
 * Test runner: php tests/run.php
 *
 * Unit tests use a fake transport. Live tests call the real public endpoints of
 * app.iship.cloud (no token, no data created); skip them with ISHIP_SKIP_LIVE=1.
 */

require __DIR__ . '/../../vendor/autoload.php';

use IShip\Address;
use IShip\Category;
use IShip\Client;
use IShip\CreateOrder;
use IShip\Exception\ApiException;
use IShip\Exception\AuthException;
use IShip\Exception\TransportException;
use IShip\Http\HttpResponse;
use IShip\Http\Transport;
use IShip\OrderQuery;
use IShip\OrderStatus;
use IShip\Parcel;
use IShip\Webhook;

/** Records the last request and replays canned responses. */
final class FakeTransport implements Transport
{
    public array $calls = [];
    /** @param list<HttpResponse> $responses */
    public function __construct(private array $responses)
    {
    }

    public function send(string $method, string $url, array $headers, ?string $body, int $timeoutSeconds): HttpResponse
    {
        $this->calls[] = ['method' => $method, 'url' => $url, 'headers' => $headers, 'body' => $body];

        return array_shift($this->responses) ?? throw new \LogicException('ไม่มี response ที่เตรียมไว้');
    }
}

$passed = 0;
$failed = 0;

function test(string $name, callable $fn): void
{
    global $passed, $failed;
    try {
        $fn();
        ++$passed;
        echo "  ok   {$name}\n";
    } catch (\Throwable $e) {
        ++$failed;
        echo "  FAIL {$name}\n       {$e->getMessage()}\n";
    }
}

function assertSame(mixed $expected, mixed $actual, string $what = ''): void
{
    if ($expected !== $actual) {
        throw new \Exception(sprintf(
            '%sexpected %s, got %s',
            $what === '' ? '' : "{$what}: ",
            json_encode($expected, JSON_UNESCAPED_UNICODE),
            json_encode($actual, JSON_UNESCAPED_UNICODE),
        ));
    }
}

function assertThrows(string $class, callable $fn): \Throwable
{
    try {
        $fn();
    } catch (\Throwable $e) {
        if (!$e instanceof $class) {
            throw new \Exception(sprintf('expected %s, got %s: %s', $class, $e::class, $e->getMessage()));
        }

        return $e;
    }

    throw new \Exception("expected {$class}, nothing was thrown");
}

function json(array $data, int $status = 200): HttpResponse
{
    return new HttpResponse($status, json_encode($data, JSON_UNESCAPED_UNICODE));
}

function bangkok(): Address
{
    return new Address('ร้านทดสอบ', '0812345678', '44/247', 'สายไหม', 'สายไหม', 'กรุงเทพมหานคร', '10220');
}

function chiangmai(): Address
{
    return new Address('ผู้รับ', '0891234567', '12/3', 'สุเทพ', 'เมืองเชียงใหม่', 'เชียงใหม่', '50200');
}

echo "unit\n";

test('a failure sent as HTTP 200 becomes ApiException', function () {
    $transport = new FakeTransport([json(['status' => false, 'code' => '1013', 'message' => 'ไม่พบข้อมูล courier_code นี้ในระบบ'])]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    $e = assertThrows(ApiException::class, fn () => $client->couriers());
    assertSame('1013', $e->errorCode, 'errorCode');
    assertSame('ไม่พบข้อมูล courier_code นี้ในระบบ', $e->getMessage(), 'message');
});

test('Unauthenticated becomes AuthException', function () {
    $transport = new FakeTransport([json(['status' => false, 'code' => 9999, 'message' => 'Unauthenticated'])]);
    $client = new Client('stale-token', Client::PRODUCTION, $transport);

    assertThrows(AuthException::class, fn () => $client->balance());
});

test('a token is required for account endpoints', function () {
    $client = new Client(null, Client::PRODUCTION, new FakeTransport([]));

    assertThrows(AuthException::class, fn () => $client->couriers());
});

test('a non-JSON body becomes TransportException', function () {
    $transport = new FakeTransport([new HttpResponse(502, '<html>Bad Gateway</html>')]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    assertThrows(TransportException::class, fn () => $client->couriers());
});

test('the envelope is unwrapped to data', function () {
    $transport = new FakeTransport([json(['status' => true, 'code' => '0000', 'data' => [['code' => 'FlashLive', 'name' => 'Flash Pro OK']]])]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    assertSame([['code' => 'FlashLive', 'name' => 'Flash Pro OK']], $client->couriers());
});

test('address fields map to the wire names iShip expects', function () {
    $transport = new FakeTransport([json(['status' => true, 'data' => []])]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    $client->recommendCouriers(bangkok(), chiangmai(), new Parcel(1.0, 14, 20, 6));
    $sent = json_decode($transport->calls[0]['body'], true);

    assertSame('สายไหม', $sent['src_district'], 'subdistrict goes to src_district');
    assertSame('สายไหม', $sent['src_amphure'], 'district goes to src_amphure');
    assertSame('เมืองเชียงใหม่', $sent['dst_amphure'], 'district goes to dst_amphure');
    assertSame('สุเทพ', $sent['dst_district'], 'subdistrict goes to dst_district');
    assertSame(1.0, (float) $sent['weight'], 'weight in kg');
});

test('createOrder sends the duplicate-guard id and requires one', function () {
    $transport = new FakeTransport([json(['status' => true, 'data' => ['tracking_number' => 'TH0147XXXX']])]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    $result = $client->createOrder(new CreateOrder(
        customOrderId: 'SHOP-1001',
        courierCode: 'FlashLive',
        from: bangkok(),
        to: chiangmai(),
        parcel: new Parcel(1.0, 14, 20, 6),
        categoryId: Category::CLOTHING,
        codAmount: 590,
    ));

    $sent = json_decode($transport->calls[0]['body'], true);
    assertSame('SHOP-1001', $sent['custom_order_id']);
    assertSame(4, $sent['category_id']);
    assertSame(590, $sent['cod_amount']);
    assertSame('TH0147XXXX', $result['tracking_number']);

    assertThrows(InvalidArgumentException::class, fn () => new CreateOrder(
        customOrderId: '',
        courierCode: 'FlashLive',
        from: bangkok(),
        to: chiangmai(),
        parcel: new Parcel(1.0, 14, 20, 6),
    ));
});

test('insurance requires a declared value', function () {
    assertThrows(InvalidArgumentException::class, fn () => new CreateOrder(
        customOrderId: 'SHOP-1002',
        courierCode: 'FlashLive',
        from: bangkok(),
        to: chiangmai(),
        parcel: new Parcel(1.0, 14, 20, 6),
        insured: true,
    ));
});

test('cancelOrder verifies the order really was cancelled', function () {
    $stillActive = ['status' => true, 'data' => ['courier_code' => 'FlashLive', 'status' => OrderStatus::AWAITING_PICKUP, 'status_name' => 'รอเข้ารับพัสดุ']];
    $transport = new FakeTransport([
        json($stillActive),                                    // getOrder, ownership check
        json(['status' => true, 'code' => 200, 'data' => []]),  // cancel_order says success
        json($stillActive),                                    // getOrder, still not cancelled
    ]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    $e = assertThrows(ApiException::class, fn () => $client->cancelOrder('TH0147XXXX'));
    assertSame('not_cancelled', $e->errorCode);
});

test('cancelOrder returns the cancelled order', function () {
    $transport = new FakeTransport([
        json(['status' => true, 'data' => ['courier_code' => 'FlashLive', 'status' => OrderStatus::AWAITING_PICKUP]]),
        json(['status' => true, 'code' => 200, 'data' => []]),
        json(['status' => true, 'data' => ['status' => OrderStatus::CANCELLED, 'status_name' => 'ยกเลิก', 'cancel_at' => '2026-09-28 10:00:00']]),
    ]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    assertSame(OrderStatus::CANCELLED, $client->cancelOrder('TH0147XXXX')['status']);
});

test('queryOrders builds the query string', function () {
    $transport = new FakeTransport([json(['status' => true, 'data' => []])]);
    $client = new Client('token', Client::PRODUCTION, $transport);

    $client->queryOrders(new OrderQuery('2026-09-01', '2026-09-28', OrderStatus::DELIVERED, printed: false));
    $url = $transport->calls[0]['url'];

    foreach (['start_date=2026-09-01', 'end_date=2026-09-28', 'status=3', 'is_printed=0'] as $part) {
        if (!str_contains($url, $part)) {
            throw new Exception("expected {$part} in {$url}");
        }
    }

    assertThrows(InvalidArgumentException::class, fn () => new OrderQuery('01/09/2026', '2026-09-28'));
});

test('labelUrl joins tracking numbers', function () {
    $client = new Client('token');

    assertSame('https://app.iship.cloud/api/download/pdf?tracks=TH01,TH02', $client->labelUrl('TH01', 'TH02'));
});

test('webhook payloads parse', function () {
    $event = Webhook::parse('{"courier_code":"THP_eParcel","price":24,"ref_code":"APIS19613","status":"delivered","status_desc":"จัดส่งสำเร็จ","timestamp":1671251342,"tracking":"EA666581364TH","weight":0.16,"is_over_weight":true}');

    assertSame('EA666581364TH', $event->trackingNumber);
    assertSame('delivered', $event->status);
    assertSame(true, $event->overWeight);
    assertSame(false, $event->overSize);
    assertSame('2022-12-17', $event->occurredAt->format('Y-m-d'));
    assertThrows(TransportException::class, fn () => Webhook::parse('not json'));
});

test('UAT is reachable through baseUrl', function () {
    $transport = new FakeTransport([json([])]);
    $client = new Client('token', Client::UAT, $transport);
    $client->boxes();

    assertSame(true, str_starts_with($transport->calls[0]['url'], 'https://app-uat.iship.cloud/'));
});

if (getenv('ISHIP_SKIP_LIVE') !== '1') {
    echo "live (public endpoints on app.iship.cloud)\n";

    $live = new Client();

    test('boxes() returns real box sizes', function () use ($live) {
        $boxes = $live->boxes();
        if (count($boxes) < 3 || !isset($boxes[0]['name'])) {
            throw new Exception('unexpected payload: ' . json_encode($boxes, JSON_UNESCAPED_UNICODE));
        }
    });

    test('recommendCouriers() prices a real route', function () use ($live) {
        $couriers = $live->recommendCouriers(bangkok(), chiangmai(), new Parcel(1.0, 14, 20, 6));
        if ($couriers === [] || !isset($couriers[0]['courier_code'], $couriers[0]['total_price'])) {
            throw new Exception('unexpected payload: ' . json_encode($couriers, JSON_UNESCAPED_UNICODE));
        }
    });

    test('tracking() returns null for an unknown number', function () use ($live) {
        assertSame(null, $live->tracking('TH0000000000'));
    });

    test('an account endpoint without a token fails as AuthException', function () {
        $client = new Client('definitely-not-a-valid-token');
        assertThrows(AuthException::class, fn () => $client->balance());
    });
}

echo "\n{$passed} passed, {$failed} failed\n";
exit($failed === 0 ? 0 : 1);
