import "./ui/mobilegate.css";

/**
 * Montreal Driver is desktop only (keyboard or gamepad, and a GPU that can carry the city). Phones and tablets get
 * this page instead: a short note and the published promo shots (`public/screens`, made from `promo/screenshots`
 * by `scripts/mobile-screens.sh`). `boot.ts` decides; the game bundle never loads on a phone.
 */

const SHOTS: [file: string, caption: string][] = [
  ["01-title", "Montreal Driver"],
  ["02-basilica-notre-dame", "Basilique Notre-Dame"],
  ["04-metro-mcgill", "Métro McGill"],
  ["05-rue-barree-detour", "Rue barrée: find the detour"],
  ["06-cockpit-arret", "Cockpit view at an arrêt"],
  ["07-vieux-montreal-saint-paul", "Vieux-Montréal, rue Saint-Paul"],
  ["08-downtown-rene-levesque", "Downtown, boulevard René-Lévesque"],
  ["10-driving-de-la-commune", "Rue de la Commune"],
  ["11-winter-tire-pickup", "Picking up the winter tires"],
  ["12-snow-squall", "Snow squall"],
];

/**
 * Phone or tablet. The UA catches phones, Android tablets and iPads that say so; an iPad asking for the desktop
 * site claims to be a Mac but has a touchscreen; anything else with no fine pointer at all (no mouse, no
 * trackpad) is a touch device too. A touchscreen laptop still has its trackpad, so it plays.
 * `?mobile` forces this page (to check it on a desktop), `?desktop` skips it.
 */
export function isPhoneOrTablet(): boolean {
  const q = new URLSearchParams(location.search);
  if (q.has("mobile")) return true;
  if (q.has("desktop")) return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  if (nav.userAgentData?.mobile) return true;
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|Tablet/i.test(ua)) return true;
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return true;
  return !matchMedia("(any-pointer: fine)").matches && matchMedia("(any-pointer: coarse)").matches;
}

export function showMobileGate(): void {
  document.body.classList.add("mg-body");
  const base = import.meta.env.BASE_URL;
  const page = document.createElement("main");
  page.className = "mg";
  page.innerHTML = `
    <header class="mg-head">
      <h1>MONTREAL<br />DRIVER</h1>
      <p class="mg-note">Desktop only</p>
      <p class="mg-text">
        Montreal Driver isn't available on phones or tablets. It needs a keyboard or a gamepad and a computer
        to drive the city. Come back on a desktop or laptop.
      </p>
      <p class="mg-sub">Here's what's waiting for you:</p>
    </header>
    <section class="mg-shots">
      ${SHOTS.map(
        ([file, caption], i) => `
        <figure>
          <img src="${base}screens/${file}.jpg" alt="${caption}" width="1280" height="720"
            ${i > 0 ? 'loading="lazy"' : ""} decoding="async" />
          <figcaption>${caption}</figcaption>
        </figure>`,
      ).join("")}
    </section>
    <footer class="mg-foot">Montreal Driver · play on desktop</footer>`;
  document.body.replaceChildren(page);
}
