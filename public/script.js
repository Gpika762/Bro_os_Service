document.addEventListener('DOMContentLoaded', () => {
  // ===============================================
  // 1. GESTIÓN DE VENTANAS MODALES
  // ===============================================
  const modalLogin = document.getElementById('modal-login');
  const modalRegister = document.getElementById('modal-register');

  const showModal = (modal) => {
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden'; // Evita scroll de fondo
  };

  const hideModals = () => {
    modalLogin.classList.add('hidden');
    modalRegister.classList.add('hidden');
    document.body.style.overflow = '';
    // Limpiar formularios y mensajes al cerrar
    resetForms();
  };

  const resetForms = () => {
    const forms = document.querySelectorAll('form');
    const messages = document.querySelectorAll('.form-message');
    forms.forEach(form => form.reset());
    messages.forEach(msg => {
      msg.classList.add('hidden');
      msg.textContent = '';
      msg.classList.remove('error', 'success');
    });
  };

  // Escuchadores para mostrar modales
  document.getElementById('show-login').addEventListener('click', () => showModal(modalLogin));
  document.getElementById('show-register').addEventListener('click', () => showModal(modalRegister));
  document.getElementById('hero-register').addEventListener('click', () => showModal(modalRegister));

  // Cambiar entre modales dentro de la ventana
  document.querySelector('.show-register-alt').addEventListener('click', () => {
    modalLogin.classList.add('hidden');
    showModal(modalRegister);
  });
  document.querySelector('.show-login-alt').addEventListener('click', () => {
    modalRegister.classList.add('hidden');
    showModal(modalLogin);
  });

  // Cerrar modales (Botón X o clic en fondo)
  document.querySelectorAll('.close-modal, .modal-overlay').forEach(btn => {
    btn.addEventListener('click', hideModals);
  });

  // Cerrar con tecla ESC
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') hideModals();
  });


  // ===============================================
  // 2. LÓGICA DE FORMULARIOS (CONEXIÓN BACKEND)
  // ===============================================

  // Función genérica para enviar datos POST (Fetch API)
  const sendFormData = async (url, data, messageElement, submitButton) => {
    submitButton.disabled = true; // Deshabilitar botón para evitar doble clic
    messageElement.classList.add('hidden');
    messageElement.textContent = 'Procesando...';
    messageElement.classList.remove('error', 'success');

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      const result = await response.json();

      if (!response.ok) {
        // Error desde el servidor (ej: usuario ya existe, credenciales mal)
        throw new Error(result.error || 'Ocurrió un error inesperado');
      }

      // ÉXITO
      messageElement.textContent = result.message;
      messageElement.classList.add('success');
      messageElement.classList.remove('hidden');
      return result;

    } catch (error) {
      // ERROR (Red o Servidor)
      messageElement.textContent = error.message;
      messageElement.classList.add('error');
      messageElement.classList.remove('hidden');
      return null;

    } finally {
      submitButton.disabled = false; // Reabilitar botón
    }
  };

  // A. LÓGICA DE REGISTRO
  const formRegister = document.getElementById('form-register');
  const registerMessage = document.getElementById('register-message');

  formRegister.addEventListener('submit', async (e) => {
    e.preventDefault(); // Evitar recarga de página

    const username = document.getElementById('register-username').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    const submitBtn = formRegister.querySelector('button[type="submit"]');

    // Validación local: Contraseñas coinciden
    if (password !== confirm) {
      registerMessage.textContent = 'Las contraseñas no coinciden, bro.';
      registerMessage.classList.add('error');
      registerMessage.classList.remove('hidden');
      return;
    }

    const data = { username, password };
    const success = await sendFormData('/api/accounts/register', data, registerMessage, submitBtn);

    if (success) {
      formRegister.reset(); // Limpiar formulario
      // Opcional: Redirigir al login después de 2 segundos
      setTimeout(() => {
        modalRegister.classList.add('hidden');
        showModal(modalLogin);
        // Pre-rellenar el nombre de usuario en el login
        document.getElementById('login-username').value = username;
      }, 2000);
    }
  });

  // B. LÓGICA DE LOGIN
  const formLogin = document.getElementById('form-login');
  const loginMessage = document.getElementById('login-message');

  formLogin.addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const submitBtn = formLogin.querySelector('button[type="submit"]');

    const data = { username, password };
    const result = await sendFormData('/api/accounts/login', data, loginMessage, submitBtn);

    if (result) {
      // ÉXITO TOTAL
      loginMessage.textContent = `¡Bienvenido ${result.username}! Redirigiendo...`;
      
      // AQUÍ GUARDARÍAMOS EL TOKEN (Si usáramos JWT más adelante)
      // localStorage.setItem('bro_token', result.token);

      setTimeout(() => {
        // Redirigir al panel de Bro Talk (cuando lo hagamos)
        // window.location.href = '/brotalk';
        hideModals();
        alert('Login exitoso. ¡Ya estás autenticado para Bro Talk!');
      }, 1500);
    }
  });

});
