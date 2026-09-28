<?php

declare(strict_types=1);

namespace IShip;

/** Goods categories accepted by CreateOrder::$categoryId. */
final class Category
{
    public const DOCUMENT = 0;       // เอกสาร
    public const DRY_FOOD = 1;       // อาหารแห้ง
    public const HOUSEHOLD = 2;      // ของใช้
    public const IT = 3;             // อุปกรณ์ไอที
    public const CLOTHING = 4;       // เสื้อผ้า
    public const MEDIA = 5;          // สื่อบันเทิง
    public const AUTO_PARTS = 6;     // อะไหล่รถยนต์
    public const SHOES_BAGS = 7;     // รองเท้า/กระเป๋า
    public const SPORTS = 8;         // อุปกรณ์กีฬา
    public const COSMETICS = 9;      // เครื่องสำอางค์
    public const FURNITURE = 10;     // เฟอร์นิเจอร์
    public const FRUIT = 11;         // ผลไม้
    public const OTHER = 99;         // อื่นๆ
}
