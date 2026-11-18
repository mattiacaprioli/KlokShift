/**
 * Raggruppa le richieste di segnare «ricevuto»: una raffica di messaggi in
 * arrivo (o un ritorno in primo piano subito dopo) fa **una** chiamata, dopo
 * `delayMs` di quiete. È best effort: un errore si ignora, il prossimo segnale
 * riprova, e la RPC non scrive nulla se non c'è niente di nuovo.
 */
export function createDeliveryScheduler(
  mark: () => Promise<unknown>,
  delayMs: number
): { request(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function cancel() {
    if (timer != null) clearTimeout(timer);
    timer = null;
  }

  function request() {
    cancel();
    timer = setTimeout(() => {
      timer = null;
      mark().catch(() => {
        // Best effort: le spunte del mittente restano un passo indietro
        // fino al prossimo segnale.
      });
    }, delayMs);
  }

  return { request, cancel };
}
