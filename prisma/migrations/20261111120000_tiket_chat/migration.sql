-- CreateEnum
CREATE TYPE "TicketStatus" AS ENUM ('waiting', 'inside', 'out');

-- CreateEnum
CREATE TYPE "Parking" AS ENUM ('none', 'motor', 'mobil', 'bus');

-- CreateEnum
CREATE TYPE "PayMethod" AS ENUM ('qris', 'cash');

-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('pending', 'answered');

-- CreateTable
CREATE TABLE "Ticket" (
    "id" TEXT NOT NULL,
    "no" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "whatsapp" TEXT NOT NULL,
    "adults" INTEGER NOT NULL,
    "kids" INTEGER NOT NULL DEFAULT 0,
    "parking" "Parking" NOT NULL DEFAULT 'none',
    "payment" "PayMethod" NOT NULL DEFAULT 'qris',
    "total" INTEGER NOT NULL,
    "arrival" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT 'app',
    "visitDate" TEXT NOT NULL,
    "status" "TicketStatus" NOT NULL DEFAULT 'waiting',
    "boughtAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkInAt" TIMESTAMP(3),
    "checkOutAt" TIMESTAMP(3),

    CONSTRAINT "Ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faq" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatQuestion" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "status" "ChatStatus" NOT NULL DEFAULT 'pending',
    "answer" TEXT,
    "askedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "ChatQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatLog" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Ticket_no_key" ON "Ticket"("no");

-- CreateIndex
CREATE INDEX "Ticket_visitDate_idx" ON "Ticket"("visitDate");

-- CreateIndex
CREATE INDEX "Ticket_whatsapp_idx" ON "Ticket"("whatsapp");

-- CreateIndex
CREATE INDEX "ChatQuestion_status_askedAt_idx" ON "ChatQuestion"("status", "askedAt");

-- CreateIndex
CREATE INDEX "ChatQuestion_deviceId_idx" ON "ChatQuestion"("deviceId");

-- CreateIndex
CREATE INDEX "ChatLog_createdAt_idx" ON "ChatLog"("createdAt");

