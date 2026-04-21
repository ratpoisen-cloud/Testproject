// ==================== АВТОРИЗАЦИЯ ====================
// Отвечает за: вход/выход через Google и Email, состояние пользователя

window.setupAuth = function() {
    const userMenuWrap = document.getElementById('user-menu-wrap');
    const authButtons = document.getElementById('auth-buttons');
    const guestSection = document.getElementById('guest-section');
    const lobbySection = document.getElementById('lobby-section');
    const gameSection = document.getElementById('game-section');
    const userInfo = document.getElementById('user-info');
    const userMenuTrigger = document.getElementById('user-menu-trigger');
    const userPhoto = document.getElementById('user-photo');
    const userNameEl = document.getElementById('user-name');
    const userMenu = document.getElementById('user-menu');
    const userMenuLobbyBtn = document.getElementById('user-menu-lobby-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const userAvatarBtn = document.getElementById('user-avatar-btn');
    const avatarFileInput = document.getElementById('avatar-file-input');
    const AVATAR_BUCKET = 'avatars';
    const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
    const USER_MENU_VIEWPORT_PADDING = 8;
    let isAvatarUploading = false;
    let hasResolvedInitialAuthState = false;

    const isLocalModeRequested = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get('bot') === '1'
            || (params.get('training') === '1' && params.get('mode') === 'self');
    };

    window.setAppAuthView = (isAuthorized) => {
        document.body.classList.toggle('auth-state', isAuthorized);
        document.body.classList.toggle('guest-state', !isAuthorized);
        authButtons?.classList.toggle('hidden', isAuthorized);
        userMenuWrap?.classList.toggle('hidden', !isAuthorized);

        if (isAuthorized) {
            guestSection?.classList.add('hidden');
            if (!gameSection || gameSection.classList.contains('hidden')) {
                lobbySection?.classList.remove('hidden');
            }
            window.updateTopLobbyBrandVisibility?.();
            return;
        }

        if (isLocalModeRequested()) {
            guestSection?.classList.add('hidden');
            gameSection?.classList.remove('hidden');
            lobbySection?.classList.add('hidden');
            window.updateTopLobbyBrandVisibility?.();
            return;
        }

        lobbySection?.classList.add('hidden');
        gameSection?.classList.add('hidden');
        guestSection?.classList.remove('hidden');
        window.updateTopLobbyBrandVisibility?.();
    };

    const hideModalById = (id) => {
        document.getElementById(id)?.classList.add('hidden');
    };

    const cleanupGuestUiState = () => {
        if (isLocalModeRequested() && window.isLocalGameMode?.()) {
            closeUserMenu();
            hideModalById('email-modal');
            document.body.classList.remove('email-modal-open');
            hideModalById('create-game-modal');
            hideModalById('bot-game-modal');
            hideModalById('training-mode-modal');
            document.getElementById('email-error')?.classList.add('hidden');
            return;
        }
        closeUserMenu();
        hideModalById('email-modal');
        document.body.classList.remove('email-modal-open');
        hideModalById('create-game-modal');
        hideModalById('game-modal');
        hideModalById('quick-phrases-menu');
        document.getElementById('email-error')?.classList.add('hidden');
        if (typeof window.__lobbyWatchUnsubscribe === 'function') {
            window.__lobbyWatchUnsubscribe();
            window.__lobbyWatchUnsubscribe = null;
        }
        window.clearPendingLobbyDomFlush?.();
        window.pendingDraw = null;
        window.pendingTakeback = null;
        window.pendingMove = null;
        if (typeof window.__gameWatchUnsubscribe === 'function') {
            window.__gameWatchUnsubscribe();
            window.__gameWatchUnsubscribe = null;
        }
        window.resetQuickPhraseUiState?.();
        window.currentRoomId = null;
        window.playerColor = null;
        window.watchFirebaseCleanup?.();
        if (window.history?.replaceState) {
            window.history.replaceState({}, '', `${window.location.origin}${window.location.pathname}`);
        }
    };

    const setAvatarUploadState = (state) => {
        if (!userAvatarBtn) return;
        if (state === 'loading') {
            isAvatarUploading = true;
            userAvatarBtn.disabled = true;
            userAvatarBtn.innerText = 'Загрузка...';
            return;
        }
        isAvatarUploading = false;
        userAvatarBtn.disabled = false;
        userAvatarBtn.innerText = 'Изменить аватар';
    };

    const applyUserAvatar = (user) => {
        if (!userInfo || !userPhoto) return;
        const metadataCustomAvatar = typeof user?.user_metadata?.custom_avatar_url === 'string'
            ? user.user_metadata.custom_avatar_url
            : '';
        const customAvatarUrl = (typeof user?.customAvatarURL === 'string' ? user.customAvatarURL : '') || metadataCustomAvatar;
        const providerAvatarUrl = typeof user?.photoURL === 'string' ? user.photoURL : '';
        const selectedAvatarUrl = customAvatarUrl || providerAvatarUrl;
        const userName = window.getUserName(user);
        let letterAvatar = userInfo.querySelector('.letter-avatar');

        if (selectedAvatarUrl) {
            userPhoto.src = selectedAvatarUrl;
            userPhoto.style.display = 'block';
            if (letterAvatar) letterAvatar.style.display = 'none';
            return;
        }

        userPhoto.style.display = 'none';
        if (!letterAvatar) {
            letterAvatar = document.createElement('div');
            letterAvatar.className = 'letter-avatar';
            userPhoto.parentNode.insertBefore(letterAvatar, userPhoto.nextSibling);
        }
        letterAvatar.style.display = 'flex';
        letterAvatar.innerText = userName.charAt(0).toUpperCase();
    };

    const uploadAvatarToSupabase = async (selectedFile) => {
        if (!window.supabaseClient || !window.currentUser?.uid) {
            throw new Error('Пользователь не авторизован');
        }

        if (!selectedFile.type || !selectedFile.type.startsWith('image/')) {
            throw new Error('Можно загружать только изображения');
        }

        if (selectedFile.size > MAX_AVATAR_SIZE_BYTES) {
            throw new Error('Файл слишком большой. Максимум 5 MB');
        }

        const extension = (selectedFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const filePath = `${window.currentUser.uid}/avatar.${extension}`;

        const { error: uploadError } = await window.supabaseClient.storage
            .from(AVATAR_BUCKET)
            .upload(filePath, selectedFile, {
                upsert: true,
                cacheControl: '3600',
                contentType: selectedFile.type
            });
        if (uploadError) throw uploadError;

        const { data: publicData } = window.supabaseClient.storage
            .from(AVATAR_BUCKET)
            .getPublicUrl(filePath);
        const publicUrl = publicData?.publicUrl;
        if (!publicUrl) {
            throw new Error('Не удалось получить URL загруженного аватара');
        }

        const customAvatarURL = `${publicUrl}?t=${Date.now()}`;
        const currentMetadata = window.currentUser.user_metadata && typeof window.currentUser.user_metadata === 'object'
            ? window.currentUser.user_metadata
            : {};
        const { data: authData, error: metadataError } = await window.supabaseClient.auth.updateUser({
            data: {
                ...currentMetadata,
                custom_avatar_url: customAvatarURL
            }
        });
        if (metadataError) throw metadataError;

        if (authData?.user) {
            window.currentUser = {
                ...window.currentUser,
                ...authData.user,
                customAvatarURL
            };
        } else {
            window.currentUser = {
                ...window.currentUser,
                customAvatarURL
            };
        }

        return customAvatarURL;
    };

    const closeUserMenu = () => {
        userMenu?.classList.add('hidden');
        if (userMenu) {
            userMenu.style.transform = '';
            userMenu.style.width = '';
            userMenu.style.maxWidth = '';
        }
        userMenuTrigger?.setAttribute('aria-expanded', 'false');
    };
    window.closeUserMenu = closeUserMenu;

    const positionUserMenu = () => {
        if (!userMenu || userMenu.classList.contains('hidden')) return;

        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const maxMenuWidth = Math.max(0, viewportWidth - USER_MENU_VIEWPORT_PADDING * 2);

        userMenu.style.transform = '';
        userMenu.style.width = '';
        userMenu.style.maxWidth = `${maxMenuWidth}px`;

        const naturalRect = userMenu.getBoundingClientRect();
        if (naturalRect.width > maxMenuWidth) {
            userMenu.style.width = `${maxMenuWidth}px`;
        }

        const rect = userMenu.getBoundingClientRect();
        let shiftX = 0;
        const minLeft = USER_MENU_VIEWPORT_PADDING;
        const maxRight = viewportWidth - USER_MENU_VIEWPORT_PADDING;

        if (rect.left < minLeft) {
            shiftX += minLeft - rect.left;
        }
        if (rect.right > maxRight) {
            shiftX -= rect.right - maxRight;
        }

        if (shiftX !== 0) {
            userMenu.style.transform = `translateX(${Math.round(shiftX)}px)`;
        }
    };

    const toggleUserMenu = () => {
        if (!userMenu) return;
        document.getElementById('quick-phrases-menu')?.classList.add('hidden');
        userMenu.classList.toggle('hidden');
        if (!userMenu.classList.contains('hidden')) {
            positionUserMenu();
        }
        userMenuTrigger?.setAttribute('aria-expanded', String(!userMenu.classList.contains('hidden')));
    };

    userMenuTrigger?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleUserMenu();
    });

    userMenuTrigger?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            toggleUserMenu();
        }
    });

    document.addEventListener('click', (event) => {
        if (!userMenuWrap?.contains(event.target)) {
            closeUserMenu();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeUserMenu();
        }
    });

    window.addEventListener('resize', positionUserMenu);

    userAvatarBtn?.addEventListener('click', () => {
        if (isAvatarUploading) return;
        avatarFileInput?.click();
        closeUserMenu();
    });

    avatarFileInput?.addEventListener('change', async () => {
        const selectedFile = avatarFileInput.files?.[0] || null;
        if (!selectedFile) {
            avatarFileInput.value = '';
            return;
        }

        try {
            setAvatarUploadState('loading');
            const customAvatarURL = await uploadAvatarToSupabase(selectedFile);
            applyUserAvatar({ ...window.currentUser, customAvatarURL });
            window.notify('Аватар успешно обновлён', 'success');
        } catch (error) {
            window.notify('Ошибка загрузки аватара: ' + (error?.message || error), 'error', 3600);
        } finally {
            setAvatarUploadState('idle');
            avatarFileInput.value = '';
        }
    });

    onAuthStateChanged(window.auth, (user) => {
        hasResolvedInitialAuthState = true;
        window.currentUser = user;

        window.setAppLoadingFlag?.('auth', false);

        if (user) {
            window.setAppAuthView(true);
            window.startPresenceLayer?.(user);

            const userName = window.getUserName(user);
            if (userNameEl) {
                userNameEl.innerText = userName;
            }
            applyUserAvatar(user);
            window.initClearFinishedButton?.(user.uid);

            if (!new URLSearchParams(window.location.search).get('room')) {
                window.setAppLoadingFlag?.('lobby', true);
                if (window.loadLobby) window.loadLobby(user);
            } else {
                window.setAppLoadingFlag?.('lobby', true);
            }
        } else {
            window.stopPresenceLayer?.();
            cleanupGuestUiState();
            window.setAppAuthView(false);
            if (!isBotModeRequested()) {
                window.setAppLoadingFlag?.('lobby', false);
            }
        }
    });

    // Google вход
    const handleGoogleLogin = async () => {
        try {
            await signInWithPopup(window.auth, new GoogleAuthProvider());
        } catch (err) {
            window.notify('Ошибка входа через Google: ' + (err.message || err), 'error', 3600);
        }
    };

    // Email модальное окно
    const emailModal = document.getElementById('email-modal');
    const emailError = document.getElementById('email-error');
    
    const showError = (msg) => {
        emailError.innerText = msg;
        emailError.classList.remove('hidden');
    };

    const openEmailModal = () => {
        emailError.classList.add('hidden');
        emailModal.classList.remove('hidden');
        document.body.classList.add('email-modal-open');
    };

    const closeEmailModal = () => {
        emailModal.classList.add('hidden');
        document.body.classList.remove('email-modal-open');
    };

    document.getElementById('login-google').onclick = handleGoogleLogin;
    document.getElementById('guest-login-google').onclick = handleGoogleLogin;

    document.getElementById('login-email-trigger').onclick = openEmailModal;
    document.getElementById('guest-login-email').onclick = openEmailModal;
    
    document.getElementById('close-email-modal').onclick = closeEmailModal;

    // Вход по Email
    document.getElementById('login-email-btn').onclick = async () => {
        const email = document.getElementById('email-input').value.trim();
        const pass = document.getElementById('password-input').value;
        if (!email || !pass) return showError("Введите почту и пароль");

        try {
            await signInWithEmailAndPassword(window.auth, email, pass);
            closeEmailModal();
            document.getElementById('email-input').value = '';
            document.getElementById('password-input').value = '';
        } catch (err) {
            if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
                showError("Неверная почта или пароль");
            } else {
                showError("Ошибка входа: " + err.message);
            }
        }
    };

    // Регистрация по Email
    document.getElementById('register-email-btn').onclick = async () => {
        const email = document.getElementById('email-input').value.trim();
        const pass = document.getElementById('password-input').value;
        
        if (!email) return showError("Введите почту");
        if (pass.length < 6) return showError("Пароль должен быть от 6 символов");

        try {
            const authResult = await createUserWithEmailAndPassword(window.auth, email, pass);
            closeEmailModal();
            document.getElementById('email-input').value = '';
            document.getElementById('password-input').value = '';

            // Supabase: при включенном Email Confirmation сессия может не создаться сразу
            if (!authResult?.session) {
                window.notify('Аккаунт создан. Подтвердите email, затем выполните вход.', 'info', 3600);
                return;
            }

            window.notify("Аккаунт успешно создан!", "success");
        } catch (err) {
            if (err.code === 'auth/email-already-in-use') {
                showError("Эта почта уже зарегистрирована");
            } else {
                showError("Ошибка регистрации: " + err.message);
            }
        }
    };

    // Выход
    logoutBtn.onclick = () => {
        signOut(window.auth)
            .catch((err) => {
                window.notify('Ошибка выхода: ' + (err?.message || err), 'error', 3600);
            });
    };

    userMenuLobbyBtn?.addEventListener('click', () => {
        closeUserMenu();
        if (!window.currentUser) return;
        const targetUrl = `${window.location.origin}${window.location.pathname}`;
        if (window.location.href !== targetUrl) {
            window.location.href = targetUrl;
        }
    });

    if (!hasResolvedInitialAuthState) {
        document.body.classList.remove('auth-state', 'guest-state');
        window.setAppLoadingFlag?.('auth', true);
        window.setAppLoadingFlag?.('lobby', false);
    }
};
