// ==================== АВТОРИЗАЦИЯ ====================
// Отвечает за: вход/выход через Google и Email, состояние пользователя

window.setupAuth = function() {
    const userMenuWrap = document.getElementById('user-menu-wrap');
    const userInfo = document.getElementById('user-info');
    const userMenuTrigger = document.getElementById('user-menu-trigger');
    const userPhoto = document.getElementById('user-photo');
    const userNameEl = document.getElementById('user-name');
    const userMenu = document.getElementById('user-menu');
    const logoutBtn = document.getElementById('logout-btn');
    const userAvatarBtn = document.getElementById('user-avatar-btn');
    const avatarFileInput = document.getElementById('avatar-file-input');
    const AVATAR_BUCKET = 'avatars';
    const MAX_AVATAR_SIZE_BYTES = 5 * 1024 * 1024;
    let isAvatarUploading = false;

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
        userMenuTrigger?.setAttribute('aria-expanded', 'false');
    };

    const toggleUserMenu = () => {
        if (!userMenu) return;
        userMenu.classList.toggle('hidden');
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
        window.currentUser = user;
        const authGroup = document.getElementById('auth-buttons');
        
        if (user) {
            authGroup?.classList.add('hidden');
            userMenuWrap?.classList.remove('hidden');
            
            const userName = window.getUserName(user);
            userNameEl.innerText = userName;
            applyUserAvatar(user);
            
            if (!new URLSearchParams(window.location.search).get('room')) {
                if (window.loadLobby) window.loadLobby(user);
            }
        } else {
            closeUserMenu();
            authGroup?.classList.remove('hidden');
            userMenuWrap?.classList.add('hidden');
        }
    });

    // Google вход
    document.getElementById('login-google').onclick = async () => {
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

    document.getElementById('login-email-trigger').onclick = () => {
        emailError.classList.add('hidden');
        emailModal.classList.remove('hidden');
    };
    
    document.getElementById('close-email-modal').onclick = () => emailModal.classList.add('hidden');

    // Вход по Email
    document.getElementById('login-email-btn').onclick = async () => {
        const email = document.getElementById('email-input').value.trim();
        const pass = document.getElementById('password-input').value;
        if (!email || !pass) return showError("Введите почту и пароль");

        try {
            await signInWithEmailAndPassword(window.auth, email, pass);
            emailModal.classList.add('hidden');
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
            emailModal.classList.add('hidden');
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
        closeUserMenu();
        signOut(window.auth)
            .then(() => {
                location.href = location.origin + location.pathname;
            })
            .catch((err) => {
                window.notify('Ошибка выхода: ' + (err?.message || err), 'error', 3600);
            });
    };
};
