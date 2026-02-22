/**
 * Supabase Client — shared across all API endpoints
 *
 * Usage:
 *   const { getClient, getServiceClient } = require('../lib/supabase');
 *   const supabase = getServiceClient(); // server-side (full access)
 */

const { createClient } = require('@supabase/supabase-js');

let _serviceClient = null;

function getServiceClient() {
    if (_serviceClient) return _serviceClient;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;

    if (!url || !key) {
        console.warn('[MedGzuri] Supabase not configured — database features disabled');
        return null;
    }

    _serviceClient = createClient(url, key, {
        auth: { persistSession: false }
    });

    return _serviceClient;
}

function getPublicConfig() {
    return {
        url: process.env.SUPABASE_URL || null,
        anonKey: process.env.SUPABASE_ANON_KEY || null
    };
}

module.exports = { getServiceClient, getPublicConfig };
