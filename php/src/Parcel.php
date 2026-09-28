<?php

declare(strict_types=1);

namespace IShip;

/** Parcel weight in kilograms and dimensions in centimetres. */
final class Parcel
{
    public function __construct(
        public readonly float $weightKg,
        public readonly float $widthCm,
        public readonly float $lengthCm,
        public readonly float $heightCm,
    ) {
    }

    public function toPayload(): array
    {
        return [
            'weight' => $this->weightKg,
            'width' => $this->widthCm,
            'length' => $this->lengthCm,
            'height' => $this->heightCm,
        ];
    }
}
