-- Invariant enforcement: Ensure any enabled redemption setting without valid dates or threshold fails closed (disabled)
UPDATE "RedemptionSettings"
SET "isEnabled" = FALSE
WHERE "isEnabled" = TRUE
  AND (
    "minimumRedemptionAmount" IS NULL
    OR "minimumRedemptionAmount" <= 0
    OR "startAt" IS NULL
    OR "endAt" IS NULL
    OR "endAt" <= "startAt"
  );
