-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('processing', 'done', 'failed');

-- CreateTable
CREATE TABLE "AiPhotoJob" (
    "id" TEXT NOT NULL,
    "originalUrl" TEXT NOT NULL,
    "originalKey" TEXT NOT NULL,
    "resultUrl" TEXT,
    "resultKey" TEXT,
    "status" "JobStatus" NOT NULL DEFAULT 'processing',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPhotoJob_pkey" PRIMARY KEY ("id")
);
