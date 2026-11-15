-- CreateTable
CREATE TABLE "Faq" (
    "id" TEXT NOT NULL,
    "keys" TEXT[],
    "answer" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Faq_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UnansweredQuestion" (
    "id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnansweredQuestion_pkey" PRIMARY KEY ("id")
);
