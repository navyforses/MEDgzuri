-- ═══════════════════════════════════════════════════════════════
-- MedGzuri Database Schema — Supabase (PostgreSQL)
-- Run this in Supabase SQL Editor to initialize the database
-- ═══════════════════════════════════════════════════════════════

-- 1. Search Logs — tracks every search for analytics
CREATE TABLE IF NOT EXISTS search_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    search_type TEXT NOT NULL CHECK (search_type IN ('research', 'symptoms', 'clinics', 'report')),
    query TEXT NOT NULL DEFAULT '',
    result_count INTEGER DEFAULT 0,
    pipeline_ms INTEGER DEFAULT 0,
    source TEXT DEFAULT 'direct',
    client_ip TEXT DEFAULT '',
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Leads — contact form submissions (replaces localStorage)
CREATE TABLE IF NOT EXISTS leads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    email TEXT,
    message TEXT,
    source TEXT DEFAULT 'website',
    documents_url TEXT,
    status TEXT DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'qualified', 'in_progress', 'closed_won', 'closed_lost')),
    assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Saved Searches — user's search history & bookmarks
CREATE TABLE IF NOT EXISTS saved_searches (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    search_type TEXT NOT NULL,
    query_data JSONB NOT NULL,
    result_data JSONB,
    title TEXT,
    is_bookmarked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- 4. User Profiles — extends Supabase auth.users
CREATE TABLE IF NOT EXISTS profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    phone TEXT,
    role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'operator')),
    avatar_url TEXT,
    preferred_language TEXT DEFAULT 'ka',
    subscription_tier TEXT DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
    subscription_expires TIMESTAMPTZ,
    gumroad_license_key TEXT,
    daily_search_count INTEGER DEFAULT 0,
    last_search_date DATE,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Site Config — replaces localStorage admin config
CREATE TABLE IF NOT EXISTS site_config (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- 6. User Bookmarks — saved search results
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

-- 7. Research Alerts — monitoring queries
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

-- 8. Pending Subscriptions — Gumroad purchases before user signup
CREATE TABLE IF NOT EXISTS pending_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    license_key TEXT,
    claimed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════ INDEXES ═══════════════

CREATE INDEX IF NOT EXISTS idx_search_logs_type ON search_logs(search_type);
CREATE INDEX IF NOT EXISTS idx_search_logs_created ON search_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_searches_created ON saved_searches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_subscription ON profiles(subscription_tier);
CREATE INDEX IF NOT EXISTS idx_bookmarks_user ON user_bookmarks(user_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON research_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_pending_subs_email ON pending_subscriptions(email);

-- ═══════════════ ROW LEVEL SECURITY ═══════════════

ALTER TABLE search_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE site_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_bookmarks ENABLE ROW LEVEL SECURITY;
ALTER TABLE research_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE pending_subscriptions ENABLE ROW LEVEL SECURITY;

-- Search logs: service role can insert, admins can read
CREATE POLICY "Service can insert search logs"
    ON search_logs FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Admins can read search logs"
    ON search_logs FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
    );

-- Leads: admins and operators can CRUD
CREATE POLICY "Staff can manage leads"
    ON leads FOR ALL
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role IN ('admin', 'operator'))
    );

-- Saved searches: users own their data
CREATE POLICY "Users own their saved searches"
    ON saved_searches FOR ALL
    USING (auth.uid() = user_id);

-- Profiles: users can read/update their own profile
CREATE POLICY "Users can view own profile"
    ON profiles FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON profiles FOR UPDATE
    USING (auth.uid() = id);

-- Admins can view all profiles
CREATE POLICY "Admins can view all profiles"
    ON profiles FOR SELECT
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
    );

-- Site config: admins can CRUD, everyone can read
CREATE POLICY "Anyone can read site config"
    ON site_config FOR SELECT
    USING (true);

CREATE POLICY "Admins can manage site config"
    ON site_config FOR ALL
    USING (
        EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'admin')
    );

-- Bookmarks: users own their bookmarks
CREATE POLICY "Users own their bookmarks"
    ON user_bookmarks FOR ALL
    USING (auth.uid() = user_id);

-- Alerts: users own their alerts
CREATE POLICY "Users own their alerts"
    ON research_alerts FOR ALL
    USING (auth.uid() = user_id);

-- Pending subscriptions: service role only
CREATE POLICY "Service can manage pending subscriptions"
    ON pending_subscriptions FOR ALL
    WITH CHECK (true);

-- ═══════════════ TRIGGERS ═══════════════

-- Auto-create profile on user signup (with free tier)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, role, subscription_tier)
    VALUES (NEW.id, NEW.raw_user_meta_data->>'full_name', 'user', 'free');
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER leads_updated_at
    BEFORE UPDATE ON leads
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER profiles_updated_at
    BEFORE UPDATE ON profiles
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
