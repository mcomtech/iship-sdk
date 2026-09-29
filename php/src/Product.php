<?php

declare(strict_types=1);

namespace IShip;

/**
 * One line item inside a COD shipment.
 *
 * iShip requires every field here except $remark, and it wants the item's size
 * one of two ways: either $size as free text ("12 x 12 x 2", at most 128 bytes)
 * or all three of $widthCm, $lengthCm and $heightCm. $size wins when both are given.
 */
final class Product
{
    private const MAX_SIZE_LENGTH = 128;
    private const MAX_QUANTITY = 999;

    public function __construct(
        public readonly string $name,
        public readonly int $quantity,
        public readonly float $price,
        public readonly float $weightKg,
        /** Required by iShip; use a placeholder such as "-" when the goods have no colour. */
        public readonly string $color,
        /** Free-text size, e.g. "12 x 12 x 2". Alternative to the three dimensions below. */
        public readonly ?string $size = null,
        public readonly ?float $widthCm = null,
        public readonly ?float $lengthCm = null,
        public readonly ?float $heightCm = null,
        public readonly ?string $remark = null,
    ) {
        $this->assert($name !== '', 'ต้องระบุชื่อสินค้า');
        $this->assert($quantity >= 1 && $quantity <= self::MAX_QUANTITY, "จำนวนสินค้าต้องอยู่ระหว่าง 1 ถึง " . self::MAX_QUANTITY);
        $this->assert($price > 0, 'ต้องระบุราคาสินค้ามากกว่า 0');
        $this->assert($weightKg > 0, 'ต้องระบุน้ำหนักสินค้ามากกว่า 0');
        $this->assert($color !== '', 'ต้องระบุสีสินค้า');

        if ($size !== null) {
            $this->assert($size !== '', 'ขนาดสินค้าต้องไม่เป็นค่าว่าง');
            $this->assert(strlen($size) <= self::MAX_SIZE_LENGTH, 'ขนาดสินค้าไม่เกิน ' . self::MAX_SIZE_LENGTH . ' ตัวอักษร');
        } else {
            $this->assert(
                $widthCm > 0 && $lengthCm > 0 && $heightCm > 0,
                'ต้องระบุ size หรือ widthCm, lengthCm และ heightCm ครบทั้งสามค่า',
            );
        }
    }

    public function toPayload(): array
    {
        $payload = [
            'product_name' => $this->name,
            'product_qty' => $this->quantity,
            'product_price' => $this->price,
            'product_weight' => $this->weightKg,
            'product_color' => $this->color,
        ];

        if ($this->size !== null) {
            $payload['product_size'] = $this->size;
        } else {
            $payload['product_width'] = $this->widthCm;
            $payload['product_length'] = $this->lengthCm;
            $payload['product_height'] = $this->heightCm;
        }

        if ($this->remark !== null) {
            $payload['product_remark'] = $this->remark;
        }

        return $payload;
    }

    private function assert(bool $condition, string $message): void
    {
        if (!$condition) {
            throw new \InvalidArgumentException("สินค้า \"{$this->name}\": {$message}");
        }
    }
}
