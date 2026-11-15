-- CreateEnum
CREATE TYPE "PhotoStatus" AS ENUM ('pending', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "GalleryPhoto" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "ai" BOOLEAN NOT NULL DEFAULT false,
    "status" "PhotoStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "GalleryPhoto_pkey" PRIMARY KEY ("id")
);
