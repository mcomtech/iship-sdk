<?php

declare(strict_types=1);

namespace IShip;

/** A request for a courier to collect parcels. This dispatches a real pickup. */
final class PickupRequest
{
    public function __construct(
        public readonly string $courierCode,
        public readonly string $contactName,
        public readonly string $contactPhone,
        /** Full pickup address on one line, including subdistrict, district, province and zipcode. */
        public readonly string $pickupAddress,
        public readonly int $parcelCount,
        public readonly ?string $remark = null,
    ) {
        if ($parcelCount < 1) {
            throw new \InvalidArgumentException('parcelCount ต้องมากกว่า 0');
        }
    }

    public function toPayload(): array
    {
        return array_filter([
            'courier_code' => $this->courierCode,
            'name' => $this->contactName,
            'phone' => $this->contactPhone,
            'pickup_address' => $this->pickupAddress,
            'parcel' => $this->parcelCount,
            'remark' => $this->remark,
        ], static fn ($value) => $value !== null);
    }
}
