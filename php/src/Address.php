<?php

declare(strict_types=1);

namespace IShip;

/**
 * A Thai address.
 *
 * iShip's wire format names these fields confusingly: its "*_district" holds the
 * subdistrict and its "*_amphure" holds the district. This class uses the names
 * you would write on an envelope and maps them when sending.
 */
final class Address
{
    public function __construct(
        public readonly string $name,
        public readonly string $phone,
        /** House number, street, building. */
        public readonly string $address,
        /** ตำบล / แขวง */
        public readonly string $subdistrict,
        /** อำเภอ / เขต */
        public readonly string $district,
        /** จังหวัด */
        public readonly string $province,
        /** รหัสไปรษณีย์ 5 หลัก */
        public readonly string $zipcode,
    ) {
    }

    /** @param 'src'|'dst' $prefix */
    public function toPayload(string $prefix): array
    {
        return [
            "{$prefix}_name" => $this->name,
            "{$prefix}_phone" => $this->phone,
            "{$prefix}_address" => $this->address,
            "{$prefix}_district" => $this->subdistrict,
            "{$prefix}_amphure" => $this->district,
            "{$prefix}_province" => $this->province,
            "{$prefix}_zipcode" => $this->zipcode,
        ];
    }
}
