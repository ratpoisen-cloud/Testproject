// ==================== АВТОРИЗАЦИЯ ====================
// Отвечает за: вход/выход через Google и Email, состояние пользователя

window.setupAuth = function() {
    const userInfo = document.getElementById('user-info');
    const userPhoto = document.getElementById('user-photo');
    const userNameEl = document.getElementById('user-name');
    const userMenu = document.getElementById('user-menu');
    const logoutBtn = document.getElementById('logout-btn');
    const userEditBtn = document.getElementById('user-edit-btn');
    const userThemesBtn = document.getElementById('user-themes-btn');

    const closeUserMenu = () => {
        userMenu?.classList.add('hidden');
    };

    const toggleUserMenu = () => {
        if (!userMenu) return;
        userMenu.classList.toggle('hidden');
    };

    [userPhoto, userNameEl].forEach((trigger) => {
        trigger?.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleUserMenu();
        });
    });

    userInfo?.addEventListener('click', (event) => {
        if (event.target.closest('.letter-avatar')) {
            event.stopPropagation();
            toggleUserMenu();
        }
    });

    document.addEventListener('click', (event) => {
        if (!userInfo?.contains(event.target)) {
            closeUserMenu();
        }
    });

    userEditBtn?.addEventListener('click', () => {
        window.notify('Скоро будет', 'info');
        closeUserMenu();
    });

    userThemesBtn?.addEventListener('click', () => {
        window.notify('Скоро будет', 'info');
        closeUserMenu();
    });

    onAuthStateChanged(window.auth, (user) => {
        window.currentUser = user;
        const authGroup = document.getElementById('auth-buttons');
        
        if (user) {
            authGroup?.classList.add('hidden');
            userInfo?.classList.remove('hidden');
            
            const userName = window.getUserName(user);
            document.getElementById('user-name').innerText = userName;
            
            if (user.photoURL) {
                userPhoto.src = user.photoURL;
                userPhoto.style.display = 'block';
                const letterAvatar = document.querySelector('.letter-avatar');
                if (letterAvatar) letterAvatar.style.display = 'none';
            } else {
                userPhoto.style.display = 'none';
                let letterAvatar = document.querySelector('.letter-avatar');
                if (!letterAvatar) {
                    letterAvatar = document.createElement('div');
                    letterAvatar.className = 'letter-avatar';
                    userPhoto.parentNode.insertBefore(letterAvatar, userPhoto.nextSibling);
                }
                letterAvatar.style.display = 'flex';
                letterAvatar.classList.add('user-menu-trigger');
                letterAvatar.innerText = userName.charAt(0).toUpperCase();
            }
            
            if (!new URLSearchParams(window.location.search).get('room')) {
                if (window.loadLobby) window.loadLobby(user);
            }
        } else {
            closeUserMenu();
            authGroup?.classList.remove('hidden');
            userInfo?.classList.add('hidden');
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
