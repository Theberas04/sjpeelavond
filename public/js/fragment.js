/**
 * fragment.js — de klok van een fragment.
 *
 * Een fragment duurt een afgesproken aantal seconden (dertig bij deze spellen) en moet op
 * pauze kunnen: bij Verder gaat het verder waar het gebleven was, en het einde schuift mee.
 * Daarom houdt deze klok de *gespeelde* tijd bij in plaats van het moment van starten.
 *
 * De tijd en de timers zijn in te stellen, zodat een proef de klok kan laten lopen zonder
 * te wachten: `maakKlok(30, { nu: () => nepTijd, plan, stopPlan, tik, stopTik })`.
 */

/**
 * @param {number} seconden hoe lang het fragment duurt
 * @param {object} [opties]
 * @param {(verstreken:number, totaal:number) => void} [opties.bijTeken] bij elke tik
 * @param {() => void} [opties.bijEinde] als het fragment afgelopen is
 * @param {() => number} [opties.nu] de tijd in milliseconden
 */
export function maakKlok(seconden, opties = {}) {
  const {
    bijTeken,
    bijEinde,
    nu = () => performance.now(),
    plan = (fn, ms) => setTimeout(fn, ms),
    stopPlan = (id) => clearTimeout(id),
    tik = (fn, ms) => setInterval(fn, ms),
    stopTik = (id) => clearInterval(id),
  } = opties;

  const totaal = Math.max(1000, Math.round(Number(seconden) * 1000));
  let gespeeld = 0;
  let sinds = 0;
  let loopt = false;
  let eindeTimer = null;
  let tikTimer = null;

  const verstreken = () => Math.min(totaal, gespeeld + (loopt ? nu() - sinds : 0));

  const stil = () => {
    if (eindeTimer !== null) stopPlan(eindeTimer);
    if (tikTimer !== null) stopTik(tikTimer);
    eindeTimer = null;
    tikTimer = null;
  };

  const klok = {
    totaal,
    verstreken,
    rest: () => Math.max(0, totaal - verstreken()),
    loopt: () => loopt,
    teken: () => bijTeken?.(verstreken(), totaal),

    /** Beginnen of verdergaan; een klok die al loopt doet niets. */
    start() {
      if (loopt) return;
      const over = klok.rest();
      if (over <= 0) return;
      loopt = true;
      sinds = nu();
      stil();
      eindeTimer = plan(() => {
        klok.pauzeer();
        bijEinde?.();
      }, over);
      tikTimer = tik(klok.teken, 120);
      klok.teken();
    },

    /** Pauzeren: de gespeelde tijd blijft staan, de rest van het fragment ook. */
    pauzeer() {
      if (!loopt) return;
      gespeeld = verstreken();
      loopt = false;
      stil();
      klok.teken();
    },

    /** Van voren af aan: een nieuw fragment begint bij nul. */
    opnieuw() {
      gespeeld = 0;
      klok.teken();
    },
  };
  return klok;
}
