// ==================== SUPABASE CONFIG ====================
// Отвечает за: инициализацию Supabase и auth-адаптер, совместимый с текущим UI-кодом

(function initSupabaseConfig() {
    const SUPABASE_URL = 'https://cyhuhrkzjhxuhcqvwzrx.supabase.co';
    const SUPABASE_ANON_KEY = 'sb_publishable_1nRdNqHgMXjhFGyefrdUQg_jejbh0J6';

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
        if (!user || typeof user !== 'object') return null;
        const metadata = (user.user_metadata && typeof user.user_metadata === 'object')
            ? user.user_metadata
            : {};
        const identities = Array.isArray(user.identities) ? user.identities : [];
        const firstIdentityData = identities[0]?.identity_data && typeof identities[0].identity_data === 'object'
            ? identities[0].identity_data
            : {};
        const email = typeof user.email === 'string' ? user.email : '';
        const emailName = email.includes('@') ? email.split('@')[0] : '';
        const providerPhoto = metadata.avatar_url || metadata.picture || firstIdentityData.avatar_url || firstIdentityData.picture || null;
        return {
            ...user,
            uid: user.id,
            displayName: metadata.full_name || metadata.name || metadata.user_name || emailName || 'Игрок',
            photoURL: providerPhoto,
            customAvatarURL: metadata.custom_avatar_url || null
        };
    };

    const mapAuthError = (err) => {
        if (!err) return new Error('Auth error');
        const message = typeof err.message === 'string' ? err.message : 'Auth error';
        const mapped = new Error(message);
        mapped.code = typeof err.code === 'string' ? err.code : 'auth/unknown';
        mapped.original = err;

        if (message.includes('Invalid login credentials')) {
            mapped.code = 'auth/invalid-credential';
        }
        if (message.includes('User already registered')) {
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
        const redirectTo = `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash || ''}`;
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
        if (typeof callback !== 'function') {
            console.warn('onAuthStateChanged вызван без callback-функции');
            return function noopUnsubscribe() {};
        }

        let isActive = true;
        let lastEmittedStateKey;
        let hasEmittedInitial = false;

        const emitIfChanged = (user) => {
            if (!isActive) return;
            const normalized = normalizeUser(user || null);
            const currentStateKey = normalized
                ? `${normalized.uid || ''}:${normalized.displayName || ''}:${normalized.photoURL || ''}:${normalized.customAvatarURL || ''}`
                : 'guest';
            if (hasEmittedInitial && currentStateKey === lastEmittedStateKey) return;
            hasEmittedInitial = true;
            lastEmittedStateKey = currentStateKey;
            callback(normalized);
        };

        supabaseClient.auth.getUser().then(({ data, error }) => {
            if (error) {
                console.warn('Не удалось получить текущего пользователя', error);
            }
            emitIfChanged(data?.user || null);
        }).catch((error) => {
            console.warn('Ошибка при получении текущего пользователя', error);
            emitIfChanged(null);
        });

        const { data: listener } = supabaseClient.auth.onAuthStateChange((_event, session) => {
            emitIfChanged(session?.user || null);
        });

        return function unsubscribe() {
            isActive = false;
            listener?.subscription?.unsubscribe();
        };
    };
})();
