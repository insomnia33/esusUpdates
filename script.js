// DOM Elements
const subscriptionForm = document.getElementById('subscriptionForm');
const emailInput = document.getElementById('email');
const submitBtn = document.getElementById('submitBtn');
const feedback = document.getElementById('feedback');
const feedbackMessage = document.getElementById('feedbackMessage');

// Form validation and submission
class SubscriptionManager {
    constructor() {
        this.init();
    }

    init() {
        this.bindEvents();
        this.setupValidation();
    }

    bindEvents() {
        subscriptionForm.addEventListener('submit', this.handleSubmit.bind(this));
        emailInput.addEventListener('input', this.handleEmailInput.bind(this));
        emailInput.addEventListener('blur', this.validateEmail.bind(this));
    }

    setupValidation() {
        // Real-time validation feedback
        emailInput.addEventListener('input', () => {
            this.clearFeedback();
        });
    }

    handleEmailInput(event) {
        const email = event.target.value.trim();
        
        // Clear previous validation states
        emailInput.classList.remove('valid', 'invalid');
        
        if (email.length > 0) {
            if (this.isValidEmail(email)) {
                emailInput.classList.add('valid');
            } else {
                emailInput.classList.add('invalid');
            }
        }
    }

    validateEmail() {
        const email = emailInput.value.trim();
        
        if (email.length === 0) {
            return false;
        }

        if (!this.isValidEmail(email)) {
            this.showFeedback('Por favor, insira um e-mail válido.', 'error');
            return false;
        }

        return true;
    }

    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    normalizeEmail(email) {
        return email.toLowerCase().trim();
    }

    async handleSubmit(event) {
        event.preventDefault();
        
        const email = this.normalizeEmail(emailInput.value);
        
        // Validate email
        if (!this.isValidEmail(email)) {
            this.showFeedback('Por favor, insira um e-mail válido.', 'error');
            emailInput.focus();
            return;
        }

        // Show loading state
        this.setLoadingState(true);
        this.clearFeedback();

        try {
            const response = await this.submitSubscription(email);
            
            if (response.success) {
                this.showFeedback(
                    'Inscrição realizada com sucesso! Verifique seu e-mail para confirmação.',
                    'success'
                );
                this.resetForm();
            } else {
                this.handleSubmissionError(response);
            }
        } catch (error) {
            console.error('Erro ao processar inscrição:', error);
            this.showFeedback(
                'Erro ao processar sua inscrição. Tente novamente em alguns minutos.',
                'error'
            );
        } finally {
            this.setLoadingState(false);
        }
    }

    async submitSubscription(email) {
        // Simulate API call for now - will be replaced with actual endpoint
        // This is a placeholder that will work with the worker implementation
        
        const response = await fetch('/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ email })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        return await response.json();
    }

    handleSubmissionError(response) {
        switch (response.error) {
            case 'INVALID_EMAIL':
                this.showFeedback('E-mail inválido. Verifique o formato.', 'error');
                emailInput.focus();
                break;
            case 'EMAIL_EXISTS':
                this.showFeedback('Este e-mail já está inscrito para receber notificações.', 'warning');
                break;
            case 'RATE_LIMITED':
                this.showFeedback('Muitas tentativas. Aguarde alguns minutos antes de tentar novamente.', 'warning');
                break;
            default:
                this.showFeedback('Erro ao processar inscrição. Tente novamente.', 'error');
        }
    }

    setLoadingState(loading) {
        if (loading) {
            submitBtn.disabled = true;
            submitBtn.classList.add('loading');
        } else {
            submitBtn.disabled = false;
            submitBtn.classList.remove('loading');
        }
    }

    showFeedback(message, type) {
        feedbackMessage.textContent = message;
        feedback.className = `feedback ${type}`;
        feedback.style.display = 'block';
        
        // Scroll to feedback if needed
        feedback.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                this.clearFeedback();
            }, 5000);
        }
    }

    clearFeedback() {
        feedback.style.display = 'none';
        feedback.className = 'feedback';
        feedbackMessage.textContent = '';
    }

    resetForm() {
        subscriptionForm.reset();
        emailInput.classList.remove('valid', 'invalid');
        emailInput.blur();
    }
}

// Enhanced form validation with visual feedback
class FormValidator {
    static addValidationStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .form-group input.valid {
                border-color: var(--success-color);
                box-shadow: 0 0 0 3px rgba(22, 163, 74, 0.1);
            }
            
            .form-group input.invalid {
                border-color: var(--error-color);
                box-shadow: 0 0 0 3px rgba(220, 38, 38, 0.1);
            }
            
            .form-group input.valid + .validation-icon::after {
                content: '✓';
                color: var(--success-color);
                position: absolute;
                right: 12px;
                top: 50%;
                transform: translateY(-50%);
            }
            
            .form-group {
                position: relative;
            }
            
            .validation-icon {
                position: absolute;
                right: 0;
                top: 0;
                height: 100%;
                width: 40px;
                pointer-events: none;
            }
        `;
        document.head.appendChild(style);
    }
}

// Accessibility enhancements
class AccessibilityManager {
    static init() {
        // Add ARIA labels and descriptions
        emailInput.setAttribute('aria-describedby', 'email-help');
        
        // Create help text
        const helpText = document.createElement('div');
        helpText.id = 'email-help';
        helpText.className = 'sr-only';
        helpText.textContent = 'Digite seu e-mail para receber notificações sobre atualizações do e-SUS APS';
        emailInput.parentNode.appendChild(helpText);
        
        // Announce feedback to screen readers
        feedback.setAttribute('role', 'alert');
        feedback.setAttribute('aria-live', 'polite');
    }
}

// Performance monitoring
class PerformanceMonitor {
    static init() {
        // Monitor form submission performance
        window.addEventListener('load', () => {
            console.log('Página carregada em:', performance.now(), 'ms');
        });
    }
}

// Initialize application
document.addEventListener('DOMContentLoaded', () => {
    // Initialize main functionality
    new SubscriptionManager();
    
    // Add validation styles
    FormValidator.addValidationStyles();
    
    // Setup accessibility
    AccessibilityManager.init();
    
    // Initialize performance monitoring
    PerformanceMonitor.init();
    
    console.log('Monitor e-SUS APS inicializado com sucesso');
});

// Error handling for uncaught errors
window.addEventListener('error', (event) => {
    console.error('Erro não capturado:', event.error);
    
    // Show user-friendly error message
    const feedback = document.getElementById('feedback');
    const feedbackMessage = document.getElementById('feedbackMessage');
    
    if (feedback && feedbackMessage) {
        feedbackMessage.textContent = 'Ocorreu um erro inesperado. Recarregue a página e tente novamente.';
        feedback.className = 'feedback error';
        feedback.style.display = 'block';
    }
});

// Handle network errors
window.addEventListener('online', () => {
    console.log('Conexão restaurada');
});

window.addEventListener('offline', () => {
    console.log('Conexão perdida');
    
    const feedback = document.getElementById('feedback');
    const feedbackMessage = document.getElementById('feedbackMessage');
    
    if (feedback && feedbackMessage) {
        feedbackMessage.textContent = 'Sem conexão com a internet. Verifique sua conexão e tente novamente.';
        feedback.className = 'feedback warning';
        feedback.style.display = 'block';
    }
});