export type ToastType = 'success' | 'error';

/**
 * Shows a transient toast message inside #toast-container, auto-dismissing after `duration`ms.
 */
export function showToast(message: string, type: ToastType = 'success', duration = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('is-visible'));

    setTimeout(() => {
        toast.classList.remove('is-visible');
        toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    }, duration);
}
