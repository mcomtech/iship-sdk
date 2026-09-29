<?php

declare(strict_types=1);

namespace IShip;

/**
 * A shipment to create.
 *
 * $customOrderId is required on purpose: iShip rejects a repeat of the same value,
 * so retrying a create whose response you never received cannot produce a second
 * parcel or spend credit twice. Use your own order number and reuse it on retry.
 *
 * A COD shipment ($codAmount > 0) must also list its goods in $products.
 */
final class CreateOrder
{
    /** @param list<Product> $products Line items; required by some couriers for COD. */
    public function __construct(
        public readonly string $customOrderId,
        public readonly string $courierCode,
        public readonly Address $from,
        public readonly Address $to,
        public readonly Parcel $parcel,
        public readonly int $categoryId = Category::OTHER,
        public readonly float $codAmount = 0.0,
        public readonly ?string $remark = null,
        public readonly array $products = [],
        public readonly bool $insured = false,
        public readonly ?float $productValue = null,
        public readonly string $platformName = 'iship-sdk-php',
    ) {
        if ($customOrderId === '') {
            throw new \InvalidArgumentException('customOrderId ต้องไม่เป็นค่าว่าง เพราะใช้กันการสร้างรายการซ้ำ');
        }
        if ($insured && ($productValue === null || $productValue <= 0)) {
            throw new \InvalidArgumentException('ซื้อประกันต้องระบุ productValue');
        }
        if ($codAmount > 0 && $products === []) {
            throw new \InvalidArgumentException('รายการ COD ต้องระบุ products (รายละเอียดสินค้า) ด้วย');
        }
        foreach ($products as $product) {
            if (!$product instanceof Product) {
                throw new \InvalidArgumentException('products ต้องเป็น IShip\\Product ทั้งหมด');
            }
        }
    }

    /** Let iShip pick the courier from the account's area rules. */
    public const AUTO_COURIER = 'AutoCourier';

    public function toPayload(): array
    {
        $payload = [
            'platform_name' => $this->platformName,
            'custom_order_id' => $this->customOrderId,
            'courier_code' => $this->courierCode,
            'category_id' => $this->categoryId,
            'cod_amount' => $this->codAmount,
        ]
            + $this->from->toPayload('src')
            + $this->to->toPayload('dst')
            + $this->parcel->toPayload();

        if ($this->remark !== null) {
            $payload['remark'] = $this->remark;
        }
        if ($this->products !== []) {
            $payload['products'] = array_map(static fn (Product $p) => $p->toPayload(), $this->products);
        }
        if ($this->insured) {
            $payload['is_insured'] = 1;
            $payload['product_value'] = $this->productValue;
        }

        return $payload;
    }
}
