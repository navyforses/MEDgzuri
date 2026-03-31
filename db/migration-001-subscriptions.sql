-- ═══════════════════════════════════════════════════════════════
-- Migration 001: Add subscription, bookmarks, alerts, pending_subscriptions
-- Run in Supabase SQL Editor on existing database
-- ═══════════════════════════════════════════════════════════════

-- 1. Add subscription columns to profiles
ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'free'
        CHECK (subscription_tier IN ('free', 'pro')),
    ADD COLUMN IF NOT EXISTS subscription_expires TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS gumroad_license_key TEXT,
    ADD COLUMN IF NOT EXISTS daily_search_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS last_search_date DATE;

CREATE INDEX IF NOT EXISTS idx_profiles_subscription ON profiles(subscription_tier);

-- 2. Create user_bookmarks table
CREATE TABLE IF NOT EXISTS user_bookmarks (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    source TEXT,
    body TEXT,
    tags TEXT[] DEFAULT '{}',
    url TEXT,
    search_type TEXT,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON user_bookmarks(user_id);
ALTER TABLE user_bookmarks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their bookmarks"
    ON user_bookmarks FOR ALL
    USING (auth.uid() = user_id);

-- 3. Create research_alerts table
CREATE TABLE IF NOT EXISTS research_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    query TEXT NOT NULL,
    search_type TEXT DEFAULT 'research',
    frequency TEXT DEFAULT 'weekly' CHECK (frequency IN ('daily', 'weekly', 'monthly')),
    is_active BOOLEAN DEFAULT true,
    last_run TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_user ON research_alerts(user_id);
ALTER TABLE research_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users own their alerts"
    ON research_alerts FOR ALL
    USING (auth.uid() = user_id);

-- 4. Create pending_subscriptions table
CREATE TABLE IF NOT EXISTS pending_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    license_key TEXT,
    claimed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_subs_email ON pending_subscriptions(email);
ALTER TABLE pending_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service can manage pending subscriptions"
    ON pending_subscriptions FOR ALL
    WITH CHECK (true);

-- 5. Update handle_new_user trigger to set subscription_tier
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role, subscription_tier)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', 'user', 'free');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
