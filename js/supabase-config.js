// ==================== SUPABASE CONFIG ====================
// Отвечает за: инициализацию Supabase и auth-адаптер, совместимый с текущим UI-кодом

(function initSupabaseConfig() {
    // TODO: вставьте свои значения из Supabase Project Settings -> API
    const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
    const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

    if (!window.supabase || typeof window.supabase.createClient !== 'function') {
        console.error('Supabase SDK не загружен');
        return;
    }

    const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });

    const normalizeUser = (user) => {
        if (!user) return null;
        const metadata = user.user_metadata || {};
        return {
            ...user,
            uid: user.id,
            displayName: metadata.full_name || metadata.name || metadata.user_name || user.email?.split('@')[0] || 'Игрок',
            photoURL: metadata.avatar_url || null
        };
    };

    const mapAuthError = (err) => {
        if (!err) return err;
        const mapped = new Error(err.message || 'Auth error');
        mapped.code = err.code || err.message;

        if (err.message?.includes('Invalid login credentials')) {
            mapped.code = 'auth/invalid-credential';
        }
        if (err.message?.includes('User already registered')) {
            mapped.code = 'auth/email-already-in-use';
        }

        return mapped;
    };

    // Firebase-совместимые глобальные адаптеры
    window.supabaseClient = supabaseClient;
    window.auth = supabaseClient.auth;
    window.db = { provider: 'supabase' };

    window.GoogleAuthProvider = function GoogleAuthProvider() {
        this.providerId = 'google';
    };

    window.signInWithPopup = async function signInWithPopup(_auth, providerInstance) {
        const provider = providerInstance?.providerId || 'google';
        const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}`;
        const { error } = await supabaseClient.auth.signInWithOAuth({
            provider,
            options: { redirectTo }
        });
        if (error) throw mapAuthError(error);
        return { provider };
    };

    window.signInWithEmailAndPassword = async function signInWithEmailAndPassword(_auth, email, password) {
        const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw mapAuthError(error);
        return { user: normalizeUser(data.user), session: data.session };
    };

    window.createUserWithEmailAndPassword = async function createUserWithEmailAndPassword(_auth, email, password) {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw mapAuthError(error);
        return { user: normalizeUser(data.user), session: data.session };
    };

    window.signOut = async function signOut() {
        const { error } = await supabaseClient.auth.signOut();
        if (error) throw mapAuthError(error);
    };

    window.onAuthStateChanged = function onAuthStateChanged(_auth, callback) {
        let isActive = true;

        supabaseClient.auth.getUser().then(({ data }) => {
            if (!isActive) return;
            callback(normalizeUser(data?.user || null));
        });

        const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
            if (!isActive) return;
            callback(normalizeUser(session?.user || null));
        });

        return function unsubscribe() {
            isActive = false;
            listener?.subscription?.unsubscribe();
        };
    };
})();
