-- CreateEnum
CREATE TYPE "Parking" AS ENUM ('none', 'motor', 'mobil', 'bus');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('qris', 'cash');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('pending', 'paid', 'failed', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('simulation', 'midtrans', 'manual');

-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('waiting', 'inside', 'out');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "kids" INTEGER NOT NULL DEFAULT 0,
    "parking" "Parking" NOT NULL DEFAULT 'none',
    "arrival" TEXT NOT NULL,
    "visitDate" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "status" "TicketStatus" NOT NULL DEFAULT 'waiting',
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT,
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "providerOrderId" TEXT,
    "providerTransactionId" TEXT,
    "qrString" TEXT,
    "qrUrl" TEXT,
    "expiresAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "lastPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_code_key" ON "Ticket"("code");

-- CreateIndex
CREATE INDEX "Ticket_whatsapp_idx" ON "Ticket"("whatsapp");

-- CreateIndex
CREATE INDEX "Ticket_visitDate_status_idx" ON "Ticket"("visitDate", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
