use anchor_lang::prelude::*;

#[error_code]
pub enum LoyalError {
    #[msg("Protocol is paused")]
    Paused,
    #[msg("Only the config admin may call this instruction")]
    AdminOnly,
    #[msg("Merchant is not active")]
    MerchantInactive,
    #[msg("Vault is not active")]
    VaultInactive,
    #[msg("Numeric overflow")]
    MathOverflow,

    // --- issue_points / QR verification ---
    #[msg("QR code has expired")]
    QrExpired,
    #[msg("QR expiry is unreasonably far in the future")]
    QrTtlTooLong,
    #[msg("Points amount exceeds the per-transaction issuance cap")]
    IssueCapExceeded,
    #[msg("Points amount must be greater than zero")]
    ZeroAmount,
    #[msg("Missing ed25519 signature-verification instruction before issue_points")]
    MissingEd25519Instruction,
    #[msg("Malformed ed25519 verification instruction")]
    MalformedEd25519Instruction,
    #[msg("QR signature was not produced by the merchant's registered signer")]
    QrSignerMismatch,
    #[msg("Signed QR payload does not match the instruction arguments")]
    QrPayloadMismatch,

    // --- oracle ---
    #[msg("Oracle price is stale")]
    StalePrice,
    #[msg("Oracle confidence interval is too wide")]
    LowConfidencePrice,
    #[msg("Oracle price is non-positive")]
    InvalidPrice,
    #[msg("Price account does not match the vault's configured feed")]
    FeedMismatch,

    // --- positions ---
    #[msg("Leverage must be 1, 2 or 5 and within the configured maximum")]
    InvalidLeverage,
    #[msg("Stake exceeds the vault's per-position cap")]
    StakeCapExceeded,
    #[msg("Global open exposure cap reached; try again later")]
    GlobalExposureCapExceeded,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Position id must equal the user's current position counter")]
    BadPositionId,
    #[msg("Position is not below the liquidation threshold")]
    NotLiquidatable,

    // --- marketplace ---
    #[msg("Listing is out of stock")]
    OutOfStock,
    #[msg("Listing does not belong to this merchant")]
    ListingMerchantMismatch,
    #[msg("Coupon tree is not configured yet; run the deploy script")]
    CouponTreeNotSet,
    #[msg("Wrong merkle tree account for the configured coupon tree")]
    WrongCouponTree,

    // --- badges ---
    #[msg("Unknown badge id")]
    UnknownBadge,
    #[msg("Badge conditions not met")]
    BadgeNotEligible,
    #[msg("Badge already claimed")]
    BadgeAlreadyClaimed,

    // --- strings ---
    #[msg("Provided string exceeds the maximum length")]
    StringTooLong,
}
