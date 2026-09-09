/**
 * OAuth-related response/state types for the Claude AI (console.anthropic.com)
 * OAuth flow. Shapes mirror the responses returned by the OAuth endpoints
 * consumed in src/services/oauth/* and src/constants/oauth.js.
 *
 * Note: SubscriptionType deliberately omits the `| (string & {})` escape hatch
 * used by other string-ish unions here — callers exhaustively narrow it
 * (see src/commands/login/getAuthStatus.ts), and unknown historical values like
 * 'free' are widened at those call sites explicitly.
 */

/** Subscription plans surfaced by the CLI (see src/utils/auth.ts usage). */
export type SubscriptionType = 'max' | 'pro' | 'team' | 'enterprise'

/** Stripe/app-store billing backends (see isOverageProvisioningAllowed). */
export type BillingType =
  | 'stripe_subscription'
  | 'stripe_subscription_contracted'
  | 'apple_subscription'
  | 'google_play_subscription'
  | 'enterprise_contract'
  | (string & {})

/** Rate-limit tier returned by the profile/org endpoints. */
export type RateLimitTier =
  | 'default_claude_max_5x'
  | 'default_claude_max_20x'
  | (string & {})

/** Referral campaigns the passes feature understands. */
export type ReferralCampaign = 'claude_code_guest_pass' | (string & {})

/** Parsed/stored OAuth tokens (snake_case API fields → camelCase locals). */
export type OAuthTokens = {
  accessToken: string
  refreshToken: string | null
  expiresAt: number | null
  scopes: string[]
  subscriptionType: SubscriptionType | null
  rateLimitTier: RateLimitTier | null
  profile?: OAuthProfileResponse
  tokenAccount?: {
    uuid: string
    emailAddress: string
    organizationUuid?: string
  }
}

/** Raw response from POST {TOKEN_URL} (authorization_code / refresh_token). */
export type OAuthTokenExchangeResponse = {
  access_token: string
  refresh_token?: string
  expires_in: number
  scope?: string
  account?: {
    uuid: string
    email_address: string
  }
  organization?: {
    uuid?: string
  }
}

/**
 * Raw response from GET /api/oauth/profile. account/org are required because
 * consumers index into them without optional chaining after a truthy check.
 */
export type OAuthProfileResponse = {
  account: {
    uuid: string
    email: string
    display_name?: string
    created_at?: string
    has_claude_max?: boolean
    has_claude_pro?: boolean
  }
  organization: {
    uuid: string
    organization_type?:
      | 'claude_max'
      | 'claude_pro'
      | 'claude_enterprise'
      | 'claude_team'
      | string
    rate_limit_tier?: RateLimitTier | null
    has_extra_usage_enabled?: boolean | null
    billing_type?: BillingType | null
    subscription_created_at?: string
    display_name?: string
  }
}

/** Raw response from GET {ROLES_URL} (stored onto AccountInfo). */
export type UserRolesResponse = {
  organization_role?: string | null
  workspace_role?: string | null
  organization_name?: string | null
}

/** Referral eligibility payload returned by the referral endpoint. */
export type ReferralEligibilityResponse = {
  eligible: boolean
  referral_code_details?: {
    referral_link?: string
    campaign?: ReferralCampaign
  }
  referrer_reward?: ReferrerRewardInfo
  remaining_passes?: number
}

/** Referral redemptions payload. */
export type ReferralRedemptionsResponse = {
  redemptions?: unknown[]
  limit?: number
}

/** Referrer reward credit info used by formatCreditAmount. */
export type ReferrerRewardInfo = {
  currency: string
  amount_minor_units: number
}
