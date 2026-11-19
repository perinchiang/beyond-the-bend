import portrait from '../art/mara.webp?inline';
import './postalCounter.css';

type Visit = 'send' | 'receive';
type Sign = () => Promise<number | null>; // null if another tab has already taken this job

export function postalCounter(onChange: (open: boolean) => void, officeOnRight: () => boolean) {
  const dialog = document.querySelector<HTMLDialogElement>('#postal-counter')!;
  const sign = document.querySelector<HTMLButtonElement>('#post-sign')!;
  const leave = document.querySelector<HTMLButtonElement>('#post-close')!;
  const line = document.getElementById('post-line')!;
  const receipt = document.getElementById('post-receipt')!;
  const stamp = document.getElementById('post-stamp')!;
  const payment = document.getElementById('post-payment')!;
  const direction = document.getElementById('post-direction')!;
  document.querySelector<HTMLImageElement>('#post-mara')!.src = portrait;
  let commit: Sign | undefined, visit: Visit = 'send', signing = false, timer = 0;

  function close() { if (!signing && dialog.open) dialog.close(); }
  async function confirm() {
    if (signing || !dialog.open) return;
    if (!commit) { close(); return; }
    signing = true;
    sign.disabled = true;
    try {
      const award = await commit();
      commit = undefined;
      if (award === null) { dialog.close(); return; }
      sign.hidden = true;
      stamp.textContent = visit === 'send' ? 'Dispatched' : 'Received';
      payment.textContent = visit === 'send' ? 'Parcel on board' : '+' + award + ' coins';
      receipt.hidden = false;
      leave.focus({ preventScroll: true });
      timer = window.setTimeout(close, 1500);
    } finally {
      signing = false;
      sign.disabled = false;
    }
  }
  sign.onclick = () => void confirm();
  leave.onclick = close;
  dialog.addEventListener('cancel', e => { if (signing) e.preventDefault(); });
  dialog.addEventListener('close', () => {
    window.clearTimeout(timer);
    commit = undefined;
    onChange(false);
  });
  return {
    get open() { return dialog.open; },
    close,
    confirm,
    visit(kind: Visit, familiar: boolean, signJob: Sign) {
      if (dialog.open) return;
      visit = kind;
      commit = signJob;
      sign.hidden = false;
      sign.disabled = false;
      receipt.hidden = true;
      dialog.dataset.side = officeOnRight() ? 'left' : 'right';
      direction.textContent = kind === 'send' ? 'Deliver to' : 'Mail from';
      line.textContent = kind === 'send'
        ? (familiar ? 'A little parcel for the porter. You know the way by now.' : 'The porter left his scarf here again. Will you take it down to the station?')
        : (familiar ? 'A fresh timetable! I’ll take the old one down.' : 'The new timetable! I’ll pin it by the door for everyone who walks past.');
      sign.textContent = kind === 'send' ? 'Take station parcel' : 'Deliver timetables';
      dialog.showModal();
      sign.focus({ preventScroll: true });
      onChange(true);
    },
  };
}
export type PostalCounter = ReturnType<typeof postalCounter>;
