/*
  Warnings:

  - Added the required column `icon` to the `Ride` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Ride" ADD COLUMN     "icon" TEXT NOT NULL,
ADD COLUMN     "unit" TEXT NOT NULL DEFAULT '';

-- CreateTable
CREATE TABLE "TimeSlot" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "timeRange" TEXT NOT NULL,
    "busy" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "TimeSlot_pkey" PRIMARY KEY ("id")
);
