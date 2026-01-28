-- CreateTable
CREATE TABLE "VipCustomer" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "shop" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rewardPoints" INTEGER NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "RewardTransaction" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "customerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pointsEarned" INTEGER NOT NULL,
    "pointsRedeemed" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "VipCustomer_customerId_key" ON "VipCustomer"("customerId");
