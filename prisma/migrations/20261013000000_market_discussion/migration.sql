-- Public discussion threads on markets: comments with one level of replies.

-- CreateTable
CREATE TABLE "MarketComment" (
    "id" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parentId" TEXT,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,

    CONSTRAINT "MarketComment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketComment_marketId_parentId_createdAt_idx" ON "MarketComment"("marketId", "parentId", "createdAt");

-- CreateIndex
CREATE INDEX "MarketComment_parentId_createdAt_idx" ON "MarketComment"("parentId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketComment" ADD CONSTRAINT "MarketComment_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "Market"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketComment" ADD CONSTRAINT "MarketComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketComment" ADD CONSTRAINT "MarketComment_removedById_fkey" FOREIGN KEY ("removedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MarketComment" ADD CONSTRAINT "MarketComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "MarketComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 1 to 1,000 characters while visible; a removed comment's body is cleared.
ALTER TABLE "MarketComment" ADD CONSTRAINT "MarketComment_body_length" CHECK (
  char_length("body") <= 1000 AND ("removedAt" IS NOT NULL OR char_length(btrim("body")) >= 1)
);
