# iShip SDK for PHP

Requires PHP 8.1+ with the curl and json extensions. No other dependencies.

```bash
composer config repositories.iship vcs https://github.com/mcomtech/iship-sdk
composer require iship/sdk:^1.0
```

## Quick start

```php
use IShip\{Address, Category, Client, CreateOrder, Parcel, Product};

$iship = new Client($_ENV['ISHIP_TOKEN']);

$from = new Address('ร้านทดสอบ', '0812345678', '44/247', 'สายไหม', 'สายไหม', 'กรุงเทพมหานคร', '10220');
$to   = new Address('คุณสมชาย', '0891234567', '12/3', 'สุเทพ', 'เมืองเชียงใหม่', 'เชียงใหม่', '50200');
$box  = new Parcel(weightKg: 1, widthCm: 14, lengthCm: 20, heightCm: 6);

// Compare prices, then ship with the cheapest courier.
$quotes = $iship->recommendCouriers($from, $to, $box);
usort($quotes, fn ($a, $b) => $a['total_price'] <=> $b['total_price']);

$order = $iship->createOrder(new CreateOrder(
    customOrderId: 'SHOP-1001',       // your order number — also the duplicate guard
    courierCode: $quotes[0]['courier_code'],
    from: $from,
    to: $to,
    parcel: $box,
    categoryId: Category::CLOTHING,
    codAmount: 590,                   // COD requires the goods to be listed below
    products: [
        new Product(
            name: 'เสื้อยืด',
            quantity: 1,
            price: 590,
            weightKg: 0.3,
            color: 'ดำ',              // required; use '-' when there is no colour
            size: '30 x 40 x 5',      // or widthCm / lengthCm / heightCm
        ),
    ],
));

echo $order['tracking_number'], PHP_EOL;
echo $iship->labelUrl($order['tracking_number']), PHP_EOL;
```

## Errors

Every failure is an `IShip\Exception\IShipException`:

| Exception | When |
| --- | --- |
| `ApiException` | iShip rejected the call. `$e->errorCode` is iShip's code, `$e->payload` the raw body. |
| `AuthException` | The token is missing, wrong, or was replaced by a newer `requestToken()`. |
| `TransportException` | Network failure, timeout, or a response that was not JSON. |
| `InvalidArgumentException` | Arguments rejected before any request was sent. |

```php
use IShip\Exception\{ApiException, AuthException, TransportException};

try {
    $order = $iship->createOrder($request);
} catch (ApiException $e) {
    // e.g. errorCode "1013": unknown courier_code
    $log->warning($e->getMessage(), ['code' => $e->errorCode, 'payload' => $e->payload]);
} catch (AuthException $e) {
    $log->error('iShip token ใช้ไม่ได้แล้ว');
} catch (TransportException $e) {
    // Safe to retry with the SAME customOrderId: a duplicate is rejected, not shipped twice.
}
```

## Laravel

```php
// app/Providers/AppServiceProvider.php
$this->app->singleton(\IShip\Client::class, fn () => new \IShip\Client(config('services.iship.token')));
```

```php
// config/services.php
'iship' => ['token' => env('ISHIP_TOKEN')],
```

## Webhooks

```php
$event = \IShip\Webhook::parse($request->getContent());

// iShip does not sign webhooks, so confirm the status before acting on it.
$order = $iship->getOrder($event->trackingNumber);
```

## Testing without network

Pass your own `IShip\Http\Transport` to the constructor and return canned
`HttpResponse` objects. `tests/run.php` does exactly that.

```bash
composer test           # unit tests plus live calls to the public endpoints
ISHIP_SKIP_LIVE=1 composer test
```
