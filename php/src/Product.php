<?php

declare(strict_types=1);

namespace IShip;

/** One line item inside a COD shipment. */
final class Product
{
    public function __construct(
        public readonly string $name,
        public readonly int $quantity,
        public readonly float $price,
        public readonly ?float $weightKg = null,
        public readonly ?string $color = null,
    ) {
    }

    public function toPayload(): array
    {
        return array_filter([
            'product_name' => $this->name,
            'product_qty' => $this->quantity,
            'product_price' => $this->price,
            'product_weight' => $this->weightKg,
            'product_color' => $this->color,
        ], static fn ($value) => $value !== null);
    }
}
