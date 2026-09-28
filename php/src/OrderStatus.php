<?php

declare(strict_types=1);

namespace IShip;

/** Order status ids, as returned by Client::orderStatuses(). */
final class OrderStatus
{
    public const AWAITING_PICKUP = 1;    // รอเข้ารับพัสดุ
    public const PICKED_UP = 2;          // พัสดุเข้าระบบ
    public const DELIVERED = 3;          // จัดส่งแล้ว
    public const ISSUE = 4;              // พัสดุมีปัญหา
    public const CANCELLED = 5;          // ยกเลิก
    public const PROGRESS = 6;           // อยู่ระหว่างจัดส่ง
    public const CANNOT_PICKUP = 7;      // ไม่สามารถเข้ารับพัสดุ
    public const NO_COURIER = 8;         // รอเลือกขนส่ง
    public const WITH_BRANCH = 9;        // พัสดุถึงสถานีคัดแยก
    public const RETURNING = 10;         // พัสดุตีกลับ
    public const RETURN_SUCCESS = 11;    // ส่งคืนสำเร็จ
    public const PAYMENT_SUCCESS = 12;   // ชำระเงินสำเร็จ
    public const IN_TRANSIT = 13;        // อยู่ระหว่างขนส่ง
    public const COD_REFUND = 14;        // รายการขอเงินคืน
    public const EXPIRED = 15;           // หมดอายุ
    public const CLOSED = 99;            // ปิดงาน
}
