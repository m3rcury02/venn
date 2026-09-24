// Set by lib/supabase/proxy.ts only once a user has confirmed they are 18 or
// older and finished onboarding. components/analytics.tsx starts PostHog only
// when it is present, so nobody who hasn't confirmed is tracked (DPDP bars
// behavioural tracking of children). Its own module because the client-side
// analytics component can't import the proxy's server code.
export const ANALYTICS_COOKIE = "venn_analytics";
