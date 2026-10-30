// Mesej popup ringkas (bawah skrin) + popup info bertempat pada pointer (hover objek) —
// diekstrak dari index.html. Factory sebab infoPopupHideTimer dikongsi/di-reassign antara
// showPopupMessage/showInfoPopupAtPointer DAN caller luar (hover handler) yang perlu
// clearTimeout() ia terus — lihat clearPopupHideTimer().
export function createPopups({ infoPopup, container }) {
    let infoPopupHideTimer = null;

    function showPopupMessage(message, duration) {
        infoPopup.innerText = message;
        infoPopup.style.left = '50%';
        infoPopup.style.top = 'auto';
        infoPopup.style.bottom = '30px';
        infoPopup.style.transform = 'translateX(-50%)';
        infoPopup.style.display = 'block';

        clearTimeout(infoPopupHideTimer);
        infoPopupHideTimer = setTimeout(() => { infoPopup.style.display = 'none'; }, duration);
    }

    function showInfoPopupAtPointer(title, content, duration, clientX, clientY) {
        infoPopup.innerHTML = '';
        if (title) {
            const elTitle = document.createElement('div');
            elTitle.className = 'info-popup-title';
            elTitle.textContent = title;
            infoPopup.appendChild(elTitle);
        }
        const elContent = document.createElement('div');
        elContent.className = 'info-popup-content';
        elContent.textContent = content || '';
        infoPopup.appendChild(elContent);

        infoPopup.style.bottom = 'auto';
        infoPopup.style.transform = 'none';
        infoPopup.style.display = 'block';

        const containerRect = container.getBoundingClientRect();
        let left = clientX - containerRect.left + 16;
        let top = clientY - containerRect.top + 16;

        const maxLeft = container.clientWidth - infoPopup.offsetWidth - 10;
        const maxTop = container.clientHeight - infoPopup.offsetHeight - 10;
        left = Math.max(10, Math.min(left, Math.max(10, maxLeft)));
        top = Math.max(10, Math.min(top, Math.max(10, maxTop)));

        infoPopup.style.left = left + 'px';
        infoPopup.style.top = top + 'px';

        clearTimeout(infoPopupHideTimer);
        infoPopupHideTimer = setTimeout(() => { infoPopup.style.display = 'none'; }, duration);
    }

    function clearPopupHideTimer() {
        clearTimeout(infoPopupHideTimer);
    }

    return { showPopupMessage, showInfoPopupAtPointer, clearPopupHideTimer };
}
