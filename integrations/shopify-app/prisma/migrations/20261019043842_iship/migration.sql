-- CreateTable
CREATE TABLE "ShopSettings" (
    "shop" TEXT NOT NULL PRIMARY KEY,
    "ishipToken" TEXT,
    "environment" TEXT NOT NULL DEFAULT 'production',
    "originName" TEXT NOT NULL DEFAULT '',
    "originPhone" TEXT NOT NULL DEFAULT '',
    "originAddress" TEXT NOT NULL DEFAULT '',
    "originSubdistrict" TEXT NOT NULL DEFAULT '',
    "originDistrict" TEXT NOT NULL DEFAULT '',
    "originProvince" TEXT NOT NULL DEFAULT '',
    "originZipcode" TEXT NOT NULL DEFAULT '',
    "courierCode" TEXT NOT NULL DEFAULT 'AutoCourier',
    "boxWidthCm" REAL NOT NULL DEFAULT 20,
    "boxLengthCm" REAL NOT NULL DEFAULT 30,
    "boxHeightCm" REAL NOT NULL DEFAULT 10,
    "defaultItemGrams" INTEGER NOT NULL DEFAULT 500,
    "categoryId" INTEGER NOT NULL DEFAULT 99,
    "autoCreate" BOOLEAN NOT NULL DEFAULT false,
    "notifyCustomer" BOOLEAN NOT NULL DEFAULT true,
    "codGateways" TEXT NOT NULL DEFAULT 'Cash on Delivery (COD)
COD
เก็บเงินปลายทาง',
    "trackingUrlTemplate" TEXT NOT NULL DEFAULT '',
    "callbackSecret" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Shipment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "orderName" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "problems" TEXT,
    "warnings" TEXT,
    "error" TEXT,
    "overrides" TEXT,
    "uncertain" BOOLEAN NOT NULL DEFAULT false,
    "firstTriedAt" DATETIME,
    "tries" INTEGER NOT NULL DEFAULT 0,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedUntil" DATETIME,
    "trackingNumber" TEXT,
    "courierCode" TEXT,
    "fulfillmentId" TEXT,
    "progress" TEXT,
    "ishipStatus" INTEGER,
    "syncAfter" DATETIME,
    "orderCancelled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "ComplianceRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "handledAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "ShopSettings_callbackSecret_key" ON "ShopSettings"("callbackSecret");

-- CreateIndex
CREATE INDEX "Shipment_state_runAfter_idx" ON "Shipment"("state", "runAfter");

-- CreateIndex
CREATE INDEX "Shipment_syncAfter_idx" ON "Shipment"("syncAfter");

-- CreateIndex
CREATE INDEX "Shipment_shop_trackingNumber_idx" ON "Shipment"("shop", "trackingNumber");

-- CreateIndex
CREATE UNIQUE INDEX "Shipment_shop_orderId_key" ON "Shipment"("shop", "orderId");
