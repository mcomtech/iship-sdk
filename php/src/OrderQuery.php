<?php

declare(strict_types=1);

namespace IShip;

/** Filter for Client::queryOrders(). Dates are Gregorian, YYYY-MM-DD. */
final class OrderQuery
{
    public function __construct(
        public readonly string $startDate,
        public readonly string $endDate,
        /** One of the OrderStatus constants. */
        public readonly ?int $status = null,
        public readonly ?string $courierCode = null,
        /** Matches recipient name or address. */
        public readonly ?string $keyword = null,
        public readonly ?bool $printed = null,
    ) {
        foreach (['startDate' => $startDate, 'endDate' => $endDate] as $name => $value) {
            if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) !== 1) {
                throw new \InvalidArgumentException("{$name} ต้องอยู่ในรูปแบบ YYYY-MM-DD");
            }
        }
    }

    public function toQuery(): array
    {
        return array_filter([
            'start_date' => $this->startDate,
            'end_date' => $this->endDate,
            'status' => $this->status,
            'courier_code' => $this->courierCode,
            'keyword' => $this->keyword,
            'is_printed' => $this->printed === null ? null : (int) $this->printed,
        ], static fn ($value) => $value !== null);
    }
}
